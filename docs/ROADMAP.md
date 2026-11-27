# Roadmap

Prioridades em ordem. Itens de segurança têm o ID do checklist em `SECURITY_AUDIT.md`. "Dono" = ação só da pessoa dona do projeto (contas, painéis, jurídico); o Claude não consegue fazer.

## P0 — Segurança e operação (antes de divulgar mais)
| Item | Quem | Observação |
|---|---|---|
| MFA em GitHub, Render, Neon, Cloudflare, registrador, e-mail principal, Brevo (SEC-07) | Dono | Passo a passo já entregue em conversa; app autenticador, não SMS |
| Definir `SECRETS_KEY` e `ADMIN_REQUIRE_2FA=1` no Render | Dono | Ativar 2FA na própria conta do Resenha **antes** do `ADMIN_REQUIRE_2FA` |
| GitHub: secret scanning + push protection; proteger `main` (SEC-02/09) | Dono | A branch de trabalho continua sendo a do deploy |
| Senha forte nova da role no Neon e atualizar `DATABASE_URL` (DB-03/04) | Dono | **Não** trocar por role sem DDL: o app cria tabelas no boot |
| SPF + DKIM + DMARC no domínio de e-mail (SEC-08) | Dono | `docs/EMAIL.md` |
| Rodar Observatory/SecurityHeaders/SSL Labs no domínio real (TST-14) | Dono | Mandar resultado ao Claude para ajustar cabeçalhos |
| Chave `YOUTUBE_API_KEY` no Render (já feita; conferir cota) | Dono | |

## P1 — Próximas funcionalidades
1. **Lançar app Android 1.0.3** (tela "sem conexão", avisos JS): subir `versionCode/versionName`, apontar `android/release.json`, confirmar segredo `ANDROID_KEY_PASS` (senão o Android pede desinstalar). Testar em aparelho real.
2. **Abrir bots a todos** (decisão do dono): antes, atualizar Termos/Privacidade para bots de terceiros (LGPD), **denúncia de bot**, **desligar sozinho bot que falha muito**, cota de bots por conta, revisão do `YOUTUBE_API_KEY`/cota do DJ.
3. **"Quem pode me chamar"** (DM-02: todos/amigos/ninguém) e limites para estranhos.
4. **Convites com validade e limite de usos** (INV-01) + log de quem convidou (INV-02) + **anti-raid automático** (INV-03).
5. Reautenticação periódica de WebSocket e idempotência de mensagens (WS-07/10).
6. Alertas ativos (e-mail/push) para pico de falhas de login, raid e custo (LOG-04).
7. Teste de concorrência (50–100 requisições paralelas) para convite/entrada/cargo (TST-04/API-05).
8. Esconder prévia de notificação push (WS-12) e "reverter troca de e-mail" (REC-03).

## P2 — Endurecimento contínuo
Argon2id (AUTH-01) · passkeys (AUTH-09) · mídia em domínio separado sem cookies (UPL-09) · antivírus assíncrono (UPL-13) · moderação de imagem/CSAM e fluxo legal (UPL-15, com advogado) · rate limit centralizado (Redis) se houver mais de uma instância (RL-01) · proxy de imagens externas (SSRF-03) · Safe Browsing para links (IMP-03) · papel do app sem DDL com migração separada (DB-03) · SBOM (DEP-06) · simulações trimestrais de incidente (LOG-07) · bug bounty (TST-19) · **pentest externo antes de divulgação em escala** (TST-18).

## Produto (ideias aceitas, sem prioridade definida)
- Mudo forçado imposto de verdade (exige SFU; hoje só funciona em P2P por boa-fé do cliente).
- SFU para grupos grandes (laboratório Cloudflare já existe).
- Bots: botões/menus, webhooks simples, bots que escutam o chat.
- Site de teste separado do oficial (`docs/LANCAMENTOS.md`): adiado para não estourar as 750 h do Render; reavaliar se o oficial migrar para plano pago.
- Vídeos de divulgação (fixadas, DJ, bloqueio); mais conteúdo em `promo/`.

## Jurídico/produto (precisa de advogado e decisão do dono)
Idade mínima e verificação (ECA Digital, Lei 15.211/2025; hoje 13 anos nos Termos, sem verificação) · encarregado (DPO) e RIPD · política de retenção por tipo de dado · guarda de registros de acesso (Marco Civil) · prazo de comunicação à ANPD (`docs/INCIDENTES.md`) · reescrever o histórico do git que ainda contém um nome de usuário real (decisão do dono).

## Fora de escopo por decisão
Criptografia ponta a ponta de mensagens de texto · gravação de chamadas · pagamentos com cartão · login social. (`docs/DECISIONS.md`)
