# Resenha — Checklist de Segurança (nível "plataforma de chat/voz")

> Documento para ser entregue ao Claude Code que desenvolve o Resenha.
> Escopo: chat em tempo real, servidores/canais/cargos, DMs, upload de fotos/mídia, chamadas de voz/vídeo, convites, bots/webhooks.

---

## 0. COMO O CLAUDE CODE DEVE USAR ESTE DOCUMENTO

**Regras de trabalho (obrigatórias):**

1. Trabalhe **uma seção por vez**, na ordem de prioridade da seção 22. Um commit por seção.
2. Para cada item: leia o código real, classifique como `OK`, `FALTA`, `PARCIAL` ou `N/A` (com justificativa) e anote **evidência** (`arquivo:linha`).
3. **Nenhum item vira `OK` sem teste automatizado que prove a proteção** (ou comando de verificação reproduzível). "Parece certo" não conta.
4. Para cada correção, escreva **um teste de abuso que FALHA sem a correção** e passa com ela.
5. **Nunca** desative, afrouxe ou contorne uma proteção para fazer um teste passar.
6. Se encontrar segredo exposto (chave no código, no histórico do git, no bundle do front): **pare e avise o dono** para rotacionar. Apagar o commit não basta.
7. Se um item depender de decisão de produto/jurídico, **pergunte** em vez de assumir.
8. Testes ofensivos (fuzzing, carga, injeção) **só em ambiente local ou staging**, nunca em produção.
9. Entregue ao final `SECURITY_AUDIT.md` com a tabela: `ID | status | evidência | teste | pendências`.

**Legenda de prioridade:** `[P0]` obrigatório antes de qualquer usuário real · `[P1]` obrigatório antes de divulgar/escalar · `[P2]` endurecimento contínuo.

**Notas por stack (aplique só o que existe no projeto):**
- **Supabase:** RLS ligado em TODAS as tabelas, policies testadas com roles `anon` e `authenticated`; `service_role` jamais no cliente; Storage com policies; Realtime com autorização de canal.
- **Firebase:** Security Rules testadas com o emulador; App Check ligado; nada de regra `if true`.
- **Next.js/Vite/React:** qualquer variável `NEXT_PUBLIC_*` / `VITE_*` é **pública**; source maps de produção não devem expor código sensível.
- **LiveKit/Daily/Agora/Twilio:** API secret só no servidor; tokens curtos e com permissões mínimas.

---

## 1. MODELO DE AMEAÇAS (fazer primeiro, 1 página)

- [ ] [P0] **THR-01** Listar ativos: contas, mensagens (públicas e DMs), mídia, tokens de sessão, dados pessoais, chaves de API, streams de call, dados de menores.
- [ ] [P0] **THR-02** Listar atacantes: usuário comum malicioso, membro expulso/banido, dono de servidor hostil, bot/spammer, invasor externo, insider (dev/admin), provedor terceiro comprometido.
- [ ] [P0] **THR-03** Listar superfícies: API REST/GraphQL, WebSocket/Realtime, upload, signaling de call, webhooks, painel admin, front-end, CI/CD, DNS/domínio.
- [ ] [P1] **THR-04** Para cada feature nova, responder: "quem pode ver?, quem pode alterar?, o que um usuário mal-intencionado faria?, como isso é abusado em escala/custo?".
- [ ] [P1] **THR-05** Manter o documento atualizado a cada feature relevante (threat model vivo).

---

## 2. AUTENTICAÇÃO E SESSÃO

**Cadastro e login**
- [ ] [P0] **AUTH-01** Senhas com **Argon2id** (ou bcrypt cost ≥ 12) — ou delegadas a provedor de identidade confiável. Nunca SHA/MD5 puro, nunca texto claro.
- [ ] [P0] **AUTH-02** Política de senha: mínimo 10–12 caracteres, sem regras absurdas; checar contra senhas vazadas (HIBP k-anonymity).
- [ ] [P0] **AUTH-03** Verificação de e-mail obrigatória antes de liberar funções sociais (DM, convites, upload).
- [ ] [P0] **AUTH-04** Respostas **genéricas** em login/recuperação ("credenciais inválidas") — sem enumeração de usuários. Tempo de resposta equivalente.
- [ ] [P0] **AUTH-05** Rate limit + bloqueio progressivo por IP **e** por conta em login, cadastro, reset, reenvio de e-mail/OTP.
- [ ] [P1] **AUTH-06** CAPTCHA/Turnstile em cadastro e em login suspeito.
- [ ] [P1] **AUTH-07** Bloquear e-mails descartáveis; limitar contas por IP/dispositivo/período.
- [ ] [P1] **AUTH-08** **MFA** (TOTP e/ou passkeys/WebAuthn) disponível; obrigatório para admins/moderadores; códigos de recuperação hasheados; segredo TOTP criptografado em repouso.
- [ ] [P2] **AUTH-09** Passkeys como método preferencial.

**Tokens e sessões**
- [ ] [P0] **SES-01** Cookies de sessão: `HttpOnly; Secure; SameSite=Lax/Strict`, prefixo `__Host-` quando possível. **Não guardar token em localStorage** se der para evitar (XSS rouba).
- [ ] [P0] **SES-02** Access token curto (≤ 15 min) + refresh token **rotativo com detecção de reuso** (reuso → revoga a família inteira).
- [ ] [P0] **SES-03** JWT: algoritmo fixado no servidor (rejeitar `none`/troca de alg), validar `iss`, `aud`, `exp`, `nbf`; chaves rotacionáveis; segredo forte (≥ 256 bits).
- [ ] [P0] **SES-04** Logout invalida no servidor. Troca de senha/e-mail/MFA **revoga todas as sessões** (exceto a atual, se desejado).
- [ ] [P1] **SES-05** Tela "dispositivos/sessões ativas" com revogação individual; alerta por e-mail em login de dispositivo novo.
- [ ] [P1] **SES-06** Ações sensíveis (trocar e-mail/senha, apagar conta, gerar token de bot, mudar MFA) exigem **reautenticação recente**.

**Recuperação de conta**
- [ ] [P0] **REC-01** Token de reset: aleatório criptográfico (≥ 128 bits), **uso único**, expira em ≤ 30–60 min, armazenado **hasheado**, invalidado ao trocar senha.
- [ ] [P0] **REC-02** OTP/códigos numéricos: expiração curta, limite de tentativas (ex.: 5), rate limit por conta, invalidar após uso.
- [ ] [P0] **REC-03** Mudança de e-mail confirma no e-mail **antigo e novo**; reverter por link em caso de fraude.
- [ ] [P1] **REC-04** Suporte/admin **não** consegue "logar como" usuário sem trilha de auditoria e consentimento explícito.

**OAuth/login social**
- [ ] [P0] **OAU-01** `state` + **PKCE**; `redirect_uri` com **match exato** (sem wildcard); validar `nonce`/`id_token`.
- [ ] [P1] **OAU-02** Impedir *account takeover* por vínculo: só vincular conta social a conta existente com e-mail **verificado** pelo provedor e após reautenticação.

---

## 3. AUTORIZAÇÃO (o coração de um app tipo Discord)

**Princípios**
- [ ] [P0] **AUZ-01** **Negar por padrão.** Toda rota, toda ação de WebSocket, toda query exige checagem explícita de permissão **no servidor**.
- [ ] [P0] **AUZ-02** Uma **camada central de políticas** (`can(user, action, resource)`) usada por REST, WS, jobs e admin — não checagens espalhadas e inconsistentes.
- [ ] [P0] **AUZ-03** Nunca confiar em `user_id`, `role`, `server_id`, `author_id`, `price` etc. vindos do cliente. Servidor deriva identidade da sessão.
- [ ] [P0] **AUZ-04** **IDOR/BOLA:** toda leitura/escrita valida pertencimento/permissão (`membro do servidor? tem acesso ao canal? é dono da mensagem?`). IDs não-sequenciais (UUID/snowflake) **ajudam mas não substituem** a checagem.
- [ ] [P0] **AUZ-05** **Mass assignment:** allowlist de campos aceitos em cada endpoint; nunca fazer `update(req.body)`.

**Servidores, canais, cargos**
- [ ] [P0] **PERM-01** Modelo de permissões bem definido (cargos + bitmask + overrides por canal) com **cálculo único e testado**.
- [ ] [P0] **PERM-02** **Hierarquia de cargos:** ninguém atribui cargo ≥ ao seu, nem expulsa/bane/silencia alguém de cargo ≥ ao seu; só o dono transfere propriedade.
- [ ] [P0] **PERM-03** Leitura de canal privado exige permissão em **todos** os caminhos: histórico, busca, pins, threads, anexos, notificações, exportações, embeds, "responder/encaminhar" (não vazar conteúdo de canal que o usuário não lê).
- [ ] [P0] **PERM-04** Usuário **banido/expulso/saiu** perde acesso imediatamente: REST, WS, mídia (URLs assinadas), call. Ban persiste e impede reentrada por convite.
- [ ] [P0] **PERM-05** Editar/apagar mensagem: apenas autor (com limites) ou quem tem `MANAGE_MESSAGES`. Moderador não edita texto de outro, só remove.
- [ ] [P0] **PERM-06** `@everyone`/`@here`/menções em massa exigem permissão e têm rate limit.
- [ ] [P1] **PERM-07** Mudança de permissão/cargo/membership **propaga em tempo real** (revoga subscriptions WS, calls e URLs) — sem esperar reconexão.
- [ ] [P1] **PERM-08** Limites por servidor/usuário (nº de canais, cargos, membros, convites, webhooks, emojis) contra abuso de recursos.

**Convites**
- [ ] [P0] **INV-01** Códigos de convite **aleatórios criptográficos** (alta entropia), com expiração, limite de usos e revogação. Rate limit na validação (anti-bruteforce de códigos).
- [ ] [P1] **INV-02** Convites de usuários banidos/novos têm restrições; log de quem convidou quem.
- [ ] [P1] **INV-03** Proteção anti-raid: pico de entradas dispara lockdown automático (verificação extra, pausa de convites).

**DMs e privacidade social**
- [ ] [P0] **DM-01** Bloqueio efetivo (A bloqueia B ⇒ B não envia DM, não vê presença, não liga, não convida).
- [ ] [P1] **DM-02** Configurações: quem pode me enviar DM/pedido de amizade/me convidar para call (todos, amigos, membros em comum, ninguém).
- [ ] [P1] **DM-03** Limite de pedidos de amizade/DM para estranhos (anti-spam e anti-assédio).

**Admin/Backoffice**
- [ ] [P0] **ADM-01** Painel admin **separado** (rota/host próprios), com MFA obrigatório, allowlist de IP/VPN se possível, **auditoria imutável** de toda ação.
- [ ] [P0] **ADM-02** Admin de plataforma ≠ dono de servidor ≠ moderador. Princípio do menor privilégio.
- [ ] [P1] **ADM-03** Acesso de staff a conteúdo privado (DMs) só com justificativa, registro e escopo mínimo.

---

## 4. MENSAGENS EM TEMPO REAL (WebSocket / Realtime)

- [ ] [P0] **WS-01** Autenticar **no handshake**. Evitar token em query string (vai para logs); preferir cookie ou *ticket* de uso único e curto.
- [ ] [P0] **WS-02** Validar header `Origin` (anti **Cross-Site WebSocket Hijacking**).
- [ ] [P0] **WS-03** **Autorizar cada subscribe/join de canal** no servidor. Cliente não escolhe livremente a "room".
- [ ] [P0] **WS-04** Validar **todo evento** recebido com schema estrito (tipo, tamanho, campos). Rejeitar desconhecidos.
- [ ] [P0] **WS-05** O **servidor define** `author_id`, `message_id`, `created_at`, `server_id`. Ignora qualquer um enviado pelo cliente.
- [ ] [P0] **WS-06** Limites: tamanho máx. de frame/mensagem, nº de conexões por usuário/IP, eventos/seg por conexão, tamanho de fila (backpressure); derrubar conexão abusiva.
- [ ] [P0] **WS-07** Heartbeat/timeout; conexões ociosas fechadas; reconexão com *backoff*; reautenticação periódica do token.
- [ ] [P1] **WS-08** Presença, "digitando…" e status só visíveis a quem compartilha servidor/amizade; "digitando" com rate limit.
- [ ] [P1] **WS-09** Mensagem apagada/editada some de caches, replays e índices de busca; evento de delete chega a todos os clientes.
- [ ] [P1] **WS-10** Idempotência (client nonce) para evitar duplicatas e replay de mensagens.
- [ ] [P1] **WS-11** Fan-out de canais grandes não derruba o servidor (filas, particionamento, limites).
- [ ] [P1] **WS-12** Notificações push **não vazam** conteúdo sensível na tela bloqueada (opção de ocultar prévia); tokens de push vinculados ao dispositivo e revogados no logout.
- [ ] [P1] **WS-13** **Busca** de mensagens respeita permissões **no nível da query**, não filtrando depois no cliente.
- [ ] [P2] **WS-14** Limite de tamanho de mensagem e de "caracteres combinantes" (anti-zalgo / texto que quebra a renderização).

---

## 5. UPLOAD E MÍDIA (fotos, vídeos, arquivos, avatares, emojis)

**Validação**
- [ ] [P0] **UPL-01** **Allowlist** de tipos (jpeg, png, webp, gif, mp4/webm…). Validar **magic bytes** (assinatura real), nunca confiar na extensão nem no `Content-Type` do cliente.
- [ ] [P0] **UPL-02** Limites de **tamanho** aplicados no edge/proxy **e** no app, por tipo; limite de **dimensões em pixels** e de duração (anti *decompression bomb*, anti zip-bomb).
- [ ] [P0] **UPL-03** **Re-encodar** imagens no servidor (ex.: libvips/sharp) — remove payloads escondidos e polyglots; **remover EXIF** (inclui GPS: privacidade!).
- [ ] [P0] **UPL-04** **Nome do arquivo gerado pelo servidor** (UUID); nunca usar o nome original em caminho de disco (path traversal, `../`, bytes nulos, RTL override `U+202E`).
- [ ] [P0] **UPL-05** **SVG proibido** (ou sanitizado agressivamente e servido como download). SVG = XSS.
- [ ] [P0] **UPL-06** HTML/JS/executáveis/`.php`/`.exe`/`.html` nunca servidos inline. Arquivos genéricos: `Content-Disposition: attachment`.

**Armazenamento e entrega**
- [ ] [P0] **UPL-07** Buckets **privados**. Acesso por **URLs assinadas de curta duração**, vinculadas ao usuário/canal quando possível. Sem listagem pública de bucket.
- [ ] [P0] **UPL-08** Upload direto via *presigned URL* restrito: chave, `content-type`, `content-length-range` fixos; expira em minutos; confirmação server-side pós-upload.
- [ ] [P0] **UPL-09** Servir mídia de **domínio separado e sem cookies** (ex.: `cdn.resenhabr...`/domínio próprio de conteúdo) + `X-Content-Type-Options: nosniff`.
- [ ] [P0] **UPL-10** Permissão do canal é revalidada ao gerar a URL da mídia; usuário removido do canal não gera novas URLs.
- [ ] [P1] **UPL-11** `Cache-Control: private, no-store` (ou cache controlado + `Vary`) para conteúdo autenticado; **nunca** deixar CDN cachear mídia privada de forma pública.
- [ ] [P1] **UPL-12** Cotas por usuário/servidor (armazenamento, nº de arquivos/dia, banda) — anti-abuso de custo.

**Processamento**
- [ ] [P1] **UPL-13** Antivírus/antimalware (ex.: ClamAV) **assíncrono** com quarentena antes de liberar o arquivo a terceiros.
- [ ] [P1] **UPL-14** Transcodificação (ffmpeg/imagemagick) em **ambiente isolado** (container sem rede, limites de CPU/RAM/tempo, usuário sem privilégios). Esses binários têm histórico de CVEs.
- [ ] [P1] **UPL-15** Moderação de conteúdo: detecção de nudez/violência e **hash-matching de CSAM** (ex.: ferramentas de CSAM scanning do provedor/CDN, PhotoDNA). Fluxo de denúncia/quarentena/reporte às autoridades — **validar com jurídico**.
- [ ] [P1] **UPL-16** Apagar mensagem/conta **apaga a mídia** do storage e de caches/CDN (com prazo definido).
- [ ] [P2] **UPL-17** Marca d'água/hash de arquivos para rastrear reuploads de conteúdo banido.

**Embeds e prévia de links (SSRF!)**
- [ ] [P0] **SSRF-01** Gerador de *link preview* / busca de avatar por URL roda em serviço isolado e **bloqueia IPs internos**: `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254.169.254` (metadados cloud), `::1`, `fc00::/7`, `fe80::/10`.
- [ ] [P0] **SSRF-02** Resolver DNS **e fixar o IP** antes de conectar (anti DNS rebinding); revalidar a cada redirect; limitar nº de redirects; apenas `http/https`; timeout curto; limite de tamanho da resposta.
- [ ] [P1] **SSRF-03** Imagens externas em mensagens passam por **proxy de mídia próprio** (esconde IP do usuário, evita *tracking pixels*, permite bloquear conteúdo).

---

## 6. CHAMADAS DE VOZ E VÍDEO (WebRTC)

**Controle de acesso à call**
- [ ] [P0] **CALL-01** Token de entrada na sala é **emitido só pelo servidor**, **depois** de checar permissão (`CONNECT`/`SPEAK`/`VIDEO` no canal). API secret do provedor **nunca** no cliente.
- [ ] [P0] **CALL-02** Tokens **curtos** (minutos), com *grants* mínimos (`canPublish`, `canSubscribe`, `canPublishData` só quando permitido), vinculados a `identity` e `room` específicos.
- [ ] [P0] **CALL-03** Nome da sala **não adivinhável** e mapeado no servidor ao canal (não use o ID do canal cru exposto).
- [ ] [P0] **CALL-04** Ao expulsar/banir/silenciar: o servidor **remove o participante via API do SFU** e revoga a capacidade de reentrar; mute forçado de moderador **não pode ser desfeito pelo cliente**.
- [ ] [P0] **CALL-05** Verificar **assinatura** de webhooks do provedor (HMAC) + timestamp (anti-replay).
- [ ] [P1] **CALL-06** Limites: nº máximo de participantes, bitrate, resolução, duração, salas simultâneas por usuário/servidor — **anti-abuso de custo** (minutos de call são caros).
- [ ] [P1] **CALL-07** Compartilhamento de tela e câmera sob permissão específica; indicador claro de quem está transmitindo.
- [ ] [P1] **CALL-08** Chamadas em DM de estranhos: bloqueadas ou com aceite explícito; rate limit de "tocar" (anti-assédio).

**Transporte e infraestrutura**
- [ ] [P0] **CALL-09** Somente **DTLS-SRTP** (padrão WebRTC); signaling por canal autenticado (WSS). Nada de mídia/sinalização em HTTP/WS sem TLS.
- [ ] [P0] **CALL-10** **TURN** com **credenciais efêmeras** (TURN REST API, HMAC com validade curta); nunca credencial fixa no front.
- [ ] [P0] **CALL-11** TURN **não é relay aberto**: bloquear relay para redes privadas/metadados (`denied-peer-ip` no coturn), limitar banda/portas/alocações por usuário.
- [ ] [P1] **CALL-12** **Vazamento de IP** via candidatos ICE: oferecer modo "somente relay" (privacidade) para DMs/usuários que preferirem; documentar na política de privacidade.
- [ ] [P1] **CALL-13** Se **gravar** calls: consentimento visível a todos, armazenamento criptografado, retenção definida, acesso restrito.
- [ ] [P1] **CALL-14** Não afirmar "criptografia ponta a ponta" a menos que seja **realmente E2EE** (insertable streams/MLS). Dizer "criptografado em trânsito" quando for o caso.
- [ ] [P1] **CALL-15** Permissões de navegador: `Permissions-Policy: camera=(self), microphone=(self)`; tratar negação de permissão sem travar.

---

## 7. CONTEÚDO DO USUÁRIO: XSS, MARKDOWN, LINKS, IMPERSONAÇÃO

- [ ] [P0] **XSS-01** Renderizar mensagens como **texto**; Markdown com parser **sanitizado** (sem HTML cru). Proibido `innerHTML`/`dangerouslySetInnerHTML` com dado de usuário (ou só com DOMPurify configurado e testado).
- [ ] [P0] **XSS-02** Allowlist de esquemas de URL: `https`, `http`, `mailto`. **Bloquear** `javascript:`, `data:`, `vbscript:`, `file:`.
- [ ] [P0] **XSS-03** Links externos: `rel="noopener noreferrer nofollow ugc"`, `target="_blank"` seguro; mostrar **domínio real** e aviso ao sair do app.
- [ ] [P0] **XSS-04** **CSP estrita** (nonces/hashes, sem `unsafe-inline`/`unsafe-eval`), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`. Considerar **Trusted Types**.
- [ ] [P0] **XSS-05** Embeds (YouTube etc.) apenas de **provedores em allowlist**, em `<iframe sandbox>` com atributos mínimos.
- [ ] [P0] **XSS-06** Sanitizar também: nome de usuário, apelido, nome de servidor/canal, status, bio, nome de arquivo, nome de cargo, emojis custom, mensagens de erro refletidas, parâmetros de URL.
- [ ] [P1] **IMP-01** Normalizar Unicode em nomes: remover/limitar **caracteres de controle bidi (U+202A–U+202E, U+2066–U+2069)**, *zero-width*, e detectar **homóglifos** (ex.: `rnoderador` vs `moderador`) para evitar impersonação de staff/cargos.
- [ ] [P1] **IMP-02** Distinguir visualmente staff/bots/verificados de forma que **não possa ser forjada** com nome/emoji/imagem.
- [ ] [P1] **IMP-03** Detectar/limitar links de phishing (Google Safe Browsing / listas de reputação), encurtadores suspeitos e convites de outros serviços em novos membros.
- [ ] [P1] **CSRF-01** Proteção CSRF em toda ação que muda estado (SameSite + token ou header customizado + checagem de `Origin`). Evitar mudar estado via GET.
- [ ] [P1] **CLK-01** Anti-clickjacking (`frame-ancestors`), `X-Frame-Options: DENY`.
- [ ] [P2] **XSS-07** Revisar CSS injection e *open redirects* (parâmetros `next`/`redirect` com allowlist).

---

## 8. ABUSO, SPAM E LIMITES DE USO

- [ ] [P0] **RL-01** **Rate limit em camadas:** por IP, por usuário, por rota, por evento WS, por servidor/canal. Redis/gateway centralizado, não memória local.
- [ ] [P0] **RL-02** Limites rígidos: tamanho de body, nº de itens por requisição, **tamanho máx. de página** em listagens, profundidade (se GraphQL), timeouts de request.
- [ ] [P0] **RL-03** Slow mode por canal; limite de mensagens/min por usuário (mais estrito para contas novas).
- [ ] [P1] **RL-04** **Restrições a contas novas:** sem DM em massa, sem convites/links/anexos nos primeiros minutos/horas, verificação extra.
- [ ] [P1] **RL-05** Detecção de spam: mensagens repetidas, links em massa, menções em massa, padrões de bot → *shadow-limit*, captcha ou suspensão automática.
- [ ] [P1] **RL-06** WAF + proteção DDoS (ex.: Cloudflare) na frente de **tudo**, inclusive WebSocket; origem do servidor **não exposta** diretamente (aceitar só IPs do CDN).
- [ ] [P1] **RL-07** **ReDoS:** revisar regex aplicadas a input do usuário; usar limites de tamanho e engines seguras.
- [ ] [P1] **RL-08** Proteção anti-scraping de diretórios (lista de servidores/usuários) e anti-enumeração de IDs/usernames.
- [ ] [P2] **RL-09** Orçamento/alerta de custo (storage, banda, minutos de call, e-mails/SMS) com **corte automático** acima do limite.

---

## 9. BANCO DE DADOS

- [ ] [P0] **DB-01** **Consultas parametrizadas / ORM** em 100% dos casos. Proibido concatenar string em SQL. Cuidado com `ORDER BY`/nomes de coluna dinâmicos (allowlist).
- [ ] [P0] **DB-02** Se Supabase/Postgres: **RLS ativado em todas as tabelas** + policies por tabela; testar com `anon` e com usuários distintos; funções `SECURITY DEFINER` revisadas (definir `search_path`).
- [ ] [P0] **DB-03** Usuário do app com **privilégios mínimos** (sem `DROP`, sem superuser). Contas separadas para migração, app e leitura/analytics.
- [ ] [P0] **DB-04** Banco **não público** (VPC/allowlist), TLS obrigatório, senha forte, nada de porta 5432 aberta ao mundo. Redis/Mongo/Elastic idem (com autenticação).
- [ ] [P0] **DB-05** Ambientes **separados** (dev/staging/prod) com credenciais diferentes. **Nunca** copiar dados reais de prod para dev sem anonimização.
- [ ] [P1] **DB-06** **Backups** automáticos, **criptografados**, com PITR, **restauração testada** periodicamente. Backups também sob política de retenção/LGPD.
- [ ] [P1] **DB-07** Criptografia em repouso (disco/volume) e **campos sensíveis** com criptografia de aplicação (segredos TOTP, tokens de integração, chaves de bot).
- [ ] [P1] **DB-08** Migrações revisadas e versionadas; nada de alterar schema em produção manualmente.
- [ ] [P1] **DB-09** Paginação por cursor assinado/validado; limites de `LIMIT`; índices para queries de autorização (evitar *table scans* exploráveis como DoS).
- [ ] [P1] **DB-10** Tabela de **auditoria** append-only para ações de moderação/admin.
- [ ] [P2] **DB-11** Separar dados pessoais (PII) em tabelas/esquemas próprios, com acesso mais restrito.

---

## 10. API E BACKEND (OWASP API Security Top 10)

- [ ] [P0] **API-01** **BOLA/BFLA/BOPLA:** testar acesso a objetos/funções/propriedades de outros usuários e de cargos superiores (ver seção 3).
- [ ] [P0] **API-02** Validar entrada com **schema** (Zod/Pydantic/etc.): tipos, tamanhos, formatos, enums. Rejeitar campos extras. Normalizar Unicode.
- [ ] [P0] **API-03** **CORS:** allowlist exata de origens; nunca `*` com credenciais; nunca refletir `Origin` sem validar.
- [ ] [P0] **API-04** Erros genéricos ao cliente; **sem stack trace, SQL ou caminhos internos**. Detalhes só em log interno.
- [ ] [P0] **API-05** **Race conditions** (cupom, convite com limite de usos, saldo, "primeiro a clicar", criação de recurso único): transações + `UPDATE ... WHERE` atômico + constraints `UNIQUE`; testar com requisições simultâneas.
- [ ] [P0] **API-06** Webhooks **de entrada** (pagamento, call, e-mail): verificar assinatura HMAC, timestamp, *replay protection*, idempotência.
- [ ] [P1] **API-07** Webhooks **de saída** (integrações de servidores): proteção SSRF (seção 5), assinatura nas requisições enviadas, timeout, retry limitado, segredo por webhook revogável.
- [ ] [P1] **API-08** Inventário de endpoints: sem endpoints de debug/legados/versões antigas expostos; documentação OpenAPI como fonte da verdade; desligar introspecção GraphQL em prod.
- [ ] [P1] **API-09** Consumo seguro de APIs de terceiros: validar respostas, timeouts, circuit breaker, nunca confiar cegamente.
- [ ] [P1] **API-10** Idempotency keys em operações críticas (pagamento, criação de convite/servidor).
- [ ] [P2] **API-11** Versionamento e *deprecation policy*.

---

## 11. BOTS, INTEGRAÇÕES E WEBHOOKS DE SERVIDOR

- [ ] [P1] **BOT-01** Tokens de bot **exibidos uma única vez**, armazenados **hasheados**, revogáveis, com escopos mínimos (OAuth scopes).
- [ ] [P1] **BOT-02** Bot só vê/age em canais onde foi autorizado; passa pelas **mesmas** checagens de permissão que usuários.
- [ ] [P1] **BOT-03** Rate limit próprio para bots; detecção de bots maliciosos; marcação visível "BOT".
- [ ] [P1] **BOT-04** URLs de webhook de entrada com segredo longo, rotacionável; mensagens de webhook sanitizadas como qualquer conteúdo de usuário (**@everyone via webhook** controlado).
- [ ] [P2] **BOT-05** Fluxo de revisão/verificação para bots públicos.

---

## 12. SEGREDOS E CONFIGURAÇÃO

- [ ] [P0] **SEC-01** `.env` no `.gitignore`; `.env.example` só com nomes. **Varrer o histórico do git** (`gitleaks detect`, `trufflehog git file://.`) — se achar algo, **rotacionar**.
- [ ] [P0] **SEC-02** **Pre-commit** com gitleaks + **GitHub secret scanning/push protection** ligado + varredura no CI.
- [ ] [P0] **SEC-03** Auditar o **bundle do front-end**: procurar `sk_`, `secret`, `service_role`, `private`, tokens, URLs internas (`grep` no build). Variáveis públicas (`NEXT_PUBLIC_`/`VITE_`) só com valores **realmente públicos**.
- [ ] [P0] **SEC-04** Segredos em **secret manager** (Vercel/Railway env, AWS SM, Doppler, Vault) — não em código, imagens Docker, logs ou chats com IA.
- [ ] [P0] **SEC-05** Chaves **distintas por ambiente** e **menor privilégio** (IAM, scopes). Plano e **rotina de rotação** de chaves.
- [ ] [P0] **SEC-06** Modo debug/verbose desligado em prod; sem credenciais padrão; sem rotas de teste; source maps de prod não públicos (ou sem conteúdo sensível).
- [ ] [P0] **SEC-07** **MFA em todas as contas de dev/infra:** GitHub, hospedagem, banco, DNS/registrador, e-mail principal, provedor de call, storage. Usar app autenticador/chave física, não SMS.
- [ ] [P1] **SEC-08** Proteção do **domínio**: registrar lock, DNSSEC, **SPF + DKIM + DMARC** (`p=reject` quando maduro), CAA, monitorar *subdomain takeover* e certificados (Certificate Transparency).
- [ ] [P1] **SEC-09** Branch `main` protegida: PR obrigatório, revisão, checks do CI obrigatórios, sem *force-push*; `CODEOWNERS` para áreas críticas (auth, permissões, pagamentos).

---

## 13. INFRAESTRUTURA, TLS E HEADERS

- [ ] [P0] **INF-01** HTTPS/WSS em tudo; TLS ≥ 1.2; **HSTS** (`max-age` longo, `includeSubDomains`, considerar *preload*); redirecionar HTTP→HTTPS.
- [ ] [P0] **INF-02** Headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `frame-ancestors`, `Cross-Origin-Opener-Policy`. Verificar com `curl -I`, Mozilla Observatory e securityheaders.com.
- [ ] [P0] **INF-03** Cookies com `Secure`, `HttpOnly`, `SameSite`; domínio e path mínimos.
- [ ] [P1] **INF-04** Containers: usuário **não-root**, imagem mínima, FS somente leitura quando possível, sem segredos na imagem, scan (Trivy/Grype), sem `--privileged`.
- [ ] [P1] **INF-05** Segmentação de rede: banco/Redis/filas só acessíveis pela rede interna; **serviço de mídia/transcodificação/preview isolado**; SSH só por chave e restrito.
- [ ] [P1] **INF-06** Autoscaling e limites de recursos para absorver pico/DoS; health checks; **kill switches** (desligar uploads, calls, cadastros, convites) sem deploy.
- [ ] [P1] **INF-07** Cache/CDN: não cachear respostas autenticadas/privadas; `Vary` correto; cuidado com *cache poisoning* e *web cache deception*.
- [ ] [P1] **INF-08** Atualização regular de SO/runtime/imagens base; política de patch de CVEs críticas (ex.: 48h).
- [ ] [P2] **INF-09** IaC (Terraform etc.) escaneado (tfsec/Checkov); drift detection.
- [ ] [P2] **INF-10** WAF com regras customizadas para rotas sensíveis; bot management.

---

## 14. DEPENDÊNCIAS E CADEIA DE SUPRIMENTOS (CI/CD)

- [ ] [P0] **DEP-01** Lockfile commitado; instalar com `npm ci`/equivalente; **auditoria automática** (`npm audit`, `pip-audit`, `osv-scanner`, Dependabot/Renovate).
- [ ] [P0] **DEP-02** Revisar **cada nova dependência** (popularidade, mantenedor, *typosquatting*, scripts `postinstall`). Preferir poucas e confiáveis.
- [ ] [P1] **DEP-03** **SAST** no CI (Semgrep, CodeQL) com regras de segurança; **DAST** baseline (OWASP ZAP) em staging.
- [ ] [P1] **DEP-04** GitHub Actions: **pin por SHA**, `permissions:` mínimas no workflow, sem `pull_request_target` com código não confiável, segredos só onde necessários, sem *echo* de segredos.
- [ ] [P1] **DEP-05** Deploy só a partir de CI (sem deploy manual do notebook), com aprovação para produção; artefatos assinados quando possível.
- [ ] [P2] **DEP-06** SBOM gerado por release; política de licenças.

---

## 15. PRIVACIDADE, LGPD E MENORES (validar com jurídico)

- [ ] [P0] **PRV-01** **Política de Privacidade e Termos de Uso** claros, em português, antes do lançamento; base legal por tratamento de dado (LGPD).
- [ ] [P0] **PRV-02** **Menores de idade:** definir idade mínima e mecanismo de verificação compatível com a legislação brasileira (LGPD art. 14 e **ECA Digital — Lei 15.211/2025**, confirmar requisitos vigentes e prazos com advogado). Configurações padrão mais protetivas para menores (DMs de estranhos desativadas, perfil restrito, sem recomendação agressiva).
- [ ] [P0] **PRV-03** **Minimização:** coletar só o necessário. Sem PII em logs, URLs, analytics ou mensagens de erro.
- [ ] [P0] **PRV-04** **Direitos do titular:** exportar meus dados, corrigir, **apagar conta** (apaga mensagens/mídia/tokens/backups dentro de prazo definido), com fluxo testado ponta a ponta.
- [ ] [P1] **PRV-05** **Encarregado (DPO)** e canal de contato; registro das operações de tratamento; RIPD/DPIA para tratamento de maior risco (menores, voz/vídeo).
- [ ] [P1] **PRV-06** **Retenção** definida por tipo de dado (mensagens, logs, mídia, gravações, backups). Job de expurgo automático.
- [ ] [P1] **PRV-07** **Registros de acesso** (logs de conexão) mantidos pelo prazo exigido pelo **Marco Civil da Internet** e protegidos contra adulteração — confirmar obrigação aplicável com jurídico.
- [ ] [P1] **PRV-08** **Plano de incidente de dados:** procedimento para comunicar **ANPD e titulares** no prazo legal (confirmar prazo vigente — regulamentação ANPD) e para contenção.
- [ ] [P1] **PRV-09** Cookies/analytics: consentimento quando exigido; sem *fingerprinting* oculto; terceiros listados.
- [ ] [P1] **PRV-10** **DMs:** descrever honestamente o que é protegido (TLS + criptografia em repouso ≠ E2EE) e **quem na empresa pode acessar** conteúdo e em quais condições.
- [ ] [P1] **PRV-11** **Denúncia e moderação:** botão de denunciar em mensagem/usuário/servidor/mídia; fila de moderação; prazos de resposta; remoção de conteúdo ilegal; canal para autoridades e para **material de abuso sexual infantil** (reporte obrigatório — alinhar com jurídico e entidades como SaferNet/autoridades).
- [ ] [P2] **PRV-12** Transferência internacional de dados (provedores nos EUA etc.): base legal e cláusulas.

---

## 16. LOGS, MONITORAMENTO E RESPOSTA A INCIDENTES

- [ ] [P0] **LOG-01** Logar eventos de segurança: login ok/falha, MFA, reset, troca de e-mail/senha, mudança de permissão/cargo, ban/kick, criação/revogação de token/bot, ações de admin, 401/403 em massa.
- [ ] [P0] **LOG-02** **Nunca** logar: senhas, tokens, cookies, chaves, conteúdo de DMs, dados de cartão, PII desnecessária. Scrub no Sentry/APM.
- [ ] [P1] **LOG-03** Logs centralizados, com retenção, controle de acesso e **proteção contra adulteração**.
- [ ] [P1] **LOG-04** **Alertas:** pico de logins falhos, pico de 403/401, pico de upload, raid de entradas, queda/pico de calls, custo anormal, chave usada de local novo.
- [ ] [P1] **LOG-05** **Runbook de incidente:** quem decide, como **revogar todas as sessões**, **rotacionar chaves**, ativar *kill switches*, preservar evidências, comunicar usuários/ANPD, post-mortem.
- [ ] [P1] **LOG-06** `security.txt` (`/.well-known/security.txt`) + e-mail de **divulgação responsável**; política de resposta a vulnerabilidades.
- [ ] [P2] **LOG-07** Exercício de simulação de incidente (vazamento de chave, conta admin comprometida, ataque de spam em massa) a cada trimestre.

---

## 17. CLIENTES: WEB, PWA, MOBILE, DESKTOP

- [ ] [P1] **CLI-01** **Mobile:** tokens em Keychain/Keystore (não em storage comum); validar deep links e *intents*; WebViews sem JS bridge desnecessária; considerar *certificate pinning* e detecção de root/jailbreak (P2).
- [ ] [P1] **CLI-02** **Desktop (Electron/Tauri):** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP, `webSecurity` ligado, validar navegação/`new-window`, atualizações assinadas.
- [ ] [P1] **CLI-03** **Service Worker/PWA:** escopo mínimo, sem cachear dados privados em cache compartilhado; limpar caches no logout.
- [ ] [P1] **CLI-04** Notificações push: payload mínimo; conteúdo ocultável; token revogado no logout.
- [ ] [P2] **CLI-05** Atualizações automáticas e *force-update* para versões com falha crítica.

---

## 18. SE HOUVER IA (moderação, assistentes, resumos)

- [ ] [P1] **AI-01** **Prompt injection:** mensagens de usuários e conteúdo externo são **dado não confiável**, nunca instruções. Separar claramente instrução × dado.
- [ ] [P1] **AI-02** Menor privilégio nas *tools* da IA; ações destrutivas/irreversíveis exigem confirmação humana; a IA **não** acessa canais que o usuário não pode ler.
- [ ] [P1] **AI-03** Sem segredos no prompt; saída da IA tratada como **input não confiável** (sanitizar antes de renderizar/executar).
- [ ] [P1] **AI-04** Não enviar conteúdo privado (DMs) a provedores de IA sem base legal/consentimento e contrato adequado; informar na política de privacidade.
- [ ] [P2] **AI-05** Limites de custo/tokens por usuário; logs de uso sem conteúdo sensível.

---

## 19. PAGAMENTOS / ASSINATURAS (se existir "Resenha Plus" etc.)

- [ ] [P0] **PAY-01** Nunca tratar dados de cartão: usar provedor (Stripe/Mercado Pago/Pix via PSP). Sem PAN/CVV no servidor ou logs.
- [ ] [P0] **PAY-02** **Preço sempre calculado no servidor**; benefício liberado **somente por webhook assinado** e idempotente — nunca por redirect de "sucesso" do front.
- [ ] [P0] **PAY-03** Entitlements checados no servidor a cada uso; downgrade/estorno revoga benefícios.
- [ ] [P1] **PAY-04** Proteção contra *card testing* (rate limit + captcha), fraude e chargeback; conciliação periódica.

---

## 20. TESTES: COMO PROVAR QUE TUDO ISSO FUNCIONA

**Contas de teste fixas:** `owner`, `admin`, `mod`, `member`, `outsider` (não está no servidor), `banned`, `newbie` (conta nova), `minor` (se aplicável).

**Suítes automatizadas (rodam no CI):**
- [ ] [P0] **TST-01** **Matriz de autorização:** para cada endpoint REST × cada papel → status esperado (200/403/404). Gerar a partir da lista de rotas; **falhar o build** se uma rota nova não estiver na matriz.
- [ ] [P0] **TST-02** **Testes de IDOR:** A tenta ler/editar/apagar recursos de B (mensagem, canal, mídia, convite, DM, token, perfil).
- [ ] [P0] **TST-03** **Testes de WebSocket:** `outsider` tenta *subscribe* em canal privado; `banned` tenta reconectar; evento com `author_id` forjado; frame gigante; flood de eventos; token expirado em conexão aberta; `Origin` errado.
- [ ] [P0] **TST-04** **Concorrência:** 50–100 requisições paralelas em convite com limite de usos, criação de recurso único, cupom, "entrar no servidor", transição de cargo (`Promise.all`, k6, `xargs -P`).
- [ ] [P0] **TST-05** **Upload:** `.php`/`.html`/`.svg`/`.exe` renomeados para `.jpg`; polyglot; imagem 20000×20000 px; arquivo de 500 MB; nome com `../../` e `U+202E`; EXIF com GPS (deve ser removido); acessar URL de mídia sem permissão e com URL expirada.
- [ ] [P0] **TST-06** **XSS:** payloads (`<script>`, `<img onerror>`, `javascript:`, `data:`, SVG, markdown malicioso, nomes de usuário/servidor/canal/arquivo) em **todos** os campos e telas; confirmar que nada executa e que a CSP bloqueia.
- [ ] [P0] **TST-07** **SSRF:** *link preview*/avatar por URL apontando para `http://127.0.0.1`, `http://169.254.169.254`, `http://[::1]`, domínio que resolve para IP interno, redirect para IP interno, DNS rebinding — todos bloqueados.
- [ ] [P0] **TST-08** **Auth:** bruteforce de login/OTP/reset/código de convite (deve bloquear); reuso de refresh token (deve revogar família); JWT com `alg:none`/assinatura trocada/`aud` errada; reset token reutilizado/expirado; enumeração de usuário.
- [ ] [P0] **TST-09** **Calls:** pedir token de call sem permissão (negado); reutilizar token expirado; entrar em sala de outro canal; banido tentando reentrar; mute forçado burlado pelo cliente; webhook do provedor sem assinatura (rejeitado); credencial TURN expirada.
- [ ] [P0] **TST-10** **Segredos:** `gitleaks` no histórico + grep no bundle de produção (`sk_`, `secret`, `service_role`) — resultado deve ser **zero**.
- [ ] [P1] **TST-11** **Mass assignment:** enviar `role`, `is_admin`, `verified`, `price`, `owner_id`, `author_id` extras em cada endpoint de criação/edição.
- [ ] [P1] **TST-12** **Banco:** (Supabase) consultar cada tabela com chave `anon` e com usuário sem relação → deve retornar vazio/negado; testes de SQLi nos campos de busca/ordenação.
- [ ] [P1] **TST-13** **Rate limit/abuso:** flood de mensagens, de cadastros, de convites, de reações, de "digitando"; conta nova tentando DM em massa.
- [ ] [P1] **TST-14** **Headers/TLS:** `curl -I` + Mozilla Observatory + SSL Labs com nota alta; CORS com `Origin` malicioso (deve negar).
- [ ] [P1] **TST-15** **Privacidade:** apagar conta e confirmar que mensagens/mídia/tokens/sessões somem (dentro do prazo); exportação de dados funciona e **só** contém dados do próprio usuário.
- [ ] [P1] **TST-16** **Revogação em tempo real:** remover usuário de canal/servidor durante sessão ativa → perde WS, mídia e call imediatamente.

**Ferramentas:** OWASP ZAP (baseline/full em staging), Burp Suite Community, Semgrep, CodeQL, gitleaks/trufflehog, osv-scanner/`npm audit`, Trivy, Nuclei, k6 (carga/concorrência), `websocat` (WS manual), sqlmap (**somente local/staging**), Playwright (E2E de abuso).

**Cadência:**
- [ ] [P1] **TST-17** Suíte de segurança roda em **todo PR**; ZAP e varredura de dependências **semanais**.
- [ ] [P1] **TST-18** **Pentest externo** (ou revisão por especialista) **antes do lançamento público** e a cada mudança grande (call, pagamentos, E2EE).
- [ ] [P2] **TST-19** Programa de divulgação responsável / *bug bounty* após estabilizar.

---

## 21. PERGUNTAS QUE O CLAUDE CODE DEVE FAZER AO DONO ANTES DE COMEÇAR

1. Qual a stack exata (front, backend, banco, realtime, storage, provedor de call, hospedagem, CDN)?
2. DMs terão E2EE ou só criptografia em trânsito/repouso? (define o que se pode prometer)
3. Qual a idade mínima e como será verificada?
4. Haverá bots públicos, webhooks, pagamentos/assinatura, IA?
5. Haverá gravação de calls ou *screen sharing*?
6. Quem é o encarregado (DPO) e há assessoria jurídica para LGPD/ECA Digital/Marco Civil?
7. Existe ambiente de staging separado de produção?

---

## 22. ORDEM DE EXECUÇÃO RECOMENDADA

1. **Segredos e contas** — SEC-01…SEC-07 (vazamento de chave é a falha mais barata de explorar).
2. **Autorização** — AUZ, PERM, DB-02 (RLS) — vaza tudo se estiver errado.
3. **Autenticação/sessão** — AUTH, SES, REC.
4. **Realtime** — WS-01…WS-07.
5. **Upload/mídia + SSRF** — UPL-01…UPL-10, SSRF-01/02.
6. **Conteúdo do usuário (XSS/CSP)** — XSS-01…XSS-06.
7. **Calls** — CALL-01…CALL-11.
8. **Abuso/rate limit + infra** — RL, INF.
9. **Privacidade/jurídico/menores** — PRV (em paralelo, com advogado).
10. **Logs, incidentes, testes contínuos** — LOG, TST.
11. **P1 e P2 restantes.**

---

## 23. DEFINIÇÃO DE "PRONTO" (Definition of Done) PARA QUALQUER FEATURE NOVA

- [ ] Checagem de autorização no servidor + teste de acesso indevido.
- [ ] Input validado por schema; output escapado/sanitizado.
- [ ] Rate limit e limites de tamanho/custo definidos.
- [ ] Nenhum segredo no código/front/logs; sem PII nos logs.
- [ ] Teste de abuso automatizado no CI (falha sem a proteção).
- [ ] Impacto em privacidade/LGPD avaliado; política atualizada se necessário.
- [ ] `SECURITY_AUDIT.md` atualizado; threat model revisado.

---

### Prompt sugerido para colar no Claude Code

```
Leia SECURITY_CHECKLIST.md por completo. Antes de mudar qualquer código, responda às perguntas da
seção 21 olhando o repositório (stack, realtime, storage, call, etc.) e me pergunte o que não
conseguir descobrir. Depois execute a auditoria seção por seção, na ordem da seção 22: para cada
item classifique OK/FALTA/PARCIAL/N/A com evidência (arquivo:linha), corrija o que faltar e escreva um
teste de abuso que falhe sem a correção. Faça um commit por seção. Nunca afrouxe uma proteção para
passar teste. Se achar segredo exposto, pare e me avise para rotacionar. Ao final, gere
SECURITY_AUDIT.md com a tabela de status.
```
