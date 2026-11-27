# Arquitetura do Resenha

Visão geral do que existe hoje. Passo a passo de hospedagem: `README.md`. Capacidade e custos: `docs/CAPACIDADE.md`. Decisões e alternativas descartadas: `docs/DECISIONS.md`.

## Mapa do repositório (npm workspaces: `server`, `client`)
| Pasta | O que é |
|---|---|
| `server/src` | API REST (Express 5) + tempo real (Socket.IO) + banco. Um arquivo por assunto (veja abaixo) |
| `client/src` | Site/app (React 19, Vite, zustand). `components/`, `lib/`, `store/`, `voice/` (WebRTC, ruído, transmissão) |
| `shared/` | Tipos e regras comuns (`types.ts`, `permissions.ts`, `embedUrl.ts`) |
| `desktop/` | App de Windows (Electron, versão 0.3.x): captura de tela/áudio, overlay, Spotify local, atualização automática |
| `android/` | App Android (WebView que abre o site, 1.0.x): notificação de call, atualização própria |
| `e2e/` | ~100 testes de ponta a ponta (`.mjs`/`.ts`) + `e2e/capacity/` (carga) |
| `scripts/` | `security-scan.mjs` (segredos no repo, histórico e `client/dist`) |
| `exemplos/bot-exemplo` | Bot de terceiros de exemplo (Vercel) + guia |
| `playlink/` | Projeto acadêmico **separado** do Resenha (não faz parte do produto) |
| `promo/` | Material de divulgação (vídeos, artes). Não é código do produto |
| `docs/`, `SECURITY_AUDIT.md` | Documentação |

## Servidor (`server/src`)
- **Núcleo:** `index.ts` (boot, cabeçalhos, estáticos, erros), `config.ts` (variáveis de ambiente), `db.ts` (esquema idempotente criado **no boot** com `create table if not exists`/`alter … add column if not exists`; Postgres via `DATABASE_URL`, senão PGlite local), `routes.ts` (rotas principais), `realtime.ts` (Socket.IO: presença, voz, transmissão, "assistir juntos", bots DJ), `http.ts` (`parse` zod + `wrap`), `security.ts` (cabeçalhos/CSP, `limit()`, sessões, 2FA, exportar/excluir conta).
- **Contas/segurança:** `auth.ts` (scrypt, sessão opaca em cookie `__Host-`), `account.ts` (e-mail, senha vazada HIBP, Turnstile), `vault.ts` (AES-256-GCM para segredos de 2FA/bots com `SECRETS_KEY`), `names.ts` (anti-imitação), `killswitch.ts` (chaves de emergência + revogar sessões), `blocks.ts` (bloqueio de pessoas), `audit.ts`.
- **Comunidade:** `guilds.ts`, `access.ts` (permissões: bitmask + overrides de canal), `social.ts` (amigos/DMs), `community.ts` (enquetes, automod, eventos), `unread.ts`, `expressions.ts`, `profile.ts`, `official.ts`/`welcome.ts`, `explore.ts`/`listing.ts`, `reports.ts`, `support.ts`, `suspension.ts`, `apoio.ts` (Pix manual), `signupCodes.ts`/`waitlist.ts`.
- **Mídia/arquivos:** `attachments.ts`, `files.ts`, `sanitize.ts` (re-encode de imagem, tipos), `storage.ts` (R2 ou banco), `backup.ts` (criptografado), `embeds.ts` (YouTube/Spotify), `ice.ts` (TURN), `sfu.ts` (laboratório Cloudflare).
- **Bots:** `bots.ts` (Resenha Bot, comandos `/`), `botKit.ts`, `botDj.ts` (música), `botGames.ts`, `botTickets.ts`, `botAi.ts`+`ai.ts` (IA, desligada), `botApps.ts` (bots de terceiros: token, webhook assinado, API), `safeFetch.ts` (cliente HTTP anti-SSRF), `ytDuration.ts`. Guia: `docs/BOTS-API.md`.
- **Operação:** `health.ts`, `capacity.ts`, `bandwidth.ts`, `stats.ts`, `push.ts` (web push), `beta.ts` (liberação por conta), `phoneCam.ts` (câmera do celular).

## Tempo real e chamadas
- Socket.IO autenticado no handshake (cookie ou token), `Origin` validado, limites por conexão/evento.
- **Voz/vídeo: malha P2P (WebRTC)** entre os aparelhos; o servidor só faz sinalização. Criptografia DTLS-SRTP. TURN para redes móveis (Metered grátis ou Cloudflare). Transmissão "turbo": codifica uma vez (WebCodecs) e envia por DataChannel. SFU Cloudflare existe só em **laboratório**.
- "Assistir juntos" e DJ: estado no servidor (`together`), cada aparelho toca o player do YouTube e se sincroniza; DJ é só áudio (player invisível) e **cada pessoa escolhe ouvir**.
- Câmera do celular: pareamento por QR Code (token em memória, 2 min, uso único) e sinalização própria `phonecam:*`.

## Dados e serviços externos (todos em plano grátis)
| Serviço | Para quê | Observação |
|---|---|---|
| Render (web, plano grátis) | Hospeda o servidor; deploy automático da branch de trabalho | 750 h/mês compartilhadas; 512 MB, ~0,1 CPU; dorme se ocioso (cold start devolve 502 por ~1 min) |
| Neon (Postgres) | Banco permanente | 0,5 GB; o app executa DDL no boot, logo usa uma role com permissão de alterar esquema |
| Cloudflare | DNS/CDN/proteção do domínio; R2 (arquivos, 10 GB); Turnstile (captcha); TURN/SFU opcionais | Origem do Render ainda é pública |
| Brevo | E-mails de segurança (300/dia) | SPF/DKIM/DMARC pendentes (`docs/EMAIL.md`) |
| Metered | TURN grátis com cota (`TURN_QUOTA_MB`) | alerta no painel a 80% |
| YouTube Data API | Busca do DJ e duração da faixa | 10 000 unidades/dia; busca custa 100 |
| GitHub | Código público, Actions (CI, builds Android/Windows), Dependabot, CodeQL | Actions fixadas por SHA |
| Vercel/Supabase | **Não** usados pelo Resenha; só pelo exemplo de bot e pelo projeto `playlink` | decisão em `docs/DECISIONS.md` |

Variáveis de ambiente (apenas nomes; valores só no Render): ver `render.yaml` e `server/src/config.ts`. Principais: `DATABASE_URL`, `PLATFORM_ADMINS`, `R2_*`, `TURNSTILE_*`, `EMAIL_*`, `BACKUP_KEY`, `SECRETS_KEY`, `ADMIN_REQUIRE_2FA`, `METERED_*`/`CLOUDFLARE_TURN_*`, `YOUTUBE_API_KEY`, `VAPID_*`, `BOTS_AI`, `AI_*` (teto de gasto), `APP_ENV`.

## Feature flags e chaves em `app_settings`
- `beta`: `{layout2, phonecam, bots, botdev, open[]}`: listas de contas por recurso; `open` = liberado a todos (hoje `layout2` e `phonecam`).
- `killswitch`: `uploads, invites, dms, calls, bots` (desligar sem deploy). `signup-open`: cadastro aberto/fechado. `test_guild`, servidor oficial, etc.
- Nomes de contas liberadas ficam **só no banco**, nunca no código.

## Bots de terceiros (resumo)
Bot = usuário `is_bot` + `bot_apps` (token com hash, segredo de assinatura cifrado). Comando `/x` → `POST` HTTPS assinado (HMAC + carimbo) ao endereço do bot via `safeFetch` (https/443, DNS conferido e IP fixado, sem redirect, prazo total 3 s, 32 KB). O bot responde com JSON ou usa a API `/api/bot/*` com `Authorization: Bot <token>` (120 chamadas/min). Só age onde foi instalado, com permissões de membro comum.

## Segurança em camadas (onde olhar)
Cabeçalhos/CSP e sessão: `security.ts`/`auth.ts`. Autorização: `access.ts` + testes `authz-matrix.mjs`. Limites: `limit()` + `realtime.ts`. Uploads: `sanitize.ts`, `attachments.ts`. SSRF: `safeFetch.ts`, `embeds.ts`. Segredos em repouso: `vault.ts`. Resposta a incidentes: `docs/INCIDENTES.md`. Auditoria completa: `SECURITY_AUDIT.md`.

## Testes e CI
- `e2e/*.mjs` sobem o servidor com `DATA_DIR` temporário (`e2e/_tmp.mjs`), usam Playwright (Chromium com câmera/microfone falsos) e `socket.io-client`. `e2e/_ui.mjs` tem `autoConfirm`.
- CI (`.github/workflows/checks.yml`): segredos, typecheck, build, testes de segurança de API, `npm audit`. Outros workflows: `codeql.yml`, `desktop.yml` (instalador Windows), `android.yml` (APK de teste a cada mudança em `android/**`).
