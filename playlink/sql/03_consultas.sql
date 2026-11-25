-- PLAYLINK - consultas de demonstracao (cada uma e usada por uma tela do site)
SET search_path = playlink, public;

-- 1) Jogadores em destaque: quem esta online aparece primeiro, com os jogos que joga
SELECT u.nome_usuario, p.estilo, p.nivel, p.horario_disponivel,
       (p.ultimo_acesso > now() - interval '15 minutes') AS online,
       string_agg(j.titulo, ', ' ORDER BY j.titulo) AS jogos
FROM usuarios u
JOIN perfis_jogador p ON p.usuario_id = u.usuario_id
LEFT JOIN usuario_jogos uj ON uj.usuario_id = u.usuario_id
LEFT JOIN jogos j ON j.jogo_id = uj.jogo_id
GROUP BY u.usuario_id, p.estilo, p.nivel, p.horario_disponivel, p.ultimo_acesso
ORDER BY online DESC NULLS LAST, u.nome_usuario;

-- 2) Match: jogadores com jogos em comum E horario igual ao do usuario 'toniz2'
SELECT o.nome_usuario AS combina_com, po.horario_disponivel,
       count(*) AS jogos_em_comum, string_agg(j.titulo, ', ') AS quais
FROM usuarios eu
JOIN perfis_jogador pe ON pe.usuario_id = eu.usuario_id
JOIN usuario_jogos ue ON ue.usuario_id = eu.usuario_id
JOIN usuario_jogos uo ON uo.jogo_id = ue.jogo_id AND uo.usuario_id <> eu.usuario_id
JOIN usuarios o ON o.usuario_id = uo.usuario_id
JOIN perfis_jogador po ON po.usuario_id = o.usuario_id AND po.horario_disponivel = pe.horario_disponivel
JOIN jogos j ON j.jogo_id = ue.jogo_id
WHERE eu.nome_usuario = 'toniz2'
GROUP BY o.nome_usuario, po.horario_disponivel
ORDER BY jogos_em_comum DESC, o.nome_usuario;

-- 3) Grupos abertos com vagas (visao pronta)
SELECT titulo, jogo, lider, membros, max_membros, vagas FROM v_grupos_abertos ORDER BY vagas DESC, titulo;

-- 4) Tendencias da comunidade (visao pronta)
SELECT titulo, grupos, jogadores, topicos, pontos FROM v_tendencias ORDER BY pontos DESC, titulo LIMIT 5;

-- 5) Reputacao: ranking dos melhores jogadores (media das notas e quantas avaliacoes recebeu)
SELECT u.nome_usuario, u.reputacao, count(a.avaliacao_id) AS avaliacoes
FROM usuarios u LEFT JOIN avaliacoes a ON a.avaliado_id = u.usuario_id
GROUP BY u.usuario_id ORDER BY u.reputacao DESC, avaliacoes DESC LIMIT 5;

-- 6) Conversa entre dois jogadores em ordem cronologica
SELECT r.nome_usuario AS de, m.texto, m.enviada_em
FROM mensagens m JOIN usuarios r ON r.usuario_id = m.remetente_id
WHERE LEAST(m.remetente_id, m.destinatario_id) = (SELECT least(a.usuario_id, b.usuario_id) FROM usuarios a, usuarios b WHERE a.nome_usuario='toniz2' AND b.nome_usuario='vitorbr')
  AND GREATEST(m.remetente_id, m.destinatario_id) = (SELECT greatest(a.usuario_id, b.usuario_id) FROM usuarios a, usuarios b WHERE a.nome_usuario='toniz2' AND b.nome_usuario='vitorbr')
ORDER BY m.enviada_em;

-- 7) Forum: topicos de um jogo com numero de respostas e curtidas
SELECT t.titulo, u.nome_usuario AS autor,
       (SELECT count(*) FROM respostas_forum r WHERE r.topico_id = t.topico_id) AS respostas,
       (SELECT count(*) FROM curtidas_forum c WHERE c.topico_id = t.topico_id) AS curtidas
FROM topicos_forum t JOIN usuarios u ON u.usuario_id = t.autor_id JOIN jogos j ON j.jogo_id = t.jogo_id
WHERE j.titulo = 'Valorant' ORDER BY t.criado_em DESC;
