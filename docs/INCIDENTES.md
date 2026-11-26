# Resenha — Plano de resposta a incidentes (runbook)

> Itens do checklist: **LOG-05**, **PRV-08**, **INF-06**. Este documento é para ser lido **antes** de precisar dele.
> Quem decide: a equipe do Resenha (hoje, o dono). Em dúvida, **contenha primeiro, investigue depois**.

## 0. Antes de tudo (30 segundos)

1. Respire. Anote a **hora** em que você descobriu o problema.
2. **Não apague nada** (logs, mensagens, contas suspeitas): é evidência.
3. Decida a gravidade:
   - **Crítico**: chave/senha vazada, conta da equipe invadida, dados de pessoas expostos, banco acessado por estranho.
   - **Alto**: onda de contas invadidas, bot malicioso, abuso em massa (spam/raid/upload de lixo).
   - **Médio/baixo**: bug de permissão sem exploração conhecida, denúncia de vulnerabilidade.

## 1. Contenção (sem precisar publicar código)

Tudo fica em **Painel da equipe → Saúde → "🚨 Chaves de emergência"** (só contas da equipe):

| O que está acontecendo | O que fazer |
|---|---|
| Raid de entradas por convite | Ligar **"Entrar por convite"** (desliga a entrada por convite para todos) e, se for cadastro em massa, **Painel → Novas contas → fechar cadastro** |
| Spam/assédio por mensagens privadas | **"Abrir conversas privadas novas"** |
| Upload de arquivo abusivo (malware, conteúdo ilegal) | **"O envio de arquivos"** |
| Abuso de chamadas / custo de TURN | **"As chamadas de voz"** |
| Bot malicioso | **"Os bots"** (bloqueia a API de bots e os comandos), e depois apagar o bot (Configurações → Desenvolvedor, ou pela equipe) |
| Suspeita de contas invadidas / sessão roubada / chave vazada | **"Sair de TODOS os aparelhos"** (derruba todas as sessões, menos a sua; todo mundo precisa entrar de novo) |

- As chaves valem **na hora** (cache de 5 s) e são desfeitas desmarcando a caixa.
- Cada mudança fica no log do servidor (`[segurança] chaves de emergência alteradas por @...`).
- Para uma conta específica: Painel da equipe → Denúncias/Contas → **suspender**; o usuário perde a sessão e o WebSocket na hora.

## 2. Se uma chave/segredo vazou

**Apagar o commit não basta: considere a chave comprometida e rotacione.** Ordem:

1. Gere a nova chave no provedor e **troque no Render** (Environment) → o deploy reinicia sozinho.
2. **Revogue a antiga** no provedor (só depois de a nova estar no ar).
3. Faça **"Sair de TODOS os aparelhos"** se a chave for de sessão/criptografia.
4. Procure uso indevido (painel do provedor: acessos de IP/região estranhos, custo anormal).

| Segredo | Onde fica | Cuidado ao trocar |
|---|---|---|
| `DATABASE_URL` (Neon) | Render | Troque a senha da role no Neon; atualize no Render |
| `SECRETS_KEY` | Render | **Não** troque sem planejar: ela cifra os segredos de 2FA e de bots. Trocar invalida o 2FA salvo (as pessoas reconfiguram) e os segredos de assinatura dos bots (rotacionar na tela do bot) |
| `BACKUP_KEY` | Render | Backups antigos continuam precisando da chave antiga: guarde-a offline |
| R2 / Cloudflare (`R2_*`) | Render | Crie token novo no Cloudflare, depois apague o antigo |
| Brevo (`BREVO_*`), Turnstile, Metered/Cloudflare TURN | Render | Crie nova chave no provedor |
| `YOUTUBE_API_KEY`, chaves de IA | Render | Crie nova no Google/provedor |
| Token de um bot | Configurações → Desenvolvedor → "Gerar novo token" (pede a senha) | O token antigo morre na hora |
| Segredo de assinatura de um bot | idem | O dono do bot precisa atualizar no código dele |

Depois de rotacionar: rode `npm run security:scan` para garantir que não ficou nada no repositório.

## 3. Se uma conta da equipe foi invadida

1. **"Sair de TODOS os aparelhos"** (de outra conta da equipe) e **suspenda** a conta invadida.
2. Troque a senha e refaça o 2FA (a conta da equipe exige 2FA se `ADMIN_REQUIRE_2FA=1`).
3. Veja o **registro de auditoria** dos servidores e o histórico de segurança da conta para saber o que foi feito.
4. Troque as chaves a que a conta tinha acesso (seção 2) e as contas de infraestrutura (GitHub, Render, Neon, Cloudflare, domínio): ligue **MFA** em todas.

## 4. Preservar evidências

- Logs do Render: baixe e guarde (o Render guarda pouco tempo).
- Exporte as linhas relevantes do banco (sessões, eventos de segurança, denúncias) **antes** de apagar qualquer coisa.
- Anote: linha do tempo (quando começou, quando foi descoberto, o que foi feito e por quem), contas e IPs envolvidos.
- Não responda ao atacante e não publique detalhes ainda.

## 5. Comunicação

**Se houve acesso a dados pessoais** (mensagens privadas, e-mails, senhas, arquivos):

- A LGPD (art. 48) exige comunicar a **ANPD e os titulares** quando o incidente puder causar risco ou dano relevante. O prazo e o formato vigentes vêm da regulamentação da ANPD — **confirme com o advogado** na hora (a regra que costuma ser citada é de **3 dias úteis**, mas valide). Por isso: **avise o advogado no primeiro dia**.
- A comunicação aos usuários deve dizer, em português simples: o que aconteceu, quais dados, o que já foi feito, o que a pessoa deve fazer (trocar senha, ativar 2FA, desconfiar de mensagens) e o contato.
- Contato de segurança: `/.well-known/security.txt` do site.
- Se houver **material de abuso sexual infantil**: não copie nem compartilhe o arquivo; bloqueie o envio (chave "O envio de arquivos" se necessário), preserve apenas os identificadores (conta, horário, id do anexo) e denuncie à **SaferNet/Disque 100/Polícia** com orientação do advogado.

## 6. Depois do incidente (post-mortem em até 7 dias)

1. O que aconteceu, e a linha do tempo.
2. Por que a proteção falhou (ou por que não existia).
3. O que muda: **teste de abuso novo** em `e2e/` que falhe sem a correção, e atualização do `SECURITY_AUDIT.md`.
4. Se for o caso, nota pública na página de Segurança.

## 7. Simulações (a cada 3 meses — LOG-07)

Treine pelo menos uma por trimestre, em ambiente de teste: (a) vazamento de uma chave, (b) conta da equipe invadida, (c) ataque de spam em massa. Verifique que as chaves de emergência funcionam (`node e2e/killswitch.mjs` prova no código; o treino prova que **você** sabe usá-las).

## 8. Contatos úteis (preencher)

- Advogado/assessoria LGPD: _______
- Encarregado (DPO): _______
- Render / Neon / Cloudflare / Brevo: suporte pelo painel de cada um
- ANPD: https://www.gov.br/anpd
- SaferNet: https://new.safernet.org.br/denuncie
