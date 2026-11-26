# Resenha — SECURITY_AUDIT.md

Auditoria do `RESENHA_SECURITY_CHECKLIST.md` contra o código real. Legenda: **OK** (protegido e provado por teste) · **PARCIAL** (existe, com limite conhecido) · **FALTA** (não existe) · **N/A** (não se aplica à nossa arquitetura) · **DONO** (ação que só o dono pode fazer: conta, painel, jurídico).

**Como reproduzir tudo:** `npm run build && npm run test:security` (suíte de segurança) e `npm run security:scan` (segredos). A suíte de abuso, a matriz de autorização, o teste de WebSocket, uploads, bots e as chaves de emergência também rodam no CI (`.github/workflows/checks.yml`).

**Evidência** aponta para o arquivo (e a função/rota) e o **teste** é o arquivo em `e2e/` que prova. Testes marcados "falhava sem a correção" foram escritos para os problemas reais encontrados nesta auditoria (lista na seção 2).

## 1. Resumo

| Resultado | Quantidade (aprox.) |
|---|---|
| OK | maioria dos itens P0 |
| PARCIAL | 18 |
| FALTA | 9 (7 são decisões de produto/jurídico ou custo) |
| DONO | 12 |

**Os 5 pontos que mais merecem atenção (em ordem):**
1. **DONO** — ligar **MFA** em GitHub, Render, Neon, Cloudflare, registrador do domínio e e-mail principal; ligar **branch protection** e **secret scanning/push protection** no GitHub (SEC-07/09/02).
2. **DONO** — definir `SECRETS_KEY` no Render (cifra 2FA e segredos de bots em repouso) e, se possível, `ADMIN_REQUIRE_2FA=1`.
3. **PARCIAL** — o bloqueio de usuários (DM-01) já existe; falta a configuração "quem pode me chamar" (DM-02: todos / amigos / ninguém).
4. **DONO/jurídico** — idade mínima/verificação (ECA Digital), retenção, encarregado (DPO), registros de acesso (Marco Civil). Seção 15.
5. **PARCIAL** — o app usa a role dona do banco no Neon (DB-03): criar uma role só com SELECT/INSERT/UPDATE/DELETE.

## 2. Falhas reais encontradas e corrigidas nesta auditoria

Todas têm teste que falha sem a correção.

| # | Falha | Correção | Teste |
|---|---|---|---|
| 1 | `POST /channels/:id/read` aceitava qualquer canal (IDOR no marcador de leitura) | checa acesso ao canal | `authz-matrix.mjs` |
| 2 | Sem limite de tentativas em códigos de convite (força bruta) | limite por IP e por usuário | `abuse.mjs` |
| 3 | Admin da plataforma podia **apagar a própria conta** (liberava o nome para tomada → virar "admin") | `/me/delete` recusa contas da equipe | `abuse.mjs` |
| 4 | Presença, atividade e perfil eram transmitidos a **todos** os usuários conectados | só a quem compartilha servidor/amizade (`relatedTo`/`emitRelated`) | `ws-abuse.mjs` |
| 5 | Logout não fechava o WebSocket aberto | `endSessions` no logout | `ws-abuse.mjs` |
| 6 | Imagens "poliglotas" (imagem + payload) passavam | **toda** imagem é re-encodada | `upload-abuse.mjs` |
| 7 | Equipe conseguia abrir link de anexo de qualquer canal | bypass removido | `upload-abuse.mjs` |
| 8 | Sem teto de canais/cargos/categorias/servidores por pessoa | tetos + limite de criação | `abuse.mjs` |
| 9 | Login revelava se o usuário existe pelo **tempo** de resposta | `fakeVerify` | `auth-unit.ts` |
| 10 | scrypt com parâmetros fracos | N=2¹⁶, migração transparente no login | `auth-unit.ts` |
| 11 | Só limite por conta no login (credential stuffing por IP) | teto de falhas por IP | `abuse.mjs` |
| 12 | Sessão sem validade absoluta | máx. 180 dias (cookie também) | `auth-unit.ts` |
| 13 | Token de bot sem proteção a força bruta | limite por IP, falhas contam | `bots-abuse.mjs` |
| 14 | Corpo grande demais devolvia 500 | 413 limpo | `abuse.mjs` |
| 15 | Imagem externa em mensagem vazava o IP de quem lê | só carrega **depois de clicar** (e "sempre deste site") | `xss.mjs` |
| 16 | Nomes imitando a equipe/“Resenha” (inclui homóglifos) | `names.ts` (skeleton/confusables) em cadastro, perfil, servidor e bot | `abuse.mjs`, `bots-abuse.mjs` |
| 17 | Caracteres bidi/zero-width em textos | `cleanDeep` em toda entrada validada | `abuse.mjs` |
| 18 | Segredo TOTP e segredo de assinatura de bot em texto claro no banco | cifrados (AES-256-GCM) com `SECRETS_KEY` | `auth-unit.ts` |
| 19 | `rtc:signal` aceitava qualquer formato/tamanho | objeto com `type`, ≤64 KB | `ws-abuse.mjs` |
| 20 | Respostas da API podiam ser guardadas em cache | `Cache-Control: no-store` em `/api` | `abuse.mjs` |
| 21 | Sem "chaves de emergência" nem revogação em massa | `killswitch.ts` + painel | `killswitch.mjs` |
| 22 | Atividade de bots sem SSRF/limites (API de bots de terceiros nova) | `safeFetch.ts`, https/443, DNS fixado, IP privado bloqueado, sem redirect | `safe-fetch.mjs`, `bots-abuse.mjs`, `bots-apps.mjs` |
| 23 | Imagem com cabeçalho válido e corpo corrompido gerava erro 500 (achado da regressão) | recusa limpa 415 (413 para bomba de pixels) | `explore.mjs`, `upload-abuse.mjs` |

## 3. Tabela de status

### 1. Modelo de ameaças
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| THR-01…03 | PARCIAL | ativos/atacantes/superfícies resumidos neste arquivo, seções 1–2 e 4 | — | documento curto vivo; revisar a cada feature (THR-05) |
| THR-04 | PARCIAL | "Definição de pronto" abaixo (seção 5) | — | disciplina de processo |

### 2. Autenticação e sessão
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| AUTH-01 | PARCIAL | `auth.ts` scrypt N=2¹⁶ r=8 p=1, salt por senha, comparação em tempo constante | `auth-unit.ts` | checklist pede Argon2id; scrypt com esses parâmetros é aprovado pela OWASP. Migrar exigiria dependência nativa |
| AUTH-02 | OK | `security.ts` `passwordSchema` (mín. de tamanho) + `account.ts` `pwnedCount` (HIBP k-anonymity, `PWNED_CHECK`) | `account.mjs` | confirmar `PWNED_CHECK` ligado no Render |
| AUTH-03 | PARCIAL | cadastro com e-mail confirmado (`account.ts`) | `account.mjs` | e-mail é opcional em contas antigas; funções sociais não exigem e-mail verificado |
| AUTH-04 | OK | `routes.ts` login com `fakeVerify`, mensagem genérica | `abuse.mjs`, `auth-unit.ts` | — |
| AUTH-05 | OK | `limit()` por IP e por conta em login/cadastro/reset/reenvio; teto de falhas por IP | `abuse.mjs`, `security.mjs` | limites em memória (1 instância) |
| AUTH-06 | OK | Turnstile no cadastro (`config.ts`) | `account.mjs` | exige `TURNSTILE_*` no Render |
| AUTH-07 | PARCIAL | limite de cadastros por IP | `abuse.mjs` | **sem** bloqueio de e-mails descartáveis |
| AUTH-08 | PARCIAL | TOTP + códigos de recuperação hasheados (`security.ts`), segredo cifrado (`vault.ts`), 2FA obrigatório para a equipe com `ADMIN_REQUIRE_2FA=1` | `security.mjs`, `abuse.mjs`, `auth-unit.ts` | **DONO**: definir `SECRETS_KEY` e `ADMIN_REQUIRE_2FA=1`; passkeys não existem |
| AUTH-09 | FALTA | — | — | P2 |
| SES-01 | OK | `auth.ts`: cookie `__Host-resenha_sid; HttpOnly; Secure; SameSite=Lax`, sem token em localStorage | `security.mjs`, `abuse.mjs` | — |
| SES-02 | PARCIAL | sessão opaca de 256 bits, **hasheada no banco**, revogável na hora; expira por inatividade (60 d) e validade máxima (180 d) | `auth-unit.ts` | não há par access curto + refresh rotativo; troca equivalente em risco porque o token é revogável instantaneamente. Reuso não se aplica (token não é rotativo) |
| SES-03 | N/A | não usamos JWT | — | — |
| SES-04 | OK | logout apaga a sessão e fecha o WebSocket; troca de senha revoga as outras | `security.mjs`, `ws-abuse.mjs` | — |
| SES-05 | PARCIAL | `/me/sessions` lista e revoga (individual e "sair dos outros"); alerta de login novo por e-mail | `security.mjs` | alerta depende do e-mail configurado |
| SES-06 | OK | senha exigida para trocar e-mail/senha/2FA, apagar conta e criar/girar/apagar bot | `bots-apps.mjs`, `account.mjs` | — |
| REC-01 | OK | token de reset aleatório, hasheado, uso único, expira; invalidado ao trocar senha | `account.mjs` | — |
| REC-02 | OK | códigos numéricos com expiração curta, limite de tentativas e invalidação | `account.mjs` | — |
| REC-03 | PARCIAL | troca de e-mail com verificação (`account.ts` `/me/email/verify`) | `account.mjs` | aviso ao e-mail antigo existe como alerta; não há link de "reverter" |
| REC-04 | OK | equipe **não** tem "logar como": nenhuma rota emite sessão para outra conta | `authz-matrix.mjs` | — |
| OAU-01/02 | N/A | sem login social | — | — |

### 3. Autorização
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| AUZ-01 | OK | middleware `auth` por padrão; 203 rotas varridas sem login: só 23 públicas por lista explícita (e a lista é checada contra "rota pública que na verdade exige login") | `authz-matrix.mjs` (A) | — |
| AUZ-02 | PARCIAL | cálculo de permissões central (`access.ts`, `channelForMember`), usado por REST e WS | `permissions.mjs`, `authz-matrix.mjs` | não há um único `can()`; rotas chamam os helpers centrais |
| AUZ-03/05 | OK | identidade só da sessão; campos extras (`isAdmin`, `ownerId`, `authorId`, `role`…) ignorados (zod + listas de campos) | `authz-matrix.mjs` (D) | — |
| AUZ-04 | OK | matriz papel×ação (dono/adm/mod/membro/fora/banido) + IDOR de DMs, servidores, cargos, canais, reações, pins, sessões, exportação | `authz-matrix.mjs` (B, C, C2) | achado #1 corrigido |
| PERM-01/02 | OK | bitmask + overrides; hierarquia (ninguém age em cargo ≥ ao seu) | `permissions.mjs`, `authz-matrix.mjs` | — |
| PERM-03 | OK | canal privado fechado em histórico, pins, busca, escrita, reações, edição, comandos de bot, listagens | `authz-matrix.mjs` (C2) | — |
| PERM-04/07 | OK | ban/expulsão/cargo revogam REST e socket na hora; ban impede reentrada | `ws-abuse.mjs`, `permissions.mjs` | — |
| PERM-05 | OK | só autor edita; moderador só remove | `authz-matrix.mjs` | — |
| PERM-06 | OK | `@todos` exige `MENTION_EVERYONE` (`routes.ts`); bots nunca (`mention_everyone=false`) | `permissions.mjs`, `bots.mjs` | — |
| PERM-08 | OK | tetos de canais (150), cargos (100), categorias (40), servidores por pessoa (20) | `abuse.mjs` | emojis/webhooks já limitados por tipo |
| INV-01 | PARCIAL | código aleatório de alta entropia, revogável (regenerar); **limite de tentativas** por IP/usuário | `abuse.mjs`, `invite-codes.mjs` | convite de servidor **sem expiração e sem limite de usos** (um código permanente por servidor). Decisão de produto |
| INV-02 | FALTA | — | — | restrições a convites de novos/banidos e log de quem convidou |
| INV-03 | PARCIAL | **chave de emergência "Entrar por convite"** (manual) | `killswitch.mjs` | lockdown **automático** por pico de entradas não existe |
| DM-01 | OK | `blocks.ts` (tabela `user_blocks`): bloquear desfaz a amizade; DM, pedido de amizade, conversa nova e ligação barrados **nos dois sentidos** (quem foi bloqueado recebe mensagem neutra, sem saber do bloqueio); presença e "jogando agora" escondidos; aviso com o @ ao entrar numa call com a pessoa bloqueada e quando ela entra | `blocks.mjs`, `blocks-ui.mjs` | mensagens da pessoa nos servidores em comum ficam recolhidas só no app (o servidor continua entregando: servidor é espaço compartilhado) |
| DM-02 | FALTA | — | — | configurações "quem pode me chamar" |
| DM-03 | OK | DMs novas: 5/h para contas <1 dia, 30/h depois; chave de emergência para DMs; bot não recebe DM | `abuse.mjs`, `killswitch.mjs` | — |
| ADM-01 | PARCIAL | rotas `/admin/*` próprias (404 para não-equipe), 2FA exigido com `ADMIN_REQUIRE_2FA=1`, auditoria dos servidores (`audit.ts`) | `abuse.mjs`, `audit.mjs`, `authz-matrix.mjs` | mesmo host do app; sem allowlist de IP; auditoria é tabela só de inserção por convenção, não imutável por permissão do banco |
| ADM-02 | OK | `PLATFORM_ADMINS` ≠ dono ≠ moderador | `authz-matrix.mjs` | — |
| ADM-03 | OK | equipe **não lê DMs** (nenhuma rota); só vê o que é denunciado | `authz-matrix.mjs`, `reports.mjs` | — |

### 4. Tempo real
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| WS-01 | PARCIAL | autentica no handshake (cookie ou `auth.token`); token fora de query string | `ws-abuse.mjs` | clientes de desktop/celular enviam token em `auth`, não em URL |
| WS-02 | OK | `Origin` validado | `ws-abuse.mjs` | — |
| WS-03 | OK | rooms só por autorização do servidor; outsider/banido não entra | `ws-abuse.mjs` | — |
| WS-04 | OK | zod em eventos; fuzz com payloads inesperados não derruba | `ws-abuse.mjs` | — |
| WS-05 | OK | autor/id/data definidos no servidor | `ws-abuse.mjs`, `authz-matrix.mjs` | — |
| WS-06 | OK | `maxHttpBufferSize` 256 KB, 15 sockets por usuário, limite de conexões por IP, flood (>1500 eventos/10 s derruba), limites suaves por evento | `ws-abuse.mjs` | — |
| WS-07 | PARCIAL | heartbeat do socket.io; logout e revogação derrubam | `ws-abuse.mjs` | reautenticação periódica do token não é feita (revogação é imediata) |
| WS-08 | OK | presença/atividade/perfil só para quem compartilha servidor/amizade; "digitando" limitado | `ws-abuse.mjs` | — |
| WS-09 | OK | apagar/editar emite evento a todos | `chat.mjs` | índice de busca é a própria tabela |
| WS-10 | FALTA | — | — | idempotência por nonce do cliente |
| WS-11 | PARCIAL | limites por canal/mensagem | — | sem teste de carga de fan-out |
| WS-12 | PARCIAL | push com payload curto e vinculado ao dispositivo | — | opção "ocultar prévia" não implementada |
| WS-13 | OK | busca no nível da query (SQL filtra por canais acessíveis) | `authz-matrix.mjs` (C2) | — |
| WS-14 | PARCIAL | limite de tamanho de mensagem | — | sem limite de caracteres combinantes (zalgo) |

### 5. Upload e mídia
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| UPL-01 | OK | magic bytes + allowlist (`sanitize.ts`, `files.ts`) | `upload-abuse.mjs`, `files.mjs` | — |
| UPL-02 | OK | tamanho (limite por tipo), pixels e bombas de descompressão | `upload-abuse.mjs` | limites no edge: **DONO** confirmar no Cloudflare |
| UPL-03 | OK | **toda** imagem re-encodada; EXIF/GPS removido | `upload-abuse.mjs` | vídeo/áudio/PDF não são re-encodados (servidos como download) |
| UPL-04 | OK | id gerado no servidor; nome só de exibição, sanitizado (`..`, nulos, RTL) | `upload-abuse.mjs` | — |
| UPL-05/06 | OK | SVG/HTML/executáveis recusados ou servidos como `attachment` com CSP `sandbox` | `upload-abuse.mjs`, `xss.mjs` | — |
| UPL-07/08/10 | OK | acesso por link assinado de curta duração, revalidado por permissão do canal; banido não gera link novo | `upload-abuse.mjs` | — |
| UPL-09 | **PARCIAL** | `nosniff`, `Content-Disposition`, CSP restritiva e `sandbox` nas respostas de mídia | `upload-abuse.mjs` | **mesma origem do app** (sem domínio separado sem cookies). Mitigado pelos itens acima + cookie `__Host-`; recomendado domínio de conteúdo próprio |
| UPL-11 | OK | `no-store`/`private` | `upload-abuse.mjs` | — |
| UPL-12 | OK | cotas por pessoa/servidor | `files.mjs` | — |
| UPL-13 | FALTA | — | — | antivírus assíncrono (custo/infra) |
| UPL-14 | FALTA | — | — | transcodificação isolada (não transcodificamos no servidor) |
| UPL-15 | FALTA | denúncia existe (`reports.ts`) | `reports.mjs` | hash-matching/CSAM e fluxo com autoridades → **jurídico** |
| UPL-16 | OK | apagar mensagem/conta apaga mídia | `files.mjs`, `account.mjs` | cache em CDN: prazo do provedor |
| UPL-17 | FALTA | — | — | P2 |
| SSRF-01/02 | OK | `safeFetch.ts` (bots) e `embeds.ts` (prévias): só https/443 (bots), IP privado/metadados bloqueados, DNS resolvido e **IP fixado**, sem redirect, timeout 3 s, resposta ≤32 KB | `safe-fetch.mjs`, `bots-abuse.mjs`, `upload-abuse.mjs` | — |
| SSRF-03 | PARCIAL | imagem externa só carrega com clique do usuário (IP não vaza sem consentimento) | `xss.mjs` | sem proxy de mídia próprio |

### 6. Chamadas
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| CALL-01/02/03 | PARCIAL | sinalização exige canal acessível e permissão `CONNECT`; sem "token de sala" porque a call é P2P (sem SFU em produção) | `permissions.mjs`, `ws-abuse.mjs` | Cloudflare SFU só em laboratório |
| CALL-04 | PARCIAL | expulsar/mover/desconectar funcionam; **mudo forçado** persiste no servidor, mas no P2P o cliente modificado pode ignorar | `ws-abuse.mjs`, `voice-moderation.mjs` | só um SFU impõe mudo de verdade |
| CALL-05 | N/A | sem webhooks de provedor de call | — | — |
| CALL-06 | PARCIAL | limites por canal e eventos | — | sem limite de duração; chave de emergência "As chamadas de voz" |
| CALL-07 | OK | permissão por canal + indicador de transmissão | `voice-features.mjs` | — |
| CALL-08 | OK | chamada em DM exige amizade/DM existente; "tocar" com limite | `dm-call.mjs`, `ws-abuse.mjs` | — |
| CALL-09 | OK | WebRTC (DTLS-SRTP) + WSS; cadeado só aparece quando criptografado de fato | `dm-call.mjs` | — |
| CALL-10 | PARCIAL | credenciais TURN **efêmeras do provedor** (Cloudflare/Metered, `ice.ts`), nunca fixas no front | `turn.mjs`, `ice.mjs` | `GET /ice` exige login |
| CALL-11 | PARCIAL | `denied-peer-ip` e limites são do provedor | — | confirmar no painel do provedor |
| CALL-12 | PARCIAL | modo só-relay existe nas configurações de voz | `voice-features.mjs` | falta citar na política de privacidade |
| CALL-13 | N/A | **não gravamos** chamadas | — | — |
| CALL-14 | OK | texto honesto: "criptografado em trânsito (DTLS-SRTP)", **mensagens de texto não são E2EE** | `launch.mjs` | — |
| CALL-15 | OK | `Permissions-Policy: camera=(self), microphone=(self), …` | `abuse.mjs` | — |

### 7. Conteúdo do usuário
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| XSS-01/02/03 | OK | React renderiza texto; esquemas de URL por allowlist; `noopener noreferrer nofollow ugc` | `xss.mjs` (13 payloads em navegador real, em todos os campos) | — |
| XSS-04 | PARCIAL | CSP: `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` | `xss.mjs`, `abuse.mjs` | `style-src 'unsafe-inline'` e `img-src https:` (imagens externas só após clique); sem Trusted Types |
| XSS-05 | OK | embeds só YouTube (nocookie) e Spotify, por clique | `xss.mjs` | — |
| XSS-06 | OK | nome, apelido, servidor, canal, status, bio, arquivo, cargo, emoji testados | `xss.mjs` | — |
| IMP-01/02 | OK | bidi/zero-width removidos; homóglifos de "staff/resenha/moderador…" bloqueados; selos BOT/Fundador vêm do servidor | `abuse.mjs`, `bots-abuse.mjs` | — |
| IMP-03 | FALTA | — | — | Safe Browsing / reputação de links |
| CSRF-01 | OK | cookie `SameSite=Lax` + checagem de `Origin` em pedidos que mudam estado (`auth.ts`) | `security.mjs`, `abuse.mjs` | — |
| CLK-01 | OK | `frame-ancestors 'none'` | `abuse.mjs` | — |
| XSS-07 | OK | não há parâmetro `next/redirect` aberto | revisão | — |

### 8. Abuso e limites
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| RL-01 | PARCIAL | rate limit em camadas por IP/usuário/rota/evento (`security.ts`) | `abuse.mjs`, `ws-abuse.mjs` | **em memória** (instância única, hoje 1 no Render); Redis só se escalar |
| RL-02 | OK | body limitado (413), páginas com teto, zod | `abuse.mjs` | — |
| RL-03 | OK | modo lento + `msgmin` 90/min por usuário + 5 msgs/5 s por canal | `community.mjs`, `abuse.mjs` | — |
| RL-04 | PARCIAL | DM limitada para contas novas | `abuse.mjs` | sem restrição de anexos/links nas primeiras horas |
| RL-05 | PARCIAL | automod + limites | `community.mjs` | sem detecção automática de bots/spam com suspensão |
| RL-06 | DONO | Cloudflare na frente do domínio | — | confirmar WAF e que o Render só aceita o Cloudflare (hoje a origem do Render é pública) |
| RL-07 | PARCIAL | regex em entrada do usuário revisadas e com limite de tamanho | `abuse.mjs` (nomes) | sem varredura automática de ReDoS |
| RL-08 | PARCIAL | busca/lista de servidores só do que é público; login sem enumeração; verificação de nome livre com limite | `abuse.mjs` | `/auth/username-available` é público por desenho (limitado) |
| RL-09 | PARCIAL | painéis de capacidade, banda e TURN | `health.mjs` | sem corte automático por custo |

### 9. Banco de dados
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| DB-01 | OK | consultas parametrizadas; os poucos SQL dinâmicos usam colunas/tabelas fixas no código (nunca do cliente); ordenação sem entrada livre | revisão de `db.query(\`…${`); busca com payloads SQL em `abuse.mjs` | — |
| DB-02 | N/A | Postgres próprio atrás da API: **sem PostgREST/Supabase direto**, o navegador nunca fala com o banco | — | — |
| DB-03 | PARCIAL | — | — | **DONO**: criar role do app sem DDL/superuser no Neon e usar a dona só nas migrações |
| DB-04 | DONO | Neon exige TLS | — | senha forte e allowlist de IP, se o plano permitir |
| DB-05 | PARCIAL | dados de teste são locais (PGlite/DATA_DIR temporário) | todos os `e2e/` | dev e produção usam Neon diferente? confirmar |
| DB-06 | PARCIAL | backups criptografados (`BACKUP_KEY`, `BACKUP_KEEP_DAYS`), restauração testada | `files.mjs`, `restart.mjs` | sem PITR contínuo; confirmar o plano do Neon |
| DB-07 | OK | TOTP e segredo de assinatura de bot cifrados (`vault.ts`); tokens de bot e sessões só por hash | `auth-unit.ts`, `bots-apps.mjs` | **DONO**: definir `SECRETS_KEY` |
| DB-08 | PARCIAL | schema idempotente em `db.ts` (versionado no git) | — | sem ferramenta de migração formal |
| DB-09 | PARCIAL | paginação com teto | — | revisar índices com carga real |
| DB-10 | PARCIAL | `audit.ts` (servidor) e histórico de segurança | `audit.mjs` | não impede `DELETE` por quem tem o banco |
| DB-11 | FALTA | — | — | P2 |

### 10. API e backend
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| API-01 | OK | ver seção 3 | `authz-matrix.mjs` | — |
| API-02 | OK | zod em toda rota (`http.ts` `parse` + `cleanDeep`); campos extras ignorados | `authz-matrix.mjs` (D) | — |
| API-03 | OK | **sem CORS** (mesma origem); `Origin` malicioso não ganha cabeçalhos | `abuse.mjs` | — |
| API-04 | OK | erros genéricos, sem stack/SQL/caminho; 413 limpo | `abuse.mjs` | — |
| API-05 | PARCIAL | criação de código com `UNIQUE`; transações nos pontos críticos | `invite-codes.mjs` | **sem teste de 50–100 requisições paralelas** (TST-04) |
| API-06 | N/A | sem webhooks de entrada de provedor (Pix é manual com confirmação da equipe) | — | — |
| API-07 | OK | webhooks de saída dos bots: SSRF-safe, assinados com HMAC + timestamp, timeout, sem retry em loop, segredo rotacionável | `bots-apps.mjs`, `bots-abuse.mjs` | — |
| API-08 | OK | 203 rotas inventariadas na matriz; sem rotas de debug | `authz-matrix.mjs` | OpenAPI não existe (inventário é a matriz) |
| API-09 | PARCIAL | respostas de terceiros (HIBP, YouTube, TURN) com timeout | — | sem circuit breaker |
| API-10 | FALTA | — | — | P1: chaves de idempotência |

### 11. Bots
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| BOT-01 | OK | token `bot_<id>.<segredo>` mostrado **uma vez**, guardado como SHA-256, revogável (girar apaga o antigo), criar/girar/apagar exigem **senha** | `bots-apps.mjs`, `bots-abuse.mjs` | escopos finos (OAuth) não existem: o escopo é "canais onde foi instalado" |
| BOT-02 | OK | bot passa pelas mesmas checagens (membro do servidor, canal acessível, cargo); não envia em canal privado sem acesso; não recebe DM/amizade; nome não imita a equipe | `bots-abuse.mjs`, `authz-matrix.mjs`, `bots-apps.mjs` | — |
| BOT-03 | OK | 120 chamadas/min por bot, falhas de token por IP, selo **BOT** vindo do servidor, chave de emergência "Os bots" | `bots-abuse.mjs`, `killswitch.mjs` | detecção automática de bots maliciosos não existe |
| BOT-07 | OK | Relatório externo de testes dos bots (26/11): corrigidos — falhas do bot agora dão mensagem clara (status 424, o 502 era trocado por "Erro 502" pela hospedagem) e ficam num registro de erros do dono; endereço do bot que aponta para rede interna é recusado já ao salvar (e de novo a cada chamada, com IP fixado); caracteres invisíveis/de inversão removidos das respostas do bot; o `user.id` enviado ao bot é derivado por bot; nomes reservados não derrubam mais o lote; comandos com número funcionam no chat | `bots-apps.mjs`, `bots-abuse.mjs` | desligar sozinho bot que falha muito; Termos/Privacidade para bots de terceiros |
| BOT-06 | OK | DJ do bot: o evento `voice:dj` e o campo `djChannels` do `ready` só vão a quem pode ver aquele canal de voz (canal privado não vaza); o tempo da faixa vem do servidor (YouTube API, chave só no servidor, falha = ignora); o cliente não consegue ligar o modo DJ nem encerrar a faixa antes da hora | `bots-dj.mjs`, `bots-dj-ui.mjs` | — |
| BOT-04 | PARCIAL | mensagens de bot sanitizadas como as de usuário; `@todos` nunca | `bots-apps.mjs` | **sem** webhook de entrada com URL secreta (feature não existe) |
| BOT-05 | OK/DONO | bots de terceiros **só para contas liberadas** (`botdev`) até a equipe marcar "Para todos" | `bots-apps.mjs` | revisão de bots públicos não existe; antes de liberar: termos, denúncia de bot, cota por conta |

### 12. Segredos e configuração
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| SEC-01 | PARCIAL | `.gitignore` com `.env`; varredura do histórico inteiro (`scripts/security-scan.mjs`, no CI) | `security-scan.mjs --self-test` | o **histórico antigo ainda contém um nome de usuário real** (não é segredo, mas é dado pessoal). Reescrever o histórico é decisão do dono |
| SEC-02 | PARCIAL | varredura no CI e em `npm run security:scan` | `checks.yml` | **DONO**: ligar GitHub *secret scanning* + *push protection* (Settings → Code security); pre-commit local opcional |
| SEC-03 | OK | varredura do `client/dist` (sem `sk_`, `service_role`, tokens); variáveis `VITE_*` só públicas; **sem source maps** de produção | `security-scan.mjs` | — |
| SEC-04 | OK | segredos só em variáveis do Render; nada em código/imagem/logs | `security-scan.mjs` | — |
| SEC-05 | DONO | uma chave por serviço; **rotina de rotação** documentada em `docs/INCIDENTES.md` | — | executar a rotina (trimestral) |
| SEC-06 | OK | sem rotas de teste; `BOT_ALLOW_LOCAL_URLS` e opções de laboratório desligadas por padrão; erros sem detalhes | `bots-abuse.mjs`, `abuse.mjs` | — |
| SEC-07 | **DONO** | — | — | **MFA** em GitHub, Render, Neon, Cloudflare, registrador, e-mail, Brevo, R2 (app autenticador/chave física, não SMS) |
| SEC-08 | DONO | — | — | SPF/DKIM/DMARC (Brevo), DNSSEC, CAA, trava do registrador |
| SEC-09 | DONO | `.github/dependabot.yml`, CodeQL | — | proteger `main` (PR obrigatório, checks, sem force-push) e `CODEOWNERS` para `auth.ts`/`access.ts`/`security.ts` |

### 13. Infraestrutura, TLS e headers
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| INF-01 | OK | HTTPS/WSS pelo Render+Cloudflare; HSTS (`max-age=31536000; includeSubDomains`) quando seguro | `abuse.mjs` | `preload`: opcional, decisão do dono |
| INF-02 | OK | CSP, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP, `frame-ancestors` (`security.ts`) | `abuse.mjs`, `xss.mjs` | rodar Mozilla Observatory/securityheaders no domínio real (**DONO**) |
| INF-03 | OK | cookie `__Host-` `HttpOnly; Secure; SameSite=Lax; Path=/` | `security.mjs` | — |
| INF-04 | PARCIAL | build do Render | — | sem Dockerfile próprio; scan de imagem não aplicável |
| INF-05 | DONO | banco só por TLS no Neon | — | restrições de rede são do provedor |
| INF-06 | **OK** | **chaves de emergência** (uploads, convites, DMs, chamadas, bots) + cadastro fechável + **"Sair de TODOS os aparelhos"**, sem deploy (`killswitch.ts`, Painel → Saúde) | `killswitch.mjs` | autoscaling é do Render |
| INF-07 | OK | `Cache-Control: no-store` em toda a `/api`; mídia privada `private` | `abuse.mjs`, `upload-abuse.mjs` | — |
| INF-08 | PARCIAL | Dependabot + `npm audit` no CI | `checks.yml` | prazo de patch crítico não definido |
| INF-09/10 | N/A / DONO | sem IaC; WAF no Cloudflare | — | regras customizadas no Cloudflare para `/api/auth/*` (P2) |

### 14. Dependências e CI/CD
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| DEP-01 | OK | `package-lock.json`, `npm ci`, `npm audit` (alto) no CI, Dependabot | `checks.yml` | — |
| DEP-02 | PARCIAL | poucas dependências; revisão manual | — | disciplina de PR |
| DEP-03 | PARCIAL | **CodeQL** (`codeql.yml`) | — | DAST (ZAP) em staging não existe |
| DEP-04 | OK | **todas as Actions fixadas por SHA**; `permissions: contents: read`; sem `pull_request_target` | revisão dos workflows | — |
| DEP-05 | PARCIAL | deploy automático do Render a partir do git | — | aprovação para produção depende de proteger `main` (SEC-09) |
| DEP-06 | FALTA | — | — | P2 (SBOM) |

### 15. Privacidade, LGPD e menores (**validar com advogado**)
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| PRV-01 | PARCIAL | Termos e Privacidade em português (`LegalPage`), com aceite no cadastro | `launch.mjs`, `account.mjs` | revisão jurídica e base legal por tratamento. Atualizar para **bots de terceiros** antes de liberar |
| PRV-02 | **FALTA/DONO** | Termos dizem idade mínima de 13 anos; menores de 18 com autorização do responsável | — | **sem verificação de idade** e sem padrões protetivos para menores (ECA Digital, Lei 15.211/2025). **Decisão de produto + advogado** |
| PRV-03 | PARCIAL | sem senha/token/conteúdo de DM nos logs; IP guardado só para sessões e limites | revisão de logs | procurar PII em analytics (há `stats` agregados) |
| PRV-04 | OK | exportar (`/me/export`, só dados próprios) e apagar conta (`/me/delete`) | `account.mjs`, `security.mjs`, `authz-matrix.mjs` | backups antigos mantêm dados até expirar (`BACKUP_KEEP_DAYS`): descrever na política |
| PRV-05 | DONO | — | — | encarregado (DPO), registro de tratamento, RIPD (menores, voz/vídeo) |
| PRV-06 | PARCIAL | lixeira com prazo, backups com rotação | `files.mjs` | política de retenção por tipo escrita + job de expurgo de logs |
| PRV-07 | DONO | — | — | confirmar com advogado a obrigação de guardar registros de acesso (Marco Civil) e como protegê-los contra adulteração |
| PRV-08 | OK/DONO | **`docs/INCIDENTES.md`** (contenção, evidências, comunicação à ANPD e titulares) | — | confirmar prazo vigente da ANPD com advogado |
| PRV-09 | OK | sem cookies de analytics de terceiros; Turnstile e YouTube nocookie só quando usados | — | listar terceiros na política |
| PRV-10 | OK | texto honesto: DMs/mensagens com TLS e criptografia em repouso do provedor, **não E2EE**; equipe não lê DMs; só vê denúncias | `launch.mjs`, `authz-matrix.mjs` | — |
| PRV-11 | PARCIAL | denunciar mensagem/usuário/servidor + fila da equipe | `reports.mjs` | prazos de resposta e fluxo CSAM com SaferNet/autoridades (**jurídico**); denúncia **de bot** ainda não |
| PRV-12 | DONO | provedores nos EUA (Render, Neon, Cloudflare, Brevo) | — | cláusulas/base legal |

### 16. Logs, monitoramento e incidentes
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| LOG-01 | OK | histórico de segurança por conta (`security_events`), auditoria de servidor, log `[segurança]` para chaves de emergência e revogação em massa | `security.mjs`, `audit.mjs`, `killswitch.mjs` | 401/403 em massa só pelo log do Render |
| LOG-02 | OK | nada de senha/token/cookie/DM em logs | revisão (`grep console.*`) | — |
| LOG-03 | PARCIAL | logs do Render | — | sem retenção/imutabilidade própria |
| LOG-04 | PARCIAL | painel de saúde/capacidade/TURN; limites que bloqueiam | `health.mjs` | **sem alertas ativos** (e-mail/push) em pico de falhas, raid ou custo |
| LOG-05 | OK | **`docs/INCIDENTES.md`** + revogar todas as sessões + chaves de emergência | `killswitch.mjs` | treinar (LOG-07) |
| LOG-06 | OK | `/.well-known/security.txt`, página `/seguranca` | `landing.mjs` | — |
| LOG-07 | DONO | simulações trimestrais descritas no runbook | — | executar |

### 17. Clientes
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| CLI-01 | PARCIAL | Android é um app que abre o site (token em cookie `HttpOnly`) | — | revisar deep links do APK |
| CLI-02 | OK | Electron: `contextIsolation: true`, `sandbox: true`, sem `nodeIntegration` (`desktop/src/main.js`) | `desktop.mjs` | atualizações assinadas: verificar certificado do instalador |
| CLI-03 | PARCIAL | service worker mínimo (push/PWA) | — | limpar caches no logout (revisar) |
| CLI-04 | PARCIAL | ver WS-12 | — | — |
| CLI-05 | PARCIAL | aviso de atualização no site (`version.ts`) | `launch.mjs` | *force-update* do desktop/APK |

### 18. IA
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| AI-01…05 | N/A (hoje) | **IA dos bots desligada** (`BOTS_AI=1` liga; padrão desligado). Se for religada: mensagens são dado (não instrução), sem ferramentas destrutivas, só o canal onde foi chamada | `bots.mjs` | **antes de religar**: política de privacidade citando o provedor, limite de custo por conta (`botAi.ts`) |

### 19. Pagamentos
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| PAY-01 | OK | só Pix BR Code; **nenhum dado de cartão** | `apoio.mjs` | — |
| PAY-02/03 | OK | valor e benefício definidos no servidor; **só a equipe confirma** o pagamento (nenhum "sucesso" vindo do front libera selo) | `apoio.mjs`, `authz-matrix.mjs` | — |
| PAY-04 | PARCIAL | limite de pedidos por conta | `apoio.mjs` | conciliação manual |

### 20. Testes
| ID | Status | Evidência | Teste | Pendências |
|---|---|---|---|---|
| TST-01 | OK | `e2e/authz-matrix.mjs`: gera a lista de rotas do próprio código e **falha** se uma rota nova não exigir login e não estiver na lista pública; papel×ação | `authz-matrix.mjs` | rota nova precisa ser adicionada à matriz de papéis (revisão) |
| TST-02 | OK | IDOR | `authz-matrix.mjs` | — |
| TST-03 | OK | outsider, banido, `author_id` forjado, frame gigante, flood, logout, `Origin` errado | `ws-abuse.mjs` | token expirado em conexão aberta: coberto por revogação/logout |
| TST-04 | **FALTA** | — | — | 50–100 requisições paralelas em convite/entrada/cargo |
| TST-05 | OK | `.php/.html/.svg/.exe` como `.jpg`, polyglot, bomba de pixels, nome com `../` e RTL, GPS removido, link sem permissão | `upload-abuse.mjs` | arquivo de 500 MB: recusado por limite (teste usa tamanho acima do limite) |
| TST-06 | OK | 13 payloads em navegador real | `xss.mjs` | — |
| TST-07 | OK | 127.0.0.1, 169.254.169.254, ::1, IPv4 em formatos estranhos, IPv6 mapeado, `.internal`, portas, credenciais na URL, file/ftp, redirect | `safe-fetch.mjs`, `bots-abuse.mjs`, `upload-abuse.mjs` (honeypot local) | DNS rebinding coberto por IP fixado |
| TST-08 | OK | força bruta de login/código/convite/token de bot, enumeração, sessão expirada | `abuse.mjs`, `auth-unit.ts`, `bots-abuse.mjs` | JWT/refresh: N/A |
| TST-09 | PARCIAL | permissão para entrar na call, sala de outro canal, banido, sinalização inválida, mudo forçado persistente | `ws-abuse.mjs`, `permissions.mjs` | webhooks de provedor e TURN expirado: N/A / provedor |
| TST-10 | OK | histórico do git + `client/dist` | `security-scan.mjs` | — |
| TST-11 | OK | mass assignment | `authz-matrix.mjs` (D) | — |
| TST-12 | PARCIAL | SQLi em busca/ordenar | `abuse.mjs` | RLS: N/A |
| TST-13 | OK | flood de mensagens, cadastros, convites, DMs, digitação, WS | `abuse.mjs`, `ws-abuse.mjs` | — |
| TST-14 | PARCIAL | headers e CORS testados localmente | `abuse.mjs` | **DONO**: Observatory + SSL Labs no domínio real |
| TST-15 | OK | apagar conta e exportar (só dados próprios) | `account.mjs`, `security.mjs` | — |
| TST-16 | OK | remover/banir/trocar cargo durante sessão ativa | `ws-abuse.mjs`, `permissions.mjs` | — |
| TST-17 | PARCIAL | suíte de segurança no CI a cada push | `checks.yml` | ZAP e varredura semanal não existem (Dependabot cobre dependências) |
| TST-18 | **DONO** | — | — | pentest externo antes de divulgar em escala |
| TST-19 | FALTA | `security.txt` já aceita relatos | — | programa de recompensa (P2) |

## 4. Perguntas da seção 21 (respostas pelo repositório)

1. **Stack:** React 19 + Vite, Express 5 + Socket.IO, Postgres (Neon; PGlite nos testes), WebRTC P2P (SFU Cloudflare só em laboratório), armazenamento no banco ou R2, e-mail pela Brevo, hospedagem no Render atrás do Cloudflare.
2. **E2EE:** não. **Chamadas** são criptografadas em trânsito (DTLS-SRTP); **mensagens de texto não**, e o site diz isso.
3. **Idade mínima:** 13 anos nos Termos; **sem verificação**. Precisa de decisão e do advogado.
4. **Bots/webhooks/pagamentos/IA:** bots da casa e bots de terceiros (fechado a contas liberadas), Pix manual, IA dos bots desligada.
5. **Gravação/transmissão:** transmissão de tela sim; **gravação não**.
6. **DPO e jurídico:** a definir (DONO).
7. **Staging:** o domínio de testes existe (`site de teste x oficial`); confirmar banco separado.

## 5. Definição de pronto para features novas (checklist curto)

- [ ] Autorização no servidor + teste de acesso indevido.
- [ ] Entrada validada com zod; saída sem HTML.
- [ ] Limites de taxa/tamanho/custo.
- [ ] Sem segredos no código/front/logs.
- [ ] Teste de abuso no CI que falhe sem a proteção.
- [ ] Privacidade e Termos atualizados se coletar algo novo.
- [ ] Linha nova neste arquivo.

## 6. Ações que só o dono pode fazer (ordem sugerida)

1. Render → Environment: definir `SECRETS_KEY` (32+ caracteres aleatórios, guardar offline) e `ADMIN_REQUIRE_2FA=1` (depois de ativar o 2FA na sua conta).
2. Ativar **MFA** em GitHub, Render, Neon, Cloudflare, registrador do domínio, e-mail principal, Brevo.
3. GitHub → Settings: *Secret scanning* + *Push protection*; proteger `main` (PR + checks do CI, sem force-push).
4. Neon: criar role do app sem privilégios de DDL.
5. Brevo/DNS: SPF + DKIM + DMARC.
6. Rodar Mozilla Observatory e SSL Labs em resenhabr.com.br.
7. Advogado: idade mínima/ECA Digital, retenção, DPO, registros de acesso, atualizar Termos/Privacidade para bots de terceiros.
8. Decidir: **bloqueio de usuários**, convites com expiração/limite, domínio separado para mídia.
