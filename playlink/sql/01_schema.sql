-- =====================================================================
-- PLAYLINK - Plataforma LFG (Looking For Group) de jogos
-- Banco de dados: PostgreSQL 14+
-- Parte 1: tabelas do diagrama aprovado (PAISES, IDIOMAS, USUARIOS,
--          CATEGORIAS, JOGOS, GRUPOS, MEMBROS_GRUPO, AVALIACOES)
-- Parte 2: tabelas de apoio que o site usa (perfil, seguidores, mensagens,
--          forum e vinculo com o Resenha). Marcadas como "EXTENSAO".
-- Este arquivo pode ser executado varias vezes (recria tudo do zero).
-- =====================================================================

DROP SCHEMA IF EXISTS playlink CASCADE;
CREATE SCHEMA playlink;
SET search_path = playlink, public;

-- ---------------------------------------------------------------------
-- PARTE 1: DIAGRAMA APROVADO
-- ---------------------------------------------------------------------

CREATE TABLE paises (
  pais_id     SERIAL       PRIMARY KEY,
  nome_pais   VARCHAR(60)  NOT NULL UNIQUE,
  codigo_iso  CHAR(2)      NOT NULL UNIQUE          -- ISO 3166-1 alfa-2 (BR, PT, US...)
);

CREATE TABLE idiomas (
  idioma_id    SERIAL      PRIMARY KEY,
  nome_idioma  VARCHAR(40) NOT NULL UNIQUE,
  codigo_iso   VARCHAR(5)  NOT NULL UNIQUE          -- pt, en, es...
);

CREATE TABLE categorias (
  categoria_id    SERIAL       PRIMARY KEY,
  nome_categoria  VARCHAR(40)  NOT NULL UNIQUE,
  descricao       VARCHAR(200)
);

CREATE TABLE usuarios (
  usuario_id    SERIAL        PRIMARY KEY,
  nome_usuario  VARCHAR(30)   NOT NULL UNIQUE
                CHECK (nome_usuario ~ '^[A-Za-z0-9_.]{3,30}$'),
  email         VARCHAR(254)  NOT NULL UNIQUE
                CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  senha_hash    VARCHAR(255)  NOT NULL,             -- nunca a senha em texto puro
  pais_id       INT           REFERENCES paises(pais_id)   ON DELETE SET NULL,
  idioma_id     INT           REFERENCES idiomas(idioma_id) ON DELETE SET NULL,
  reputacao     NUMERIC(3,2)  NOT NULL DEFAULT 0
                CHECK (reputacao BETWEEN 0 AND 5),  -- media das avaliacoes recebidas (trigger)
  data_criacao  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE jogos (
  jogo_id       SERIAL        PRIMARY KEY,
  titulo        VARCHAR(100)  NOT NULL UNIQUE,
  genero        VARCHAR(50)   NOT NULL,
  plataforma    VARCHAR(50)   NOT NULL DEFAULT 'PC',
  categoria_id  INT           NOT NULL REFERENCES categorias(categoria_id),
  imagem_capa   VARCHAR(300)                         -- endereco (URL) da imagem
);

CREATE TABLE grupos (
  grupo_id      SERIAL        PRIMARY KEY,
  lider_id      INT           NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  jogo_id       INT           NOT NULL REFERENCES jogos(jogo_id),
  titulo        VARCHAR(100)  NOT NULL,
  descricao     VARCHAR(500),
  max_membros   INT           NOT NULL DEFAULT 5 CHECK (max_membros BETWEEN 2 AND 100),
  status        VARCHAR(10)   NOT NULL DEFAULT 'aberto'
                CHECK (status IN ('aberto', 'cheio', 'fechado')),
  idioma_id     INT           REFERENCES idiomas(idioma_id) ON DELETE SET NULL,
  data_criacao  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE membros_grupo (
  membro_id     SERIAL        PRIMARY KEY,
  grupo_id      INT           NOT NULL REFERENCES grupos(grupo_id)     ON DELETE CASCADE,
  usuario_id    INT           NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  cargo         VARCHAR(12)   NOT NULL DEFAULT 'membro'
                CHECK (cargo IN ('lider', 'moderador', 'membro')),
  data_entrada  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (grupo_id, usuario_id)                      -- ninguem entra duas vezes no mesmo grupo
);

CREATE TABLE avaliacoes (
  avaliacao_id    SERIAL       PRIMARY KEY,
  avaliador_id    INT          NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  avaliado_id     INT          NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  grupo_id        INT          NOT NULL REFERENCES grupos(grupo_id)     ON DELETE CASCADE,
  nota            SMALLINT     NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario      VARCHAR(300),
  data_avaliacao  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (avaliador_id <> avaliado_id),               -- nao da para se auto-avaliar
  UNIQUE (avaliador_id, avaliado_id, grupo_id)       -- uma avaliacao por pessoa em cada grupo
);

-- Indices para as consultas mais usadas (chaves estrangeiras e filtros do site)
CREATE INDEX ix_usuarios_pais     ON usuarios (pais_id);
CREATE INDEX ix_jogos_categoria   ON jogos (categoria_id);
CREATE INDEX ix_grupos_jogo       ON grupos (jogo_id, status);
CREATE INDEX ix_grupos_lider      ON grupos (lider_id);
CREATE INDEX ix_membros_usuario   ON membros_grupo (usuario_id);
CREATE INDEX ix_avaliacoes_avaliado ON avaliacoes (avaliado_id);

-- ---------------------------------------------------------------------
-- REGRAS NO PROPRIO BANCO (triggers)
-- ---------------------------------------------------------------------

-- 1) Quem cria um grupo entra nele automaticamente como lider.
CREATE FUNCTION fn_lider_entra_no_grupo() RETURNS trigger AS $$
BEGIN
  INSERT INTO membros_grupo (grupo_id, usuario_id, cargo)
  VALUES (NEW.grupo_id, NEW.lider_id, 'lider');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_lider_entra AFTER INSERT ON grupos
  FOR EACH ROW EXECUTE FUNCTION fn_lider_entra_no_grupo();

-- 2) Nao deixa entrar em grupo cheio ou fechado.
CREATE FUNCTION fn_valida_entrada() RETURNS trigger AS $$
DECLARE g grupos%ROWTYPE; total INT;
BEGIN
  SELECT * INTO g FROM grupos WHERE grupo_id = NEW.grupo_id FOR UPDATE;
  IF NEW.cargo <> 'lider' THEN                       -- o lider entra pelo trigger acima
    IF g.status = 'fechado' THEN RAISE EXCEPTION 'Este grupo esta fechado.'; END IF;
    SELECT count(*) INTO total FROM membros_grupo WHERE grupo_id = NEW.grupo_id;
    IF total >= g.max_membros THEN RAISE EXCEPTION 'Este grupo ja esta cheio.'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_valida_entrada BEFORE INSERT ON membros_grupo
  FOR EACH ROW EXECUTE FUNCTION fn_valida_entrada();

-- 3) O status do grupo acompanha a lotacao: cheio <-> aberto (fechado e manual).
CREATE FUNCTION fn_atualiza_status() RETURNS trigger AS $$
DECLARE gid INT := COALESCE(NEW.grupo_id, OLD.grupo_id);
BEGIN
  UPDATE grupos g SET status = CASE
      WHEN g.status = 'fechado' THEN 'fechado'
      WHEN (SELECT count(*) FROM membros_grupo m WHERE m.grupo_id = g.grupo_id) >= g.max_membros THEN 'cheio'
      ELSE 'aberto' END
  WHERE g.grupo_id = gid;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_status_grupo AFTER INSERT OR DELETE ON membros_grupo
  FOR EACH ROW EXECUTE FUNCTION fn_atualiza_status();

-- 4) So pode avaliar quem participou do mesmo grupo (os dois precisam ser membros).
CREATE FUNCTION fn_valida_avaliacao() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM membros_grupo WHERE grupo_id = NEW.grupo_id AND usuario_id = NEW.avaliador_id)
  OR NOT EXISTS (SELECT 1 FROM membros_grupo WHERE grupo_id = NEW.grupo_id AND usuario_id = NEW.avaliado_id) THEN
    RAISE EXCEPTION 'Os dois jogadores precisam ter participado do grupo.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_valida_avaliacao BEFORE INSERT OR UPDATE ON avaliacoes
  FOR EACH ROW EXECUTE FUNCTION fn_valida_avaliacao();

-- 5) A reputacao do usuario e sempre a media das notas que ele recebeu.
CREATE FUNCTION fn_atualiza_reputacao() RETURNS trigger AS $$
DECLARE uid INT := COALESCE(NEW.avaliado_id, OLD.avaliado_id);
BEGIN
  UPDATE usuarios SET reputacao = COALESCE(
    (SELECT round(avg(nota)::numeric, 2) FROM avaliacoes WHERE avaliado_id = uid), 0)
  WHERE usuario_id = uid;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_reputacao AFTER INSERT OR UPDATE OR DELETE ON avaliacoes
  FOR EACH ROW EXECUTE FUNCTION fn_atualiza_reputacao();

-- ---------------------------------------------------------------------
-- PARTE 2: EXTENSAO (funcoes do site que o diagrama nao cobre)
-- ---------------------------------------------------------------------

-- Dados de perfil mostrados nos cartoes de jogador (Explorar / Match)
CREATE TABLE perfis_jogador (
  usuario_id          INT          PRIMARY KEY REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  bio                 VARCHAR(300),
  estilo              VARCHAR(20)  CHECK (estilo IN ('Competitivo','Cooperativo','Relaxante','Aventura')),
  nivel               VARCHAR(60),
  horario_disponivel  VARCHAR(20)  CHECK (horario_disponivel IN ('Madrugadas','Manhãs','Tardes','Noites','Fins de semana')),
  cor_avatar          CHAR(7)      NOT NULL DEFAULT '#2330E6' CHECK (cor_avatar ~ '^#[0-9A-Fa-f]{6}$'),
  ultimo_acesso       TIMESTAMPTZ
);

-- Jogos que cada pessoa joga (N:N entre usuarios e jogos)
CREATE TABLE usuario_jogos (
  usuario_id  INT NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  jogo_id     INT NOT NULL REFERENCES jogos(jogo_id)       ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, jogo_id)
);

-- Botao "Seguir"
CREATE TABLE seguidores (
  seguidor_id  INT NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  seguido_id   INT NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  desde        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (seguidor_id, seguido_id),
  CHECK (seguidor_id <> seguido_id)
);

-- Pagina Mensagens (conversa direta entre duas pessoas)
CREATE TABLE mensagens (
  mensagem_id     BIGSERIAL    PRIMARY KEY,
  remetente_id    INT          NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  destinatario_id INT          NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  texto           VARCHAR(2000) NOT NULL CHECK (length(btrim(texto)) > 0),
  enviada_em      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (remetente_id <> destinatario_id)
);
CREATE INDEX ix_mensagens_par ON mensagens (LEAST(remetente_id, destinatario_id), GREATEST(remetente_id, destinatario_id), enviada_em);

-- Forum de cada jogo
CREATE TABLE topicos_forum (
  topico_id   SERIAL        PRIMARY KEY,
  jogo_id     INT           NOT NULL REFERENCES jogos(jogo_id)       ON DELETE CASCADE,
  autor_id    INT           NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  titulo      VARCHAR(100)  NOT NULL,
  corpo       VARCHAR(1500) NOT NULL,
  criado_em   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE TABLE respostas_forum (
  resposta_id SERIAL        PRIMARY KEY,
  topico_id   INT           NOT NULL REFERENCES topicos_forum(topico_id) ON DELETE CASCADE,
  autor_id    INT           NOT NULL REFERENCES usuarios(usuario_id)     ON DELETE CASCADE,
  corpo       VARCHAR(1500) NOT NULL,
  criada_em   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE TABLE curtidas_forum (
  topico_id   INT NOT NULL REFERENCES topicos_forum(topico_id) ON DELETE CASCADE,
  usuario_id  INT NOT NULL REFERENCES usuarios(usuario_id)     ON DELETE CASCADE,
  PRIMARY KEY (topico_id, usuario_id)                -- uma curtida por pessoa
);
CREATE INDEX ix_topicos_jogo ON topicos_forum (jogo_id, criado_em DESC);

-- Integracao com o Resenha (chat gratuito): guarda qual conta do Resenha pertence ao jogador
CREATE TABLE vinculo_resenha (
  usuario_id        INT         PRIMARY KEY REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
  usuario_resenha   VARCHAR(30) NOT NULL UNIQUE,
  vinculado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- VISOES (consultas prontas usadas pelo site)
-- ---------------------------------------------------------------------

-- Grupos abertos com nome do jogo, do lider e vagas restantes
CREATE VIEW v_grupos_abertos AS
SELECT g.grupo_id, g.titulo, g.descricao, j.titulo AS jogo, u.nome_usuario AS lider,
       i.nome_idioma AS idioma, g.max_membros,
       count(m.membro_id) AS membros,
       g.max_membros - count(m.membro_id) AS vagas,
       g.status, g.data_criacao
FROM grupos g
JOIN jogos j     ON j.jogo_id = g.jogo_id
JOIN usuarios u  ON u.usuario_id = g.lider_id
LEFT JOIN idiomas i ON i.idioma_id = g.idioma_id
LEFT JOIN membros_grupo m ON m.grupo_id = g.grupo_id
WHERE g.status = 'aberto'
GROUP BY g.grupo_id, j.titulo, u.nome_usuario, i.nome_idioma;

-- "Tendencias da comunidade": ranking dos jogos por atividade
CREATE VIEW v_tendencias AS
SELECT j.jogo_id, j.titulo,
       (SELECT count(*) FROM grupos g WHERE g.jogo_id = j.jogo_id)                               AS grupos,
       (SELECT count(*) FROM usuario_jogos uj WHERE uj.jogo_id = j.jogo_id)                      AS jogadores,
       (SELECT count(*) FROM topicos_forum t WHERE t.jogo_id = j.jogo_id)                        AS topicos,
       (SELECT count(*) FROM grupos g JOIN membros_grupo m USING (grupo_id) WHERE g.jogo_id = j.jogo_id) AS vagas_ocupadas,
       (SELECT count(*) FROM grupos g WHERE g.jogo_id = j.jogo_id) * 10
     + (SELECT count(*) FROM usuario_jogos uj WHERE uj.jogo_id = j.jogo_id) * 5
     + (SELECT count(*) FROM topicos_forum t WHERE t.jogo_id = j.jogo_id) * 3                   AS pontos
FROM jogos j;
