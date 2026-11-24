# E-mail que demora ou cai no spam: como resolver

Sintoma: a pessoa pede o código de confirmação e o e-mail demora (ou nunca aparece na caixa de entrada).

## O que o Resenha já faz sozinho
- O envio não trava a tela: em até ~5 s o cadastro segue e, se a Brevo ainda não respondeu, o e-mail continua sendo enviado
  em segundo plano (e tentado de novo se a Brevo der erro momentâneo).
- Um atraso **não apaga** o cadastro pendente. O código do e-mail que chegar depois continua valendo.
- Pedir outro código, ou cancelar e refazer o cadastro com o mesmo e-mail, **não invalida o anterior**: vale o que chegar primeiro.
- Painel da equipe → Sistema → E-mails mostra quanto a Brevo leva para aceitar cada envio. Se isso é rápido (1–2 s) mas a pessoa
  recebe tarde, o atraso está na **entrega** (provedor da pessoa), não no Resenha.

## A causa mais comum de atraso: remetente @gmail.com
Enviar pela Brevo com `EMAIL_FROM` de uma conta @gmail.com faz o Gmail desconfiar (o e-mail diz ser do Gmail, mas não saiu do Gmail).
O resultado é o e-mail ficar um tempo retido, ir para o spam ou ser recusado. A correção é **autenticar o domínio do Resenha na Brevo**:

1. Brevo → **Senders, domains & IPs → Domains → Add a domain** → `resenhabr.com.br`.
2. A Brevo mostra alguns registros DNS (DKIM, um código de verificação e, se ainda não existir, DMARC). Copie exatamente como ela mostra.
3. Cloudflare → o domínio → **DNS → Records → Add record** para cada um. Deixe cada registro **somente DNS (nuvem cinza)**, nunca com a nuvem laranja.
4. Volte na Brevo e clique em **Verify**/**Authenticate**. Pode levar de alguns minutos a algumas horas.
5. No Render, troque as variáveis:
   - `EMAIL_FROM=nao-responda@resenhabr.com.br` (qualquer endereço do domínio, não precisa existir caixa de entrada)
   - `EMAIL_REPLY_TO=` o seu e-mail de atendimento (para as respostas chegarem em algum lugar)
6. Peça um código de teste (Painel da equipe → Sistema → E-mails → enviar teste) e confira se chegou rápido e na caixa de entrada.

## Conferir no lado da Brevo
Brevo → **Transactional → Logs**: mostra cada e-mail com o horário em que foi aceito, entregue ou se ficou adiado (deferred/soft bounce).
Se aparece "delivered" rápido mas a pessoa recebeu tarde, o provedor dela segurou. Se aparece adiado, o problema é de reputação do remetente (veja acima).

## Se a pessoa disser que não chegou
- Peça para olhar spam/promoções e esperar 2–3 minutos antes de pedir outro código.
- Pedir outro código é seguro: o anterior continua valendo.
- Limites: 1 reenvio a cada 45 s, até 5 por cadastro, e 5 cadastros por hora por e-mail.
