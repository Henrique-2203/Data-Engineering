// API do PLAYLINK (Express). Todas as consultas usam parametros ($1, $2...) - nunca texto concatenado.
import express from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';

const COOKIE = 'pl_sess';
const DIA = 7 * 24 * 3600;

// ---------- senha e sessao ----------
const scrypt = (s, salt) => new Promise((ok, no) => crypto.scrypt(s, salt, 32, (e, k) => (e ? no(e) : ok(k))));
export async function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(senha, salt)).toString('hex')}`;
}
async function confereSenha(senha, h) {
  const [alg, salt, hash] = String(h).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;           // contas de demonstracao nao fazem login
  const a = await scrypt(senha, Buffer.from(salt, 'hex')), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const b64 = (b) => Buffer.from(b).toString('base64url');

export function criarApp({ db, segredo = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex') } = {}) {
  const assina = (txt) => crypto.createHmac('sha256', segredo).update(txt).digest('base64url');
  const emitir = (uid) => { const p = b64(JSON.stringify({ u: uid, e: Math.floor(Date.now() / 1000) + DIA })); return `${p}.${assina(p)}`; };
  const ler = (tok) => {
    const [p, s] = String(tok || '').split('.');
    if (!p || !s || assina(p) !== s) return null;
    try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.e > Date.now() / 1000 ? d.u : null; } catch { return null; }
  };
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
  const setCookie = (req, res, valor, seg) => {
    const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seg}${seguro ? '; Secure' : ''}`);
  };

  // limite simples de tentativas (por IP+rota) - protege login e cadastro de forca bruta
  const tentativas = new Map();
  const limite = (nome, max, janelaMs) => (req, res, next) => {
    const k = `${nome}:${req.ip}`, agora = Date.now(), t = (tentativas.get(k) || []).filter((x) => agora - x < janelaMs);
    if (t.length >= max) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde um pouco e tente de novo.' });
    t.push(agora); tentativas.set(k, t); next();
  };

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  // Escritas so aceitam JSON (junto com SameSite=Lax isso impede formularios de outros sites de agirem em nome do usuario)
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['content-length'] !== '0' && !req.is('application/json')) return res.status(415).json({ erro: 'Envie JSON.' });
    next();
  });
  app.use('/api', (req, _res, next) => { req.uid = ler(cookies(req)[COOKIE]); next(); });
  const exige = (req, res, next) => (req.uid ? next() : res.status(401).json({ erro: 'Entre na sua conta para continuar.' }));

  const q = (s, p) => db.query(s, p).then((r) => r.rows);
  const um = async (s, p) => (await q(s, p))[0];
  const valida = (esq, dados) => { const r = esq.safeParse(dados); if (!r.success) throw Object.assign(new Error(r.error.issues[0]?.message || 'Dados invalidos.'), { status: 400 }); return r.data; };
  const idDe = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw Object.assign(new Error('Identificador invalido.'), { status: 400 }); return n; };
  const uidPorNome = async (nome) => (await um('SELECT usuario_id FROM usuarios WHERE lower(nome_usuario) = lower($1)', [String(nome)]))?.usuario_id;
  const quem = async (nome) => { const id = await uidPorNome(nome); if (!id) throw Object.assign(new Error('Jogador nao encontrado.'), { status: 404 }); return id; };

  // atualiza "ultimo acesso" (para o "online agora"), no maximo 1x por minuto por pessoa
  const visto = new Map();
  app.use('/api', (req, _res, next) => {
    if (req.uid && Date.now() - (visto.get(req.uid) || 0) > 60000) {
      visto.set(req.uid, Date.now());
      q('UPDATE perfis_jogador SET ultimo_acesso = now() WHERE usuario_id = $1', [req.uid]).catch(() => {});
    }
    next();
  });

  // ---------- conta ----------
  const Registro = z.object({
    nome_usuario: z.string().regex(/^[A-Za-z0-9_.]{3,30}$/, 'Nome de usuario: 3 a 30 letras, numeros, _ ou .'),
    email: z.string().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'E-mail invalido.'),
    senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(72),
    pais: z.string().length(2).optional(), idioma: z.string().max(5).optional(),
  });
  app.post('/api/auth/registrar', limite('reg', 10, 3600e3), async (req, res) => {
    const d = valida(Registro, req.body);
    const u = await db.tx(async (t) => {
      const r = (await t.query(`INSERT INTO usuarios (nome_usuario, email, senha_hash, pais_id, idioma_id)
        VALUES ($1, lower($2), $3, (SELECT pais_id FROM paises WHERE codigo_iso = upper($4)), (SELECT idioma_id FROM idiomas WHERE codigo_iso = lower($5)))
        RETURNING usuario_id`, [d.nome_usuario, d.email, await hashSenha(d.senha), d.pais ?? null, d.idioma ?? null])).rows[0];
      await t.query('INSERT INTO perfis_jogador (usuario_id, ultimo_acesso) VALUES ($1, now())', [r.usuario_id]);
      return r;
    });
    setCookie(req, res, emitir(u.usuario_id), DIA);
    res.status(201).json({ ok: true });
  });
  app.post('/api/auth/entrar', limite('login', 15, 15 * 60e3), async (req, res) => {
    const d = valida(z.object({ login: z.string().min(1).max(254), senha: z.string().min(1).max(72) }), req.body);
    const u = await um('SELECT usuario_id, senha_hash FROM usuarios WHERE lower(nome_usuario) = lower($1) OR email = lower($1)', [d.login]);
    // confere a senha mesmo se a conta nao existir (tempo parecido) para nao revelar quais contas existem
    const ok = await confereSenha(d.senha, u?.senha_hash ?? 'scrypt$00$00');
    if (!u || !ok) return res.status(401).json({ erro: 'Usuario ou senha incorretos.' });
    setCookie(req, res, emitir(u.usuario_id), DIA);
    res.json({ ok: true });
  });
  app.post('/api/auth/sair', (req, res) => { setCookie(req, res, '', 0); res.json({ ok: true }); });

  const PERFIL_SQL = `
    SELECT u.usuario_id, u.nome_usuario, u.reputacao::float AS reputacao, u.data_criacao,
           p.bio, p.estilo, p.nivel, p.horario_disponivel, p.cor_avatar,
           (p.ultimo_acesso > now() - interval '15 minutes') AS online,
           pa.nome_pais AS pais, i.nome_idioma AS idioma, v.usuario_resenha,
           COALESCE((SELECT json_agg(json_build_object('jogo_id', j.jogo_id, 'titulo', j.titulo) ORDER BY j.titulo)
                     FROM usuario_jogos uj JOIN jogos j ON j.jogo_id = uj.jogo_id WHERE uj.usuario_id = u.usuario_id), '[]') AS jogos,
           (SELECT count(*)::int FROM seguidores s WHERE s.seguido_id = u.usuario_id) AS seguidores
    FROM usuarios u
    LEFT JOIN perfis_jogador p ON p.usuario_id = u.usuario_id
    LEFT JOIN paises pa ON pa.pais_id = u.pais_id LEFT JOIN idiomas i ON i.idioma_id = u.idioma_id
    LEFT JOIN vinculo_resenha v ON v.usuario_id = u.usuario_id`;
  app.get('/api/eu', async (req, res) => {
    if (!req.uid) return res.json({ usuario: null });
    const u = await um(`${PERFIL_SQL} WHERE u.usuario_id = $1`, [req.uid]);
    res.json({ usuario: u ?? null });
  });
  app.get('/api/usuarios/:nome', async (req, res) => {
    const u = await um(`${PERFIL_SQL} WHERE lower(u.nome_usuario) = lower($1)`, [req.params.nome]);
    if (!u) return res.status(404).json({ erro: 'Jogador nao encontrado.' });
    u.avaliacoes = await q(`SELECT a.nota, a.comentario, a.data_avaliacao, r.nome_usuario AS avaliador, g.titulo AS grupo
      FROM avaliacoes a JOIN usuarios r ON r.usuario_id = a.avaliador_id JOIN grupos g ON g.grupo_id = a.grupo_id
      WHERE a.avaliado_id = $1 ORDER BY a.data_avaliacao DESC LIMIT 20`, [u.usuario_id]);
    u.seguindo = req.uid ? !!(await um('SELECT 1 FROM seguidores WHERE seguidor_id = $1 AND seguido_id = $2', [req.uid, u.usuario_id])) : false;
    delete u.usuario_id; res.json(u);
  });
  app.put('/api/perfil', exige, async (req, res) => {
    const d = valida(z.object({
      bio: z.string().max(300).nullish(),
      estilo: z.enum(['Competitivo', 'Cooperativo', 'Relaxante', 'Aventura']).nullish(),
      nivel: z.string().max(60).nullish(),
      horario_disponivel: z.enum(['Madrugadas', 'Manhãs', 'Tardes', 'Noites', 'Fins de semana']).nullish(),
      jogos: z.array(z.number().int().positive()).max(30).optional(),
      usuario_resenha: z.string().regex(/^[A-Za-z0-9_.]{3,30}$/, 'Usuario do Resenha invalido.').nullish().or(z.literal('')),
    }), req.body);
    await db.tx(async (t) => {
      await t.query(`UPDATE perfis_jogador SET bio = $2, estilo = $3, nivel = $4, horario_disponivel = $5 WHERE usuario_id = $1`,
        [req.uid, d.bio ?? null, d.estilo ?? null, d.nivel ?? null, d.horario_disponivel ?? null]);
      if (d.jogos) {
        await t.query('DELETE FROM usuario_jogos WHERE usuario_id = $1', [req.uid]);
        for (const j of new Set(d.jogos)) await t.query('INSERT INTO usuario_jogos (usuario_id, jogo_id) SELECT $1, jogo_id FROM jogos WHERE jogo_id = $2', [req.uid, j]);
      }
      if ('usuario_resenha' in d) {
        if (d.usuario_resenha) await t.query(`INSERT INTO vinculo_resenha (usuario_id, usuario_resenha) VALUES ($1, $2)
          ON CONFLICT (usuario_id) DO UPDATE SET usuario_resenha = EXCLUDED.usuario_resenha, vinculado_em = now()`, [req.uid, d.usuario_resenha]);
        else await t.query('DELETE FROM vinculo_resenha WHERE usuario_id = $1', [req.uid]);
      }
    });
    res.json({ ok: true });
  });

  // ---------- catalogo ----------
  app.get('/api/jogos', async (_req, res) => res.json(await q(`
    SELECT j.jogo_id, j.titulo, j.genero, j.plataforma, j.imagem_capa, c.nome_categoria AS categoria,
           (SELECT count(*)::int FROM usuario_jogos uj WHERE uj.jogo_id = j.jogo_id) AS jogadores,
           (SELECT count(*)::int FROM grupos g WHERE g.jogo_id = j.jogo_id AND g.status = 'aberto') AS grupos_abertos
    FROM jogos j JOIN categorias c ON c.categoria_id = j.categoria_id ORDER BY j.titulo`)));
  app.get('/api/paises', async (_req, res) => res.json(await q('SELECT nome_pais, codigo_iso FROM paises ORDER BY nome_pais')));
  app.get('/api/idiomas', async (_req, res) => res.json(await q('SELECT nome_idioma, codigo_iso FROM idiomas ORDER BY nome_idioma')));
  app.get('/api/tendencias', async (_req, res) => res.json(await q('SELECT jogo_id, titulo, grupos::int, jogadores::int, topicos::int, pontos::int FROM v_tendencias ORDER BY pontos DESC, titulo')));

  // ---------- jogadores ----------
  app.get('/api/jogadores', async (req, res) => {
    const jogo = req.query.jogo ? idDe(req.query.jogo) : null;
    res.json(await q(`
      SELECT u.nome_usuario, u.reputacao::float AS reputacao, p.bio, p.estilo, p.nivel, p.horario_disponivel, p.cor_avatar,
             COALESCE(p.ultimo_acesso > now() - interval '15 minutes', false) AS online,
             COALESCE((SELECT json_agg(j.titulo ORDER BY j.titulo) FROM usuario_jogos uj JOIN jogos j ON j.jogo_id = uj.jogo_id WHERE uj.usuario_id = u.usuario_id), '[]') AS jogos,
             ($2::int IS NOT NULL AND EXISTS (SELECT 1 FROM seguidores s WHERE s.seguidor_id = $2 AND s.seguido_id = u.usuario_id)) AS seguindo
      FROM usuarios u JOIN perfis_jogador p ON p.usuario_id = u.usuario_id
      WHERE ($1::int IS NULL OR EXISTS (SELECT 1 FROM usuario_jogos uj WHERE uj.usuario_id = u.usuario_id AND uj.jogo_id = $1))
        AND u.usuario_id IS DISTINCT FROM $2::int
      ORDER BY online DESC, u.nome_usuario LIMIT 60`, [jogo, req.uid ?? null]));
  });
  // Match: quem joga os mesmos jogos e tem o mesmo horario que voce
  app.get('/api/match', exige, async (req, res) => res.json(await q(`
    SELECT o.nome_usuario, po.estilo, po.nivel, po.horario_disponivel, po.bio, po.cor_avatar, o.reputacao::float AS reputacao,
           COALESCE(po.ultimo_acesso > now() - interval '15 minutes', false) AS online,
           count(*)::int AS jogos_em_comum, json_agg(j.titulo ORDER BY j.titulo) AS jogos,
           (po.horario_disponivel IS NOT DISTINCT FROM pe.horario_disponivel) AS mesmo_horario,
           (po.estilo IS NOT DISTINCT FROM pe.estilo) AS mesmo_estilo
    FROM perfis_jogador pe
    JOIN usuario_jogos ue ON ue.usuario_id = pe.usuario_id
    JOIN usuario_jogos uo ON uo.jogo_id = ue.jogo_id AND uo.usuario_id <> pe.usuario_id
    JOIN usuarios o ON o.usuario_id = uo.usuario_id
    JOIN perfis_jogador po ON po.usuario_id = o.usuario_id
    JOIN jogos j ON j.jogo_id = ue.jogo_id
    WHERE pe.usuario_id = $1
    GROUP BY o.usuario_id, po.usuario_id, pe.horario_disponivel, pe.estilo
    ORDER BY jogos_em_comum DESC, mesmo_horario DESC, mesmo_estilo DESC, o.nome_usuario LIMIT 30`, [req.uid])));
  app.post('/api/seguir/:nome', exige, async (req, res) => {
    const alvo = await quem(req.params.nome);
    if (alvo === req.uid) return res.status(400).json({ erro: 'Voce nao pode seguir a si mesmo.' });
    const apagou = await q('DELETE FROM seguidores WHERE seguidor_id = $1 AND seguido_id = $2 RETURNING 1', [req.uid, alvo]);
    if (!apagou.length) await q('INSERT INTO seguidores (seguidor_id, seguido_id) VALUES ($1, $2)', [req.uid, alvo]);
    res.json({ seguindo: !apagou.length });
  });

  // ---------- grupos ----------
  const GRUPO_SQL = `
    SELECT g.grupo_id, g.titulo, g.descricao, g.status, g.max_membros, g.data_criacao, j.jogo_id, j.titulo AS jogo,
           u.nome_usuario AS lider, i.nome_idioma AS idioma,
           (SELECT count(*)::int FROM membros_grupo m WHERE m.grupo_id = g.grupo_id) AS membros,
           ($1::int IS NOT NULL AND EXISTS (SELECT 1 FROM membros_grupo m WHERE m.grupo_id = g.grupo_id AND m.usuario_id = $1)) AS participando
    FROM grupos g JOIN jogos j ON j.jogo_id = g.jogo_id JOIN usuarios u ON u.usuario_id = g.lider_id
    LEFT JOIN idiomas i ON i.idioma_id = g.idioma_id`;
  app.get('/api/grupos', async (req, res) => {
    const jogo = req.query.jogo ? idDe(req.query.jogo) : null;
    res.json(await q(`${GRUPO_SQL} WHERE g.status <> 'fechado' AND ($2::int IS NULL OR g.jogo_id = $2) ORDER BY (g.status = 'aberto') DESC, g.data_criacao DESC LIMIT 60`, [req.uid ?? null, jogo]));
  });
  app.get('/api/grupos/:id', async (req, res) => {
    const g = await um(`${GRUPO_SQL} WHERE g.grupo_id = $2`, [req.uid ?? null, idDe(req.params.id)]);
    if (!g) return res.status(404).json({ erro: 'Grupo nao encontrado.' });
    g.integrantes = await q(`SELECT u.nome_usuario, m.cargo, m.data_entrada, u.reputacao::float AS reputacao
      FROM membros_grupo m JOIN usuarios u ON u.usuario_id = m.usuario_id WHERE m.grupo_id = $1 ORDER BY m.data_entrada`, [g.grupo_id]);
    res.json(g);
  });
  app.post('/api/grupos', exige, limite('grupo', 20, 3600e3), async (req, res) => {
    const d = valida(z.object({
      jogo_id: z.number().int().positive(), titulo: z.string().trim().min(3, 'Titulo muito curto.').max(100),
      descricao: z.string().max(500).optional(), max_membros: z.number().int().min(2).max(100).default(5), idioma: z.string().max(5).optional(),
    }), req.body);
    const g = await um(`INSERT INTO grupos (lider_id, jogo_id, titulo, descricao, max_membros, idioma_id)
      VALUES ($1, $2, $3, $4, $5, (SELECT idioma_id FROM idiomas WHERE codigo_iso = lower($6))) RETURNING grupo_id`,
      [req.uid, d.jogo_id, d.titulo, d.descricao ?? null, d.max_membros, d.idioma ?? null]);
    res.status(201).json(g);
  });
  app.post('/api/grupos/:id/entrar', exige, async (req, res) => {
    const id = idDe(req.params.id);
    if (!(await um('SELECT 1 FROM grupos WHERE grupo_id = $1', [id]))) return res.status(404).json({ erro: 'Grupo nao encontrado.' });
    await q('INSERT INTO membros_grupo (grupo_id, usuario_id) VALUES ($1, $2)', [id, req.uid]);
    res.json({ ok: true });
  });
  app.post('/api/grupos/:id/sair', exige, async (req, res) => {
    const id = idDe(req.params.id);
    const g = await um('SELECT lider_id FROM grupos WHERE grupo_id = $1', [id]);
    if (!g) return res.status(404).json({ erro: 'Grupo nao encontrado.' });
    if (g.lider_id === req.uid) return res.status(400).json({ erro: 'O lider nao pode sair do proprio grupo.' });
    await q('DELETE FROM membros_grupo WHERE grupo_id = $1 AND usuario_id = $2', [id, req.uid]);
    res.json({ ok: true });
  });
  app.post('/api/avaliacoes', exige, async (req, res) => {
    const d = valida(z.object({ avaliado: z.string().min(1), grupo_id: z.number().int().positive(), nota: z.number().int().min(1).max(5), comentario: z.string().max(300).optional() }), req.body);
    const alvo = await quem(d.avaliado);
    await q(`INSERT INTO avaliacoes (avaliador_id, avaliado_id, grupo_id, nota, comentario) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (avaliador_id, avaliado_id, grupo_id) DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario, data_avaliacao = now()`,
      [req.uid, alvo, d.grupo_id, d.nota, d.comentario ?? null]);
    res.status(201).json({ ok: true });
  });

  // ---------- mensagens ----------
  app.get('/api/conversas', exige, async (req, res) => res.json(await q(`
    SELECT DISTINCT ON (o.usuario_id) o.nome_usuario, p.cor_avatar, m.texto AS ultima, m.enviada_em AS quando,
           COALESCE(p.ultimo_acesso > now() - interval '15 minutes', false) AS online
    FROM mensagens m
    JOIN usuarios o ON o.usuario_id = CASE WHEN m.remetente_id = $1 THEN m.destinatario_id ELSE m.remetente_id END
    LEFT JOIN perfis_jogador p ON p.usuario_id = o.usuario_id
    WHERE m.remetente_id = $1 OR m.destinatario_id = $1
    ORDER BY o.usuario_id, m.enviada_em DESC`, [req.uid])));
  app.get('/api/mensagens/:nome', exige, async (req, res) => {
    const o = await quem(req.params.nome);
    res.json(await q(`SELECT (m.remetente_id = $1) AS minha, m.texto, m.enviada_em FROM mensagens m
      WHERE (m.remetente_id = $1 AND m.destinatario_id = $2) OR (m.remetente_id = $2 AND m.destinatario_id = $1)
      ORDER BY m.enviada_em, m.mensagem_id LIMIT 300`, [req.uid, o]));
  });
  app.post('/api/mensagens/:nome', exige, limite('msg', 60, 60e3), async (req, res) => {
    const d = valida(z.object({ texto: z.string().trim().min(1, 'Digite uma mensagem.').max(2000, 'Mensagem muito longa.') }), req.body);
    const o = await quem(req.params.nome);
    if (o === req.uid) return res.status(400).json({ erro: 'Voce nao pode enviar mensagem para si mesmo.' });
    await q('INSERT INTO mensagens (remetente_id, destinatario_id, texto) VALUES ($1, $2, $3)', [req.uid, o, d.texto]);
    res.status(201).json({ ok: true });
  });

  // ---------- forum ----------
  app.get('/api/jogos/:id/forum', async (req, res) => {
    const id = idDe(req.params.id);
    res.json(await q(`
      SELECT t.topico_id, t.titulo, t.corpo, t.criado_em, u.nome_usuario AS autor,
             (SELECT count(*)::int FROM curtidas_forum c WHERE c.topico_id = t.topico_id) AS curtidas,
             ($2::int IS NOT NULL AND EXISTS (SELECT 1 FROM curtidas_forum c WHERE c.topico_id = t.topico_id AND c.usuario_id = $2)) AS curti,
             COALESCE((SELECT json_agg(json_build_object('autor', ru.nome_usuario, 'corpo', r.corpo, 'quando', r.criada_em) ORDER BY r.criada_em)
                       FROM respostas_forum r JOIN usuarios ru ON ru.usuario_id = r.autor_id WHERE r.topico_id = t.topico_id), '[]') AS respostas
      FROM topicos_forum t JOIN usuarios u ON u.usuario_id = t.autor_id
      WHERE t.jogo_id = $1 ORDER BY t.criado_em DESC LIMIT 50`, [id, req.uid ?? null]));
  });
  app.post('/api/jogos/:id/forum', exige, limite('topico', 20, 3600e3), async (req, res) => {
    const d = valida(z.object({ titulo: z.string().trim().min(3, 'Titulo muito curto.').max(100), corpo: z.string().trim().min(1).max(1500) }), req.body);
    const r = await um('INSERT INTO topicos_forum (jogo_id, autor_id, titulo, corpo) SELECT jogo_id, $2, $3, $4 FROM jogos WHERE jogo_id = $1 RETURNING topico_id', [idDe(req.params.id), req.uid, d.titulo, d.corpo]);
    if (!r) return res.status(404).json({ erro: 'Jogo nao encontrado.' });
    res.status(201).json(r);
  });
  app.post('/api/forum/:id/respostas', exige, limite('resp', 40, 3600e3), async (req, res) => {
    const d = valida(z.object({ corpo: z.string().trim().min(1, 'Escreva a resposta.').max(1500) }), req.body);
    const r = await um('INSERT INTO respostas_forum (topico_id, autor_id, corpo) SELECT topico_id, $2, $3 FROM topicos_forum WHERE topico_id = $1 RETURNING resposta_id', [idDe(req.params.id), req.uid, d.corpo]);
    if (!r) return res.status(404).json({ erro: 'Topico nao encontrado.' });
    res.status(201).json(r);
  });
  app.post('/api/forum/:id/curtir', exige, async (req, res) => {
    const id = idDe(req.params.id);
    if (!(await um('SELECT 1 FROM topicos_forum WHERE topico_id = $1', [id]))) return res.status(404).json({ erro: 'Topico nao encontrado.' });
    const tirou = await q('DELETE FROM curtidas_forum WHERE topico_id = $1 AND usuario_id = $2 RETURNING 1', [id, req.uid]);
    if (!tirou.length) await q('INSERT INTO curtidas_forum (topico_id, usuario_id) VALUES ($1, $2)', [id, req.uid]);
    res.json({ curti: !tirou.length });
  });

  app.get('/api/saude', async (_req, res) => { await q('SELECT 1'); res.json({ ok: true }); });
  app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota nao encontrada.' }));

  // erros: mensagens do banco (regras dos triggers e restricoes) viram respostas claras
  app.use((e, _req, res, _next) => {
    if (e.status) return res.status(e.status).json({ erro: e.message });
    if (e.code === '23505') return res.status(409).json({ erro: /nome_usuario/.test(e.detail || e.message) ? 'Este nome de usuario ja esta em uso.' : /email/.test(e.detail || e.message) ? 'Este e-mail ja esta cadastrado.' : 'Este registro ja existe.' });
    if (e.code === 'P0001') return res.status(400).json({ erro: e.message });
    if (e.code === '23514' || e.code === '23503' || e.code === '22P02') return res.status(400).json({ erro: 'Dados invalidos.' });
    if (e.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON invalido.' });
    console.error(e);
    res.status(500).json({ erro: 'Erro interno. Tente de novo.' });
  });
  return app;
}
