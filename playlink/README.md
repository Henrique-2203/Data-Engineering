# PLAYLINK - rede social para gamers (trabalho de faculdade)

Plataforma LFG (Looking For Group): jogadores criam conta e perfil, dizem quais jogos jogam e em que horario,
formam grupos, se avaliam, conversam e discutem no forum de cada jogo. Integra com o Resenha (chat gratuito)
pelo vinculo de contas (campo "usuario no Resenha" no perfil + botao "Adicionar no Resenha").

## O que tem aqui
| Pasta/arquivo | O que e |
|---|---|
| `diagrama-aprovado.jpg` | Diagrama do banco aprovado pelo professor |
| `sql/01_schema.sql` | Tabelas, restricoes, indices, triggers e visoes (PostgreSQL) |
| `sql/02_dados_exemplo.sql` | Dados de demonstracao |
| `sql/03_consultas.sql` | Consultas usadas pelas telas (jogadores, match, grupos, tendencias, reputacao...) |
| `sql/testar.mjs` | Roda o SQL num PostgreSQL de teste e confere as regras do banco |
| `src/app.js` | API (Express): cadastro/login, perfis, match, grupos, avaliacoes, mensagens, forum |
| `public/` | O site (HTML/CSS/JS) ligado a API |
| `site-original/` | O site antes de ser ligado ao banco (so front-end, dados no navegador) |
| `test/api.mjs`, `test/site.mjs` | Testes da API e do site no navegador |

Tabelas do diagrama: paises, idiomas, categorias, usuarios, jogos, grupos, membros_grupo, avaliacoes.
Tabelas de extensao (o site usa e o diagrama nao cobre): perfis_jogador, usuario_jogos, seguidores,
mensagens, topicos_forum, respostas_forum, curtidas_forum, vinculo_resenha.

Regras que ficam no proprio banco (triggers): o lider entra sozinho no grupo; grupo cheio recusa novos
integrantes e muda de status sozinho; so avalia quem participou do mesmo grupo; a reputacao do usuario e
sempre a media das notas recebidas.

## Rodar no seu computador
```
cd playlink
npm install
npm test                    # (opcional) testa API; sql/testar.mjs e test/site.mjs testam o resto
node server.js              # sem DATABASE_URL usa um banco de teste em memoria
```
Abra http://localhost:3100. Com um PostgreSQL de verdade:
```
DATABASE_URL="postgresql://usuario:senha@host:5432/banco" npm run db:setup   # cria tabelas e dados de exemplo
DATABASE_URL="postgresql://usuario:senha@host:5432/banco" SESSION_SECRET="uma frase longa" node server.js
```

## Publicar (gratis): banco no Supabase + site na Vercel
Pensado para NAO usar nada do Resenha (outro banco, outra hospedagem).
1. **Banco (Supabase)**: crie um projeto em supabase.com. Em *SQL Editor*, cole e execute `sql/01_schema.sql` e depois
   `sql/02_dados_exemplo.sql`. Em *Project Settings > Database > Connection string*, copie a URL do **Transaction pooler**
   (porta 6543) - ela e a DATABASE_URL.
2. **Site (Vercel)**: em vercel.com, *Add New > Project*, escolha este repositorio e em *Root Directory* coloque `playlink`.
   Em *Environment Variables* crie `DATABASE_URL` (a do passo 1) e `SESSION_SECRET` (uma frase longa e secreta).
   Clique em Deploy. O endereco `https://....vercel.app` e o link do trabalho.
3. Para remover depois: apague o projeto na Vercel e no Supabase e a pasta `playlink/` do repositorio.

## Seguranca
Senhas guardadas com hash (scrypt); sessao em cookie HttpOnly assinado; consultas parametrizadas (sem SQL concatenado);
textos escapados antes de aparecer na tela; limite de tentativas no login/cadastro/mensagens.
