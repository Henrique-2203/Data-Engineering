# Bot de exemplo para o Resenha

Um bot pronto para você publicar de graça e ver tudo funcionando. Ele mostra os **3 jeitos** de um bot agir:

1. **Responder comandos**: `/ping`, `/eco texto`, `/hora`, `/piada`, `/clima cidade`.
2. **Mandar avisos sozinho** num canal (pelo `/painel`).
3. **Usar serviços da internet**: o `/clima` consulta a previsão do tempo.

Para criar o seu, troque os comandos em `bot.js` (a lista `COMANDOS`): cada comando é uma pequena função que devolve um texto e/ou um cartão.

## Passo a passo (uns 20 minutos)

**1. Criar o bot no Resenha** (sua conta precisa ter o recurso "Criar o próprio bot")
Configurações → **Desenvolvedor** → *Criar um bot* → nome "Bot Exemplo". Aparecem o **token** e o **segredo de assinatura**:
copie os dois para um bloco de notas (não aparecem de novo). Anote também o **ID do bot** (`bot_…`).

**2. Colocar este projeto no GitHub**
Crie um repositório novo, por exemplo `bot-exemplo`. Em *Add file → Upload files*, **arraste as pastas e os arquivos** (a pasta `api`
e os arquivos `bot.js`, `package.json`, `vercel.json`, `servidor.js`). Arraste as pastas, não use o botão "choose your files". Dê *Commit*.

**3. Publicar na Vercel**
vercel.com → *Add New → Project* → escolha o repositório → em *Environment Variables* crie:
| Nome | Valor |
|---|---|
| `BOT_TOKEN` | o token do passo 1 |
| `SIGNING_SECRET` | o segredo de assinatura do passo 1 |
| `ADMIN_KEY` | uma senha que você inventa (para abrir o painel do bot) |

Clique em *Deploy*. Você ganha um endereço como `https://bot-exemplo-xxxx.vercel.app`. Abra-o: deve aparecer "Bot de exemplo do Resenha no ar".

**4. Ligar o Resenha ao seu bot**
No Resenha: Configurações → Desenvolvedor → no cartão do bot, em *Endereço do bot*, coloque
`https://bot-exemplo-xxxx.vercel.app/resenha` (termina em **/resenha**) → *Salvar*.

**5. Registrar os comandos**
Abra `https://bot-exemplo-xxxx.vercel.app/painel`, digite o `ADMIN_KEY` e clique em *Registrar comandos*. Deve aparecer "Pronto! 5 comandos registrados."

**6. Instalar o bot no servidor**
Configurações do servidor → **Integrações** → *Adicionar pelo ID do bot* → cole o ID → *Procurar* → *Adicionar ao servidor*.

**7. Testar**
No chat digite `/ping`, `/eco olá`, `/hora`, `/piada`, `/clima São Paulo`.
Para um aviso: no `/painel`, em *Mandar um aviso*, digite a senha, o nome do canal (ex.: `geral`) e a mensagem.

## Se algo não funcionar
- **O comando dá erro "o bot não respondeu"**: confira se o endereço no cartão do bot termina em `/resenha` e se `SIGNING_SECRET` na Vercel é o segredo certo (depois de mudar variáveis, faça *Redeploy*).
- **"respondeu algo que não é JSON"**: abra o endereço do bot numa janela anônima; se pedir login da Vercel, desligue a *Deployment Protection* em Settings do projeto.
- **O painel diz "O Resenha recusou"**: o token está errado, ou o bot não foi instalado no servidor (passo 6).
- Sem o recurso "bots" na sua conta você não consegue instalar o bot no servidor.

## Segurança
- Nunca coloque o token nem o segredo dentro do código: use sempre variáveis de ambiente.
- O bot confere a assinatura de cada chamada (`/resenha`): sem o segredo, ninguém consegue fazer o seu bot responder.
- Guia completo da API: `docs/BOTS-API.md` no repositório do Resenha.
