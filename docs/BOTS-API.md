# Bots do Resenha: guia para quem programa

> **Em teste.** Por enquanto só contas liberadas pela equipe (recurso "botdev") criam bots, e só contas com o recurso "bots" instalam em servidores.

Um bot é uma conta especial (selo **BOT**) controlada por um programa seu. Você escreve o código onde quiser (seu computador, um servidor, Render, Vercel...): **o Resenha não hospeda nada**. Há duas formas de o bot agir, e dá para usar as duas juntas:

1. **Comandos**: alguém digita `/ping oi`; o Resenha chama o **endereço do seu bot** e posta a resposta.
2. **API**: o bot escreve nos canais quando quiser, usando o **token**.

## 1. Criar o bot
Configurações → **Desenvolvedor** → *Criar um bot*. Aparecem uma vez só:
- **Token** (`bot_…​.…`): a senha do bot. Nunca coloque em código público. Se vazar, use *Gerar novo token* (o antigo para na hora).
- **Segredo de assinatura**: serve para conferir que as chamadas vêm do Resenha.
- **ID do bot** (`bot_` + 16 letras/números): é público; quem administra um servidor usa para instalar o bot.

Cada pessoa pode ter até **3 bots**.

## 2. Registrar os comandos
`PUT /api/bot/commands` com a lista **completa** (até 25). Nomes: 1 a 20 letras minúsculas, números ou `_` (o chat reconhece esses mesmos caracteres). Os nomes dos comandos do Resenha Bot (`dado`, `moeda`, `sortear`, `enquete`, `lembrar`, `ajuda`, `tocar`, `proxima`, `pular`, `fila`, `agora`, `parar`, `remover`, `ticket`, `times`, `marcar`, `call`, `procurando`, `8bola`) são reservados: se o seu lote tiver algum deles, os outros comandos são registrados normalmente e a resposta traz `skipped` com os nomes ignorados.

```bash
curl -X PUT https://resenhabr.com.br/api/bot/commands \
  -H "Authorization: Bot SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"name":"ping","description":"Responde pong","usage":"/ping texto"}]}'
```
Dois bots no mesmo servidor não podem ter o mesmo comando: o Resenha recusa a instalação do segundo.

## 3. Receber comandos (endereço do bot)
Coloque no cartão do bot o **endereço** que recebe as chamadas. Regras do endereço (protegem o Resenha e você): **https**, porta **443**, um nome de site (não IP) que aponte para a internet pública. Endereços de rede interna são recusados.

Quando alguém usa `/ping oi`, o Resenha faz um `POST` JSON nesse endereço:
```json
{
  "type": "command",
  "id": "…",
  "command": "ping",
  "args": "oi",
  "user":    { "id": "…", "username": "bia", "displayName": "Bia" },   // id derivado POR BOT: não é o id interno e muda de bot para bot
  "channel": { "id": "…", "name": "geral" },
  "guild":   { "id": "…", "name": "Galera" }
}
```
Cabeçalhos: `X-Resenha-Timestamp` (segundos) e `X-Resenha-Signature` = `v1=` + `HMAC-SHA256(segredo, "<timestamp>.<corpo>")` em hexadecimal.

**Confira a assinatura** e recuse carimbos com mais de 5 minutos:
```js
import { createHmac, timingSafeEqual } from 'node:crypto';
function ok(req, rawBody, secret) {
  const ts = req.headers['x-resenha-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = 'v1=' + createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const got = String(req.headers['x-resenha-signature'] ?? '');
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
```

**Proteção contra repetição (replay):** o corpo traz um `id` único por chamada. Guarde os ids dos últimos 5 minutos e recuse repetidos, além de conferir o carimbo.

**Responda em até 3 segundos** com JSON (`content` e/ou `embed`):
```json
{ "content": "pong oi",
  "embed": { "title": "Eco", "description": "**texto**", "color": "#7c6cff",
             "fields": [{ "name": "a", "value": "b" }] } }
```
- Para responder depois: devolva `202` (ou `{"deferred":true}`) e use a API (passo 4).
- Limites: `content` até **2000 caracteres** (não 32 KB: 32 KB é só o tamanho máximo da resposta inteira); até 10 campos no embed; cor no formato `#rrggbb`.
- Erros, respostas lentas, JSON inválido ou formato errado viram uma mensagem clara para quem usou o comando ("Seu Bot: o bot demorou demais para responder.") e ficam no **registro de erros** do bot, em Configurações → Desenvolvedor → "Últimos erros do bot".
- Caracteres invisíveis e de inversão de texto (U+202E...) são removidos das respostas do bot.
- Embeds mostram só texto (sem imagens de fora). `@everyone` nunca vale para bots.

## 4. Escrever nos canais (API)
```bash
curl -X POST https://resenhabr.com.br/api/bot/channels/ID_DO_CANAL/messages \
  -H "Authorization: Bot SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Pronto!"}'
```
- Só em **canais de texto de servidores onde o bot está instalado** (nunca conversas privadas; canais de avisos só se o servidor permitir).
- A **moderação automática** do servidor vale para o bot (palavras proibidas, links, convites, spam).
- Limites: **5 mensagens a cada 5 s por canal**, **30 a cada 10 s** no total, **120 chamadas por minuto**, mensagem de até **2000 letras**. Passou do limite: resposta `429`.
- `GET /api/bot/me` mostra o bot, os servidores e os comandos.

## 5. Instalar no servidor
Quem tem **Gerenciar servidor**: Configurações do servidor → **Integrações** → *Adicionar pelo ID do bot* → conferir o nome/dono → *Adicionar ao servidor*. O bot entra na lista de membros com o selo BOT e os comandos aparecem no `/`. Cada servidor aceita até 10 bots. Remover o bot do servidor ou apagá-lo desliga tudo na hora.

## Segurança e regras
- **Token e segredo**: guardados no seu ambiente (variáveis de ambiente), nunca no código nem em prints. O Resenha guarda só um hash do token.
- O bot **só recebe** o texto dos comandos usados no servidor onde está instalado. Não recebe mensagens comuns, conversas privadas nem dados de conta.
- A equipe do Resenha pode desligar bots que abusem (spam, golpes, coleta de dados) e os donos respondem pelo que o bot faz.
- Bots não recebem pedido de amizade nem mensagem privada, e ninguém entra na conta de um bot.
