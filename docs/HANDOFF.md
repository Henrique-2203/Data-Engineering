# Handoff — para continuar exatamente de onde paramos

Atualizado no fim da sessão de 27/11/2026. Regras permanentes: `CLAUDE.md`. Estado: `docs/PROJECT_STATUS.md`. Problemas: `docs/KNOWN_ISSUES.md`.

## Primeiros passos de uma nova sessão (5 minutos)
1. `git status` e `git log --oneline -10` na branch `claude/screen-sharing-app-w2m6ft` (a única de trabalho; `main` não é tocada sem pedido).
2. `npm ci && npm run typecheck && npm run build` para confirmar que está verde.
3. Rode `node e2e/smoke.mjs` e `npm run test:security` (sequencial). Se algo falhar sem você ter mexido, veja "Testes: instabilidades" em `docs/KNOWN_ISSUES.md` antes de supor bug.
4. Leia a seção "Aguardando o dono" abaixo e pergunte o que mudou antes de começar algo novo.

## Onde estamos
- **Último commit antes desta documentação:** tela "sem conexão" no app Android (hash na história do git, mensagem começa com "App Android: tela própria…").
- Todo o trabalho está **commitado e enviado** à branch de trabalho; o Render já publica a cada push.
- Última rodada de testes (segurança, bots, voz, câmera, moderação, avisos): **verde**. Regressão ampla foi rodada na auditoria de segurança; depois disso rodamos só as suítes dos assuntos tocados.
- Sequência recente de entregas (da mais antiga à mais nova): auditoria de segurança completa → chaves de emergência → bloqueio de pessoas → DJ só áudio com "Ouvir" → correções do relatório externo de bots (erros 424, DNS ao salvar, texto invisível, id por bot) → prazo total no cliente HTTP de bots → filtro de nomes com homóglifos → confirmações/avisos próprios (sem `confirm()` nativo) → câmera do celular (virar várias vezes) e volume até 200% → sites liberados na moderação automática → câmera direta no celular → tela "sem conexão" no Android.

## Fase 1 do core de transmissão (em auditoria)
- Trabalho em branch isolada (`claude/dreamy-albattani-5wws7x`), **fora da branch de deploy**. Nada foi publicado; o dono autoriza o merge depois da auditoria independente.
- Entregue: roteamento único do Turbo (corrige reinício/troca de tela), `bye` para encerramento intencional, estados e eventos do transporte, métricas precisas, modo desempenho com evidência. Detalhes em `docs/PROJECT_STATUS.md`, `docs/DECISIONS.md` e `docs/KNOWN_ISSUES.md`.
- Falta: **validar em dois PCs Windows** (`docs/VALIDACAO-TURBO.md`). A causa do limite de captura (≈41/37 FPS) segue **aberta**; não declarar os 60 FPS resolvidos sem evidência de hardware real.
- Testes novos: `e2e/turbo-lifecycle.mjs`, `e2e/limits-unit.ts`; ampliados `e2e/turbo.mjs`, `e2e/health.mjs`, `e2e/diagnostics.mjs`.

## Aguardando o dono (não dá para o Claude fazer)
- **Segurança de contas/infra:** MFA em GitHub/Render/Neon/Cloudflare/registrador/e-mail/Brevo; definir `SECRETS_KEY` e `ADMIN_REQUIRE_2FA=1`; secret scanning + push protection + proteção da `main`; senha nova no Neon; SPF/DKIM/DMARC; rodar Observatory/SSL Labs. (Passo a passo já foi entregue; ver `docs/ROADMAP.md` P0.)
- **Decisões:** liberar bots "Para todos"; reescrever histórico do git (nome de usuário antigo); convites com validade; "quem pode me chamar"; idade mínima/verificação (advogado); site de teste separado (custo).
- **Android 1.0.3:** aprovar e lançar (subir versão, apontar `android/release.json`); conferir segredo de assinatura no GitHub; **testar num aparelho real**.
- **Confirmações em uso real:** voz baixa com supressão desligada; virar câmera do celular; app Android após atualização.
- **Limpeza do teste externo de bots:** apagar o bot de teste, o projeto na Vercel e o repositório usados (o dono sabe quais).

## Próximas tarefas sugeridas (ordem)
1. Se o dono responder sobre voz baixa: analisar o "Relatar problema" recebido (`voice/diagnostics.ts`, `explain()`).
2. Preparar release Android 1.0.3 (só com aprovação).
3. Preparar a abertura dos bots: Termos/Privacidade, denúncia de bot, desligar bot que falha muito, cota por conta (`docs/ROADMAP.md` P1.2).
4. DM-02, convites com validade, alertas ativos, teste de concorrência (P1.3–P1.7).
5. Manter `SECURITY_AUDIT.md` e estes docs atualizados a cada mudança.

## Como o dono trabalha (preferências)
- Fala **português do Brasil**; quer explicações **simples, passo a passo**, sem presumir conhecimento técnico.
- Testa pelo celular e pelo PC, relata problemas de usuários reais (às vezes com capturas de tela). Responda dizendo **o que era, o que mudou, o que foi testado e o que não foi validado**.
- Pede **honestidade**: não prometa o que não foi verificado; deixe claro o que é hipótese.
- Entrega de arquivos para ele: use `SendUserFile` com caminhos dentro do repositório (ele só abre arquivos da pasta do projeto).
- Às vezes está ocupado: deixe tarefas dele em lista curta e guarde os passos detalhados para quando pedir.
- Nunca peça segredos no chat. Ele mascara senhas ao colar URLs ("SENHAOCULTA").

## Mapa rápido para achar coisas
| Quero… | Vá em… |
|---|---|
| Entender uma rota/regra do servidor | `server/src/<assunto>.ts` (`docs/ARCHITECTURE.md`) |
| Mexer em permissões | `server/src/access.ts`, `shared/permissions.ts`, teste `e2e/permissions.mjs` e `e2e/authz-matrix.mjs` |
| Chamada de voz/transmissão | `client/src/voice/engine.ts`, `peer.ts`; servidor `realtime.ts` |
| DJ / assistir juntos | `server/src/botDj.ts`, `realtime.ts` (together), `client/src/components/Together.tsx` |
| Bots de terceiros | `server/src/botApps.ts`, `safeFetch.ts`, `docs/BOTS-API.md`, `exemplos/bot-exemplo` |
| Segurança (status de cada item) | `SECURITY_AUDIT.md` (IDs do checklist) e `docs/INCIDENTES.md` |
| Janelas de confirmação/aviso | `client/src/lib/ask.tsx` |
| App Android / Windows | `android/` (Java, WebView) e `desktop/` (Electron); workflows em `.github/workflows/` |
| Limites e custos | `docs/CAPACIDADE.md`, `render.yaml` |
| Roteiro manual de testes | `docs/ETAPAS-E-TESTES.md` |

## Checklist antes de dar push
Typecheck verde · `npm run build` · testes dos assuntos tocados (sequencial) · `npm run security:scan` · sem nomes reais/e-mails/segredos nos arquivos · docs de estado atualizados · mensagem de commit com a atribuição do ambiente.
