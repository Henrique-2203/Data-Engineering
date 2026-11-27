# Resenha BR — instruções para o Claude Code

Alternativa gratuita ao Discord (chat, voz, vídeo, transmissão de tela, bots). Repositório **público**. Dono do projeto: pessoa única, não programadora; explique tudo em **português do Brasil, em linguagem simples e passo a passo**.

## Leia antes de começar (nesta ordem)
1. `docs/HANDOFF.md`: onde paramos e o que fazer primeiro.
2. `docs/PROJECT_STATUS.md` e `docs/KNOWN_ISSUES.md`: o que está pronto, experimental e não validado.
3. Sob demanda: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `SECURITY_AUDIT.md`, `docs/BOTS-API.md`, `docs/INCIDENTES.md`, `docs/CAPACIDADE.md`, `docs/LANCAMENTOS.md`, `docs/EMAIL.md`, `docs/ETAPAS-E-TESTES.md`, `README.md`.

## Comandos
- `npm ci` · `npm run dev` · `npm run typecheck` · `npm run build` (obrigatório antes de testes de tela) · `npm run security:scan`
- Um teste: `node e2e/<nome>.mjs` (alguns `.ts`: `node --import tsx e2e/<nome>.ts`). Segurança: `npm run test:security`. Testes sobem o próprio servidor com banco temporário (PGlite); nunca tocam produção.
- Rode **sequencialmente**: vários em paralelo disputam CPU e geram falhas falsas (ex.: `smoke`).

## Branch, deploy e commits
- Trabalhe **só** em `claude/screen-sharing-app-w2m6ft`; `git push -u origin claude/screen-sharing-app-w2m6ft` (tente de novo em erro de rede). O Render faz deploy automático dessa branch: **cada push vai para o ar**, então só dê push com typecheck + testes relevantes verdes.
- **Não crie Pull Request** nem mexa em `main` sem o dono pedir. Nada de force-push.
- Termine os commits com as linhas de atribuição que o ambiente indicar. Não escreva identificador de modelo em mensagens de commit, código ou docs.
- Um commit por assunto, mensagem em português dizendo o quê e por quê.

## Regras permanentes (o dono já decidiu)
- **Privacidade/repo público:** nunca coloque nomes de usuários reais, e-mails, fotos, nomes de apoiadores/valores ou dados de pessoas em código, testes, docs ou commits (use `ana`, `bia`, `equipe`…). `scripts/security-scan.mjs` e o CI barram segredos.
- **Segredos:** nunca peça nem aceite chave/senha/token no chat; vão para variáveis do Render ou formulário do ambiente. Nunca grave em arquivo. Se algo vazar: pare, avise para **rotacionar** (`docs/INCIDENTES.md`).
- **Honestidade nos textos do produto:** mensagens de texto **não** são E2E (só chamadas: DTLS-SRTP). Não afirmar "servidor no Brasil". Sem texto "feito por IA" em vídeos/artes de divulgação. Nomes/valores de apoiadores só para a equipe.
- **Custo zero por padrão:** tudo roda em planos grátis (Render 750 h compartilhadas, Neon 0,5 GB, R2 10 GB, Brevo 300 e-mails/dia, TURN com cota, YouTube API 10 000 unidades/dia). **Não adicione serviço pago nem dependência que gere custo sem perguntar.** Recursos com custo (IA, TURN extra) ficam desligados ou com teto.
- **Bots de terceiros e bots de IA** ficam restritos às contas da lista (`app_settings 'beta'`) até o dono marcar "Para todos" no Painel da equipe. IA dos bots só com `BOTS_AI=1`.
- Não afirmar que algo funciona sem teste: separe **testado**, **não validado em aparelho real** e **hipótese**.

## Convenções de código
- TypeScript estrito; servidor Express 5 + Socket.IO + zod; cliente React 19 + Vite + zustand. `shared/` é compartilhado.
- **Toda rota nova**: `auth` por padrão, entrada validada com `parse(zod)` (limpa caracteres invisíveis), checagem de permissão/pertencimento **no servidor** (`channelForMember`, `requirePerm`), `limit()` de taxa, nunca confiar em ids/papéis do cliente. Rotas públicas entram na lista de `e2e/authz-matrix.mjs` (o teste falha se esquecer).
- **Toda correção ou recurso**: escreva um teste que falhe sem a mudança; novos de segurança entram em `npm run test:security` e no CI (`.github/workflows/checks.yml`). Atualize `SECURITY_AUDIT.md` quando mexer em segurança.
- **Nunca** use `confirm()`/`alert()`/`prompt()` nativos (somem em Android/Electron): use `askConfirm`/`askNotice`/`askText` de `client/src/lib/ask.tsx`. Em testes use `e2e/_ui.mjs` (`autoConfirm`).
- Textos de UI em português, curtos e claros. Erros de bot usam status **424** (hospedagem troca 5xx por "Erro 502").
- Segurança de imagens: toda imagem é re-encodada; imagem externa só carrega com clique. Nomes que imitam a equipe passam por `server/src/names.ts`.
- Testes de tela dependem do `client/dist` atualizado (`npm run build`).
- Armadilha: no shell/heredoc, `\uXXXX` vira caractere literal; monte com `String.fromCharCode`.
- Não altere `android/release.json` nem publique versões (Android/Windows) sem o dono aprovar.

## Quando terminar uma tarefa
Typecheck + testes relevantes + `npm run security:scan` verdes → commit → push → resumo em pt-BR dizendo o que mudou, o que foi testado e o que **não** foi validado. Atualize `docs/PROJECT_STATUS.md`, `docs/KNOWN_ISSUES.md` e `docs/HANDOFF.md` quando o estado mudar.
