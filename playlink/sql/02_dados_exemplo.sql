-- PLAYLINK - dados de exemplo (contas de demonstracao: nao fazem login)
SET search_path = playlink, public;

INSERT INTO paises (nome_pais, codigo_iso) VALUES
  ('Brasil','BR'),('Portugal','PT'),('Estados Unidos','US'),('Argentina','AR'),('Espanha','ES');
INSERT INTO idiomas (nome_idioma, codigo_iso) VALUES
  ('Português','pt'),('Inglês','en'),('Espanhol','es');
INSERT INTO categorias (nome_categoria, descricao) VALUES
  ('FPS','Tiro em primeira pessoa'),('Sandbox','Construção e liberdade total'),('Esporte','Futebol e outros esportes'),
  ('Ação','Ação e aventura'),('Co-op','Feito para jogar em equipe'),('RPG','Interpretação de personagens'),
  ('Casual','Jogos leves e relaxantes'),('Mundo aberto','Grandes mapas para explorar'),('Battle Royale','Último jogador vivo vence');

INSERT INTO jogos (titulo, genero, plataforma, categoria_id, imagem_capa)
SELECT v.titulo, v.genero, v.plataforma, c.categoria_id, v.capa
FROM (VALUES
 ('Valorant','FPS tatico 5v5','PC','FPS','https://img.youtube.com/vi/e_E9W2vsRbQ/maxresdefault.jpg'),
 ('Counter-Strike 2','FPS competitivo','PC','FPS','https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_hero.jpg'),
 ('Minecraft','Aventura e sandbox','PC / Console / Celular','Sandbox','https://img.youtube.com/vi/qNMfF9TYETM/maxresdefault.jpg'),
 ('EA SPORTS FC','Esporte','PC / Console','Esporte','https://cdn.cloudflare.steamstatic.com/steam/apps/2669320/library_hero.jpg'),
 ('Monster Hunter Wilds','Ação e aventura','PC / Console','Ação','https://cdn.cloudflare.steamstatic.com/steam/apps/2246340/library_hero.jpg'),
 ('Helldivers 2','Cooperativo','PC / Console','Co-op','https://cdn.cloudflare.steamstatic.com/steam/apps/553850/library_hero.jpg'),
 ('GTA VI','Ação e mundo aberto','Console','Mundo aberto','https://img.youtube.com/vi/VQRLujxTm3c/maxresdefault.jpg'),
 ('Elden Ring','RPG de ação','PC / Console','RPG','https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_hero.jpg'),
 ('Cyberpunk 2077','RPG - Mundo aberto','PC / Console','RPG','https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/library_hero.jpg'),
 ('Red Dead Redemption 2','Ação - Mundo aberto','PC / Console','Mundo aberto','https://cdn.cloudflare.steamstatic.com/steam/apps/1174180/library_hero.jpg'),
 ('Apex Legends','Battle royale - FPS','PC / Console','Battle Royale','https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/library_hero.jpg'),
 ('PUBG: Battlegrounds','Battle royale','PC / Console','Battle Royale','https://cdn.cloudflare.steamstatic.com/steam/apps/578080/library_hero.jpg'),
 ('The Witcher 3: Wild Hunt','RPG - Fantasia','PC / Console','RPG','https://cdn.cloudflare.steamstatic.com/steam/apps/292030/library_hero.jpg'),
 ('Terraria','Aventura - Sandbox','PC / Console / Celular','Sandbox','https://cdn.cloudflare.steamstatic.com/steam/apps/105600/library_hero.jpg'),
 ('Stardew Valley','Fazenda - Simulação','PC / Console / Celular','Casual','https://cdn.cloudflare.steamstatic.com/steam/apps/413150/library_hero.jpg'),
 ('Baldur''s Gate 3','RPG - Coop','PC / Console','RPG','https://cdn.cloudflare.steamstatic.com/steam/apps/1086940/library_hero.jpg'),
 ('Destiny 2','FPS - MMO','PC / Console','Co-op','https://cdn.cloudflare.steamstatic.com/steam/apps/1085660/library_hero.jpg'),
 ('Palworld','Sobrevivência - Coop','PC / Console','Co-op','https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/library_hero.jpg'),
 ('God of War','Ação - Aventura','PC / Console','Ação','https://cdn.cloudflare.steamstatic.com/steam/apps/1593500/library_hero.jpg')
) AS v(titulo, genero, plataforma, cat, capa)
JOIN categorias c ON c.nome_categoria = v.cat;

-- Jogadores de demonstracao (senha_hash invalido de proposito: so contas criadas pelo site fazem login)
INSERT INTO usuarios (nome_usuario, email, senha_hash, pais_id, idioma_id)
SELECT v.nome, v.email, 'conta-de-demonstracao', p.pais_id, i.idioma_id
FROM (VALUES
 ('toniz2','toniz2@exemplo.com','BR','pt'),('Luna.exe','luna@exemplo.com','BR','pt'),
 ('kaiju_rj','kaiju@exemplo.com','BR','pt'),('Mirela','mirela@exemplo.com','PT','pt'),
 ('drako','drako@exemplo.com','BR','pt'),('Pixel.Sam','pixel@exemplo.com','US','en'),
 ('vitorbr','vitorbr@exemplo.com','BR','pt'),('nina_plays','nina@exemplo.com','AR','es')
) AS v(nome, email, pais, idioma)
JOIN paises p ON p.codigo_iso = v.pais JOIN idiomas i ON i.codigo_iso = v.idioma;

INSERT INTO perfis_jogador (usuario_id, bio, estilo, nivel, horario_disponivel, cor_avatar, ultimo_acesso)
SELECT u.usuario_id, v.bio, v.estilo, v.nivel, v.horario, v.cor, CASE WHEN v.online THEN now() END
FROM (VALUES
 ('toniz2','Controlador main. Procuro duo para ranked sem tilt.','Competitivo','Imortal 1','Noites','#2330E6',true),
 ('Luna.exe','Servidores tranquilos e construções enormes.','Relaxante','Construtora veterana','Tardes','#0C8F6A',true),
 ('kaiju_rj','Líder de esquadrão. Comunicação antes de qualquer estratégia.','Cooperativo','Nível 82','Fins de semana','#C21E5B',false),
 ('Mirela','Fazenda de dia, campanha de RPG à noite.','Relaxante','Campanha 2','Noites','#7A2FD0',true),
 ('drako','Invoco para chefes difíceis e cobro o mesmo de volta.','Aventura','Nível 150','Madrugadas','#C24A0A',false),
 ('Pixel.Sam','Montando um clube para amistosos e uma dupla para Apex.','Competitivo','Diamante','Tardes','#1B6FD6',true),
 ('vitorbr','IGL de squad. Procuro duas pessoas que aceitem call.','Competitivo','Mestre','Noites','#B3261E',false),
 ('nina_plays','Construo base, capturo Pals e divido recursos.','Cooperativo','Base nível 40','Fins de semana','#D6286F',true)
) AS v(nome, bio, estilo, nivel, horario, cor, online)
JOIN usuarios u ON u.nome_usuario = v.nome;

INSERT INTO usuario_jogos (usuario_id, jogo_id)
SELECT u.usuario_id, j.jogo_id FROM (VALUES
 ('toniz2','Valorant'),('toniz2','Counter-Strike 2'),('Luna.exe','Minecraft'),('Luna.exe','Terraria'),
 ('kaiju_rj','Helldivers 2'),('kaiju_rj','Destiny 2'),('Mirela','Stardew Valley'),('Mirela','Baldur''s Gate 3'),
 ('drako','Elden Ring'),('drako','Monster Hunter Wilds'),('Pixel.Sam','EA SPORTS FC'),('Pixel.Sam','Apex Legends'),
 ('vitorbr','Apex Legends'),('vitorbr','PUBG: Battlegrounds'),('nina_plays','Palworld'),('nina_plays','Minecraft')
) AS v(nome, jogo) JOIN usuarios u ON u.nome_usuario = v.nome JOIN jogos j ON j.titulo = v.jogo;

-- Grupos (o lider entra sozinho pelo trigger)
INSERT INTO grupos (lider_id, jogo_id, titulo, descricao, max_membros, idioma_id)
SELECT u.usuario_id, j.jogo_id, v.titulo, v.descricao, v.maximo, i.idioma_id
FROM (VALUES
 ('toniz2','Valorant','Squad da madrugada','Procurando duo e gente para fechar time.',5,'pt'),
 ('Luna.exe','Minecraft','Exploradores','Construção, sobrevivência e boas ideias.',6,'pt'),
 ('toniz2','Counter-Strike 2','Ranked sem tilt','Jogue sério, mantenha o respeito.',5,'pt'),
 ('vitorbr','Apex Legends','Trio de elite','Procuro dois jogadores com call.',3,'pt'),
 ('nina_plays','Palworld','Base cooperativa','Construção de base e captura em grupo.',4,'es')
) AS v(lider, jogo, titulo, descricao, maximo, idioma)
JOIN usuarios u ON u.nome_usuario = v.lider JOIN jogos j ON j.titulo = v.jogo JOIN idiomas i ON i.codigo_iso = v.idioma;

INSERT INTO membros_grupo (grupo_id, usuario_id)
SELECT g.grupo_id, u.usuario_id FROM (VALUES
 ('Squad da madrugada','vitorbr'),('Squad da madrugada','Pixel.Sam'),
 ('Exploradores','nina_plays'),('Exploradores','Mirela'),
 ('Ranked sem tilt','vitorbr'),('Trio de elite','Pixel.Sam'),('Trio de elite','toniz2'),
 ('Base cooperativa','Luna.exe')
) AS v(grupo, nome) JOIN grupos g ON g.titulo = v.grupo JOIN usuarios u ON u.nome_usuario = v.nome;

INSERT INTO avaliacoes (avaliador_id, avaliado_id, grupo_id, nota, comentario)
SELECT a.usuario_id, b.usuario_id, g.grupo_id, v.nota, v.comentario FROM (VALUES
 ('vitorbr','toniz2','Squad da madrugada',5,'Ótima comunicação e zero tilt.'),
 ('Pixel.Sam','toniz2','Squad da madrugada',4,'Bom líder, partidas organizadas.'),
 ('toniz2','vitorbr','Squad da madrugada',5,'Jogador muito consistente.'),
 ('nina_plays','Luna.exe','Exploradores',5,'Construções incríveis!'),
 ('Mirela','Luna.exe','Exploradores',4,'Ajudou muito com redstone.'),
 ('Pixel.Sam','vitorbr','Trio de elite',3,'Bom, mas atrasou um pouco.')
) AS v(avaliador, avaliado, grupo, nota, comentario)
JOIN usuarios a ON a.nome_usuario = v.avaliador JOIN usuarios b ON b.nome_usuario = v.avaliado JOIN grupos g ON g.titulo = v.grupo;

INSERT INTO seguidores (seguidor_id, seguido_id)
SELECT a.usuario_id, b.usuario_id FROM (VALUES
 ('Luna.exe','toniz2'),('Mirela','Luna.exe'),('vitorbr','toniz2'),('Pixel.Sam','vitorbr'),('toniz2','vitorbr')
) AS v(a, b) JOIN usuarios a ON a.nome_usuario = v.a JOIN usuarios b ON b.nome_usuario = v.b;

INSERT INTO mensagens (remetente_id, destinatario_id, texto, enviada_em)
SELECT a.usuario_id, b.usuario_id, v.texto, now() - v.atras * interval '1 minute' FROM (VALUES
 ('toniz2','vitorbr','E ai! Bora fechar uma partida hoje?',120),
 ('vitorbr','toniz2','Bora! Me chama quando estiver online.',118),
 ('toniz2','vitorbr','Fechado! Me chama quando entrar.',32),
 ('Luna.exe','Mirela','Achei um servidor novo para jogar.',60)
) AS v(a, b, texto, atras) JOIN usuarios a ON a.nome_usuario = v.a JOIN usuarios b ON b.nome_usuario = v.b;

INSERT INTO topicos_forum (jogo_id, autor_id, titulo, corpo)
SELECT j.jogo_id, u.usuario_id, v.titulo, v.corpo FROM (VALUES
 ('Valorant','toniz2','Dicas para iniciantes','Qual agente vocês recomendam para quem está começando?'),
 ('Minecraft','Luna.exe','Servidor de survival','Quem quer montar um servidor tranquilo no fim de semana?'),
 ('Elden Ring','drako','Build de dex','Compartilhem suas builds favoritas para o fim do jogo.')
) AS v(jogo, autor, titulo, corpo) JOIN jogos j ON j.titulo = v.jogo JOIN usuarios u ON u.nome_usuario = v.autor;

INSERT INTO respostas_forum (topico_id, autor_id, corpo)
SELECT t.topico_id, u.usuario_id, v.corpo FROM (VALUES
 ('Dicas para iniciantes','vitorbr','Começa com a Sage ou o Brimstone, são mais fáceis.'),
 ('Servidor de survival','nina_plays','Eu topo! Pode contar comigo.')
) AS v(topico, autor, corpo) JOIN topicos_forum t ON t.titulo = v.topico JOIN usuarios u ON u.nome_usuario = v.autor;

INSERT INTO curtidas_forum (topico_id, usuario_id)
SELECT t.topico_id, u.usuario_id FROM (VALUES
 ('Dicas para iniciantes','vitorbr'),('Dicas para iniciantes','Pixel.Sam'),('Servidor de survival','nina_plays')
) AS v(topico, nome) JOIN topicos_forum t ON t.titulo = v.topico JOIN usuarios u ON u.nome_usuario = v.nome;
