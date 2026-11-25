# PLAYLINK - rede social para gamers (trabalho de faculdade)

Plataforma LFG (Looking For Group): jogadores criam perfil, dizem quais jogos jogam e em que horario,
formam grupos, se avaliam e conversam. Integra com o Resenha (chat gratuito) pelo vinculo de contas.

- `diagrama-aprovado.jpg`: diagrama do banco aprovado pelo professor.
- `sql/01_schema.sql`: tabelas, restricoes, indices, triggers e visoes (PostgreSQL).
- `sql/02_dados_exemplo.sql`: dados de demonstracao.
- `sql/03_consultas.sql`: consultas usadas pelas telas do site.
- `sql/testar.mjs`: roda tudo num PostgreSQL de teste e confere as regras (`node playlink/sql/testar.mjs`).
- `site-original/`: o site (so front-end) como estava antes de ser ligado ao banco.

Tabelas do diagrama: paises, idiomas, categorias, usuarios, jogos, grupos, membros_grupo, avaliacoes.
Tabelas de extensao (o site usa, o diagrama nao cobre): perfis_jogador, usuario_jogos, seguidores,
mensagens, topicos_forum, respostas_forum, curtidas_forum, vinculo_resenha.
