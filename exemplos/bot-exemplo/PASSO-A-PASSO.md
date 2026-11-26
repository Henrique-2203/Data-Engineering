# Testar bots de desenvolvedor no Resenha: passo a passo completo

Você faz o papel de **desenvolvedor** (cria o bot) e de **usuário** (usa o bot).
Tempo: 20 a 30 minutos. Arquivos deste pacote: `bot.js`, `package.json`, `vercel.json`, `servidor.js`, pasta `api/` (com `index.js`).

## Como funciona
O bot é um programinha hospedado FORA do Resenha (Vercel, grátis). Quando alguém digita `/ping`, o Resenha chama o endereço do bot com uma assinatura de segurança; o bot responde com texto e o Resenha mostra no chat. O bot também pode mandar mensagens sozinho usando o token dele.

## Antes de começar
1. Entre no site com a conta da equipe: Painel da equipe > Saúde > "Recursos em teste".
2. Na linha **Criar o próprio bot**: escreva `@seuusuario` e clique Salvar.
3. Na linha **Bots**: escreva `@seuusuario` e clique Salvar.
4. Clique em **Criar servidor de testes** (cria o "Laboratório Resenha").
5. Tenha contas no GitHub e na Vercel (entre na Vercel com o GitHub).

## Passo 1: criar o bot no Resenha
1. Configurações > **Desenvolvedor** > **Criar um bot**, nome "Bot Exemplo" (o nome não pode imitar a equipe: nada de "Resenha", "admin"...), digite sua senha.
2. Aparecem o **token**, o **segredo de assinatura** e o **ID do bot** (`bot_...`).
3. Copie os três para um bloco de notas AGORA (token e segredo não aparecem de novo).

## Passo 2: colocar o bot no GitHub
1. GitHub > New repository > nome `bot-exemplo`.
2. **Add file > Upload files** e ARRASTE a pasta `api` e os arquivos `bot.js`, `package.json`, `vercel.json`, `servidor.js` (arraste; o botão "choose your files" perde as pastas).
3. Clique em **Commit changes**.

## Passo 3: publicar na Vercel
1. vercel.com > **Add New > Project** > escolha o repositório `bot-exemplo`.
2. Em **Environment Variables**, crie:

| Nome | Valor |
|---|---|
| BOT_TOKEN | o token do passo 1 |
| SIGNING_SECRET | o segredo de assinatura do passo 1 |
| ADMIN_KEY | uma senha que você inventa |

3. Clique em **Deploy**. Você ganha `https://bot-exemplo-xxxx.vercel.app`. Abra: deve aparecer "Bot de exemplo do Resenha no ar".

## Passo 4: ligar o Resenha ao bot
Configurações > Desenvolvedor > cartão do bot > **Endereço do bot**: `https://bot-exemplo-xxxx.vercel.app/resenha` (termina em /resenha) > Salvar. Só aceita https público (endereços locais/internos são bloqueados de propósito).

## Passo 5: registrar os comandos
Abra `https://bot-exemplo-xxxx.vercel.app/painel`, digite o ADMIN_KEY, clique **Registrar comandos**. Deve aparecer "Pronto! 5 comandos registrados."

## Passo 6: instalar no servidor
Servidor de testes > Configurações do servidor > **Integrações** > "Adicionar pelo ID do bot" > cole o `bot_...` > Procurar > **Adicionar ao servidor** (só quem administra o servidor instala bots).

## Passo 7: testar como usuário
No chat digite: `/ping`, `/hora`, `/eco olá`, `/piada`, `/clima São Paulo`.
Aviso automático: no `/painel`, "Mandar um aviso": senha (ADMIN_KEY), canal (`geral`) e mensagem. Chega no canal enviada pelo bot, com o selo BOT.

## Checklist de conferência
- [ ] Selo BOT nas mensagens e na lista de membros
- [ ] Comandos aparecem ao digitar `/`
- [ ] Dá para desligar um comando em Integrações
- [ ] Remover o bot do servidor: ele some e os comandos param
- [ ] Desenvolvedor > "Gerar novo token": o token antigo morre na hora e pede senha
- [ ] Painel da equipe > Saúde > Chaves de emergência > "Os bots": desliga a API de bots para todos (teste ligar e desligar)
- [ ] O bot não consegue usar @todos nem ler canais privados

## Se algo der errado
| Sintoma | Causa provável |
|---|---|
| "o bot não respondeu" | Endereço não termina em /resenha, ou SIGNING_SECRET errado. Depois de mudar variáveis na Vercel, faça Redeploy. |
| "respondeu algo que não é JSON" | Abra o endereço numa janela anônima; se pedir login da Vercel, desligue a Deployment Protection (Settings do projeto). |
| Painel diz "O Resenha recusou" | Token errado, ou bot não instalado no servidor (passo 6). |
| Não aparece "Desenvolvedor" | Sua conta não está na lista "Criar o próprio bot". |
| Não consegue instalar | Sua conta não tem o recurso "Bots", ou você não administra o servidor. |
| Demora/corta resposta | O Resenha espera no máximo 3 s e aceita respostas de até 32 KB. |

## Limites e segurança
- Cada chamada vem assinada; o bot confere e recusa quem não tem o segredo.
- Token e segredo nunca no código: só em variáveis de ambiente.
- Limite: 120 chamadas/minuto por bot. O bot age só onde foi instalado, com permissões de membro comum.
- Para criar o seu: troque a lista COMANDOS em `bot.js`. Guia da API: `docs/BOTS-API.md` no repositório.
