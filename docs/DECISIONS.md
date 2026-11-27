# Decisões técnicas e de produto

Cada item: **decisão** · por quê · alternativas descartadas. Antes de mudar uma decisão, converse com o dono.

## Infraestrutura e custo
- **Tudo em plano grátis** (Render, Neon, Cloudflare R2/Turnstile, Brevo, Metered, GitHub). Por quê: projeto sem receita fixa. Qualquer serviço pago ou dependência com custo exige aprovação do dono. Teto financeiro: IA e TURN extra desligados ou com teto (`AI_MONTHLY_BUDGET_USD`, `TURN_QUOTA_MB`).
- **Um site só, deploy a cada push da branch de trabalho; sem site de teste.** Por quê: duas instâncias estourariam as 750 h grátis do Render. Passo a passo pronto em `docs/LANCAMENTOS.md`. Rollback pelo Render (Events → Rollback).
- **Banco Postgres no Neon; PGlite local e nos testes.** Descartado: SQLite (sem persistência no Render grátis). O esquema é criado no boot (idempotente), então o app **precisa de role com DDL**; separar migração antes de reduzir privilégios.
- **Arquivos no Cloudflare R2** (10 GB grátis, sem custo de saída) com fallback no banco. Descartado: S3 pago.
- **Projeto acadêmico `playlink` fica fora do Resenha:** Supabase + Vercel, não Render (as 750 h seriam compartilhadas) nem o Neon do Resenha.

## Chamadas
- **Malha P2P WebRTC** (sem servidor de mídia). Por quê: custo zero e menor latência para grupos pequenos. SFU Cloudflare só em laboratório. Consequência: mudo forçado não é imposto no cliente (aceito).
- **TURN de provedor com credenciais efêmeras** (Metered grátis; Cloudflare opcional). Nunca credencial fixa no front.
- **Texto não é E2E; só chamadas são criptografadas (DTLS-SRTP).** O produto nunca deve prometer E2E de mensagens.
- **Ruído por IA no próprio aparelho** (GTCRN "Forte", RNNoise "Leve"), com queda automática para o navegador se o aparelho não der conta.
- **Câmera do celular por QR Code** com pareamento em memória (2 min, uso único, mesma conta). No celular/tablet o botão liga a câmera direto (QR não faz sentido).

## Contas e sessão
- **Sessão opaca de 256 bits em cookie `__Host-` HttpOnly** (hash no banco, máx. 180 dias, revogável na hora). Descartado: JWT (não revogável) e token em localStorage (XSS).
- **scrypt (N=2¹⁶)** em vez de Argon2id: parâmetros aprovados pela OWASP, sem dependência nativa. Migração transparente no login. Argon2id fica no roadmap.
- **2FA obrigatório só para a equipe** (`ADMIN_REQUIRE_2FA=1`); segredos de 2FA e de bots cifrados (`SECRETS_KEY`).
- **Equipe não lê DMs** e não tem "logar como".

## Segurança
- **Negar por padrão + matriz de autorização que falha o build** para rota nova sem login fora da lista pública.
- **Toda imagem é re-encodada** (remove EXIF, payload escondido e "poliglotas"); SVG/HTML nunca inline.
- **Imagens externas só com clique** (não vazam o IP de quem lê); proxy de mídia descartado por ora.
- **Nomes que imitam a equipe** passam por esqueleto de homóglifos; letra desconhecida vira curinga `?`. Em apelido/canal só "Resenha + cargo oficial" é barrado ("resenha" sozinho é palavra comum).
- **Chaves de emergência** (uploads, convites, DMs, chamadas, bots) e "sair de todos os aparelhos", sem deploy. Runbook: `docs/INCIDENTES.md`.
- **Nunca `confirm()/alert()/prompt()` nativos**: `askConfirm`/`askNotice`/`askText`. Por quê: somem em Android/Electron e a ação falha em silêncio.
- **Erros de bot com status 424** (hospedagem troca 5xx por página genérica).

## Bots
- **Primeiro "bots da casa", depois bots de terceiros** por webhook assinado (HMAC + carimbo) e API com token; **hospedados fora do Resenha** (Vercel de graça). Descartado: rodar código de terceiros no servidor.
- **Chamada ao bot só por `safeFetch`:** https/443, DNS conferido e IP fixado, sem redirect, prazo total 3 s, 32 KB. Bot nunca usa `@todos`, nunca lê canais privados, não recebe DM.
- **`user.id` enviado ao bot é derivado por bot** (privacidade).
- **Tudo de bots fechado a contas da lista** até "Para todos"; **IA dos bots desligada por ora** (custo/privacidade).
- **DJ:** player do YouTube **escondido** (só áudio) + **cada pessoa escolhe ouvir**; o servidor avança a fila pela duração se ninguém ouve. Descartado: extrair áudio no servidor (viola termos do YouTube, custa CPU/banda no Render grátis).

## Produto
- **Bloqueio de pessoas:** mútuo para DM/pedido/ligação/presença; quem foi bloqueado **não é avisado**; aviso com @ ao entrar numa call com bloqueado (nome e foto podem mudar); mensagens recolhidas só no app.
- **Moderação automática:** liberação por **cargo isento** ou **sites liberados** (subdomínios valem; compara o host real, não o texto). Descartado por ora: permissão individual "enviar links" estilo Discord.
- **Apoio por Pix manual** (sem cartão, sem webhook), confirmado pela equipe. Nomes/valores só para a equipe.
- **Layout novo e câmera do celular liberados a todos** após beta com lista de contas; bots seguem fechados.
- **Convites de servidor permanentes** (por simplicidade) — roadmap para validade/limite.
- **Apps nativos são casca do site:** Android = WebView (atualização própria via `android/release.json`, só após aprovação); Windows = Electron com atualizador.

## Processo
- **Um commit por assunto; testes de abuso que falham sem a correção; auditoria em `SECURITY_AUDIT.md`.** Teste novo de segurança entra no CI.
- **Docs de continuidade** (`CLAUDE.md`, `docs/HANDOFF.md`...) devem ser atualizados a cada mudança de estado, sem nomes reais, e-mails ou segredos (repositório público).

## Turbo (fase 1)
- **Um único caminho decide o transporte de cada espectador** (`routeViewer`): turbo ou WebRTC, nunca os dois para o vídeo. Respostas assíncronas de uma transmissão antiga são descartadas (`screenGen`).
- **Fechar o canal turbo de propósito sempre avisa `bye`** (transmissor→espectador e espectador→transmissor): não é queda e não dispara recuperação.
- **`null` = não medido, `0` = medido zero.** Contas em `client/src/voice/limits.ts` (testadas em Node). A causa do limite só é afirmada com medida que a sustente.
- **Modo desempenho** reduz resolução só com evidência sustentada do codificador; captura lenta e latência isolada não bastam. Não aumentamos bitrate para tratar FPS baixo.
