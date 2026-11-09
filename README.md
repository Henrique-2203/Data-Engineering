# Resenha

Chat, chamadas de voz e **transmissão de tela em alta qualidade (até 4K/60 FPS)** para você e seus amigos.
Funciona no navegador do PC e do celular, e é 100% gratuito para hospedar.

## O que já funciona

- Contas com usuário e senha (com código de cadastro opcional para restringir aos amigos)
- Servidores com link de convite, canais de texto e de voz
- **Amigos**: adicionar pelo nome de usuário, aceitar/recusar pedidos, ver quem está online
- **Mensagens diretas** com amigos ou membros dos seus servidores (clique no membro → Enviar mensagem)
- **Ligações nas mensagens diretas** (📞 no topo da conversa): toque com Atender/Recusar, "chamando…",
  aviso de recusa, de chamada perdida e de amigo offline; voz, câmera e tela como nos canais de voz
- **Cargos e permissões**: cargos com cor (pintam o nome), 11 permissões (administrar, gerenciar
  canais/cargos/mensagens, expulsar, banir, castigar, @todos, convidar, transmitir) e hierarquia
- **Canais privados** por cargo, **categorias** e organização arrastando; ícone, banner e descrição
  do servidor; voz com **qualidade por canal até 510 kbps** e **limite de pessoas**
- **Moderação**: castigo temporário, expulsar, banir/desbanir
- **Perfil**: foto (aceita GIF animado), banner, bio, pronomes e até 6 links (Steam, Twitch, YouTube…);
  **status** com emoji e prazo (30 min, 1 h, 4 h, até meia-noite ou sem prazo); **"Jogando agora"**
  automático pelo app de desktop; cartão de perfil com servidores e amigos em comum (clique no nome)
- **Grátis o que o Discord cobra**: **emojis** (até GIF) e **figurinhas** personalizados, usáveis em
  qualquer conversa e servidor (`:nome` autocompleta); **soundboard** na chamada (sons de até 5 s,
  recortados e comprimidos no navegador); **apelido e foto por servidor**. Tudo com permissões
  próprias (gerenciar emojis e sons, usar soundboard, mudar/gerenciar apelidos)
- **Segurança e privacidade**:
  - senhas com hash scrypt e regra de senha forte;
  - sessões que expiram após 60 dias sem uso, com a lista de aparelhos conectados ("sair de todos os outros");
  - **verificação em duas etapas** (app autenticador) e **códigos de recuperação** (o "esqueci a senha" sem e-mail);
  - cabeçalhos de segurança (CSP, anti-clickjacking), limites contra força bruta e spam, e bloqueio de conexões vindas de outros sites;
  - **Baixar meus dados** e **Excluir minha conta** (LGPD);
  - páginas públicas de [Privacidade](/privacidade) e [Termos](/termos)
- **Denúncias**: botão 🚩 em mensagens, perfis e servidores, anônimo para o denunciado e com cópia da
  prova (mesmo se apagarem). A equipe (`PLATFORM_ADMINS`) tem uma fila com contador em tempo real e pode
  apagar a mensagem, suspender a conta no Resenha inteiro ou excluir o servidor
- **Página inicial** (`/`, para quem não está logado): vídeo do app, recursos com prints reais, aviso de
  beta, download do Windows (sempre a versão mais recente), uso no navegador e **lista de espera** com
  consentimento (a equipe vê no painel e exporta para planilha). O login fica em `/entrar`
- **Aviso de nova versão**: quando sai uma versão nova do site, aparece "Atualizar" em quem está com ele aberto
- Chat em tempo real: editar/excluir mensagens, "fulano está digitando…", links e prévia de imagens, mensagens não lidas
- **Responder** mensagens (com citação clicável), **reações** com emoji e **@menções** com
  autocompletar, destaque, som próprio e contador; `@todos` avisa o servidor inteiro
- **Imagens**: botão, colar (Ctrl+V) ou arrastar; fotos grandes são reduzidas no navegador
  (máx. 2560 px) antes de enviar, para caber no plano grátis do banco
- Quem está online, quem está em cada canal de voz, quem está falando
- Voz com supressão de ruído, silenciar/ensurdecer, volume individual por pessoa
- **Ativação por voz com sensibilidade** (portão de ruído com medidor) ou **push-to-talk** com tecla
  ou botão lateral do mouse configurável
- Atalhos: `Ctrl+Shift+M` silencia, `Ctrl+Shift+D` desativa o áudio (com a janela do Resenha em foco)
- Sons de entrar/sair da chamada, silenciar, mensagem nova e transmissão iniciada; notificações do
  navegador para mensagens novas
- Câmera
- **Transmissão de tela**:
  - 720p até 4K, 30 ou 60 FPS, bitrate ajustável até 40 Mbps
  - Codec H.264 (usa a placa de vídeo), VP9, AV1 ou VP8
  - Modo "jogo" (prioriza FPS) ou "texto" (prioriza nitidez)
  - Áudio do sistema ou da aba em estéreo
  - "Assistir transmissão" igual ao Discord: só quem clica recebe o vídeo, o que economiza a sua internet
  - Mostra a resolução, o FPS e o bitrate recebidos em tempo real
- Layout para celular, que pode ser instalado na tela inicial (PWA)

> **Transmissão travando em ~30 FPS?** Quem transmite vê no canto da própria tela a captura, o envio,
> o codec, se a codificação está na placa de vídeo e o que está limitando. Dicas que costumam resolver:
> use **Chrome ou Edge** dos dois lados (Opera/Opera GX e Brave podem vir sem H.264 e caem no VP8, que
> pesa no processador), codec **H.264**, e o jogo em **janela sem bordas** em vez de tela cheia exclusiva.

> **Celular:** dá para conversar, falar, ligar a câmera e **assistir** transmissões.
> **Transmitir** a tela só funciona no navegador do computador (Chrome, Edge ou Firefox), porque os
> navegadores de celular não permitem capturar a tela.

## Como funciona

```
Navegador ──REST + WebSocket──▶ Servidor Node (Express + Socket.IO) ──▶ Postgres
    │
    └──── WebRTC P2P (voz, câmera, tela) ────▶ Navegador dos amigos
```

Áudio e vídeo vão **direto de um navegador para o outro** (malha P2P). Por isso não existe servidor de
mídia para pagar e a latência fica a menor possível. O servidor só faz login, chat e a "apresentação"
entre os navegadores (sinalização).

A troca é que quem transmite envia uma cópia para cada pessoa assistindo. A 1080p60 com 8 Mbps e
3 amigos assistindo, você precisa de uns 24 Mbps de upload. Para um grupo de amigos isso funciona bem.

## Colocar no ar de graça (para testar no celular)

### 1. Banco de dados gratuito (Neon)

1. Crie uma conta em <https://neon.tech> (plano Free) e crie um projeto na região **AWS US East 1 (N. Virginia)**, a mesma do Render (que não tem servidor no Brasil).
2. Copie a **connection string**. Ela parece com `postgresql://usuario:senha@ep-xxx.neon.tech/neondb?sslmode=require`.

### 2. Hospedagem gratuita (Render)

1. Crie uma conta em <https://render.com> entrando com o GitHub.
2. Clique em **New → Blueprint** e escolha este repositório e a branch.
3. O Render lê o `render.yaml` e pede as variáveis:
   - `DATABASE_URL`: a connection string do Neon
   - `REGISTRATION_CODE`: uma senha que você passa só para os amigos (ex.: `galera2026`)
   - `PRIVACY_CONTACT`: e-mail de contato de privacidade (LGPD), mostrado em `/privacidade` (padrão: resenha.brasilgames@gmail.com)
   - `PLATFORM_ADMINS`: seu nome de usuário no Resenha (vários separados por vírgula). Quem estiver aqui recebe as denúncias
   - `METERED_TURN_*` / `CLOUDFLARE_TURN_*`: TURN, veja o passo 3
4. Espere o deploy terminar e abra o link `https://resenha-xxxx.onrender.com` no PC e no celular.

> No plano gratuito do Render o servidor "dorme" após 15 minutos sem uso. O primeiro acesso depois
> disso demora uns 50 segundos para acordar. Depois fica normal. Para evitar, crie um monitor grátis
> no [UptimeRobot](https://uptimerobot.com) (HTTP(s), endereço `https://resenha-xxxx.onrender.com/api/health`,
> a cada 5 minutos).

### 3. TURN gratuito (Metered, sem cartão)

Operadoras móveis e alguns provedores de internet (CGNAT) bloqueiam a conexão direta P2P. Nesses casos
a chamada fica em "Conectando…". Um servidor TURN retransmite o áudio e o vídeo e resolve isso.

1. Crie uma conta grátis em <https://www.metered.ca/stun-turn> (só e-mail, sem cartão).
2. Ao criar, escolha um nome para o app (ex.: `resenha`). O domínio fica `resenha.metered.live`.
3. No painel, abra **TURN Server** e copie a **API Key**.
4. No Render, em **Environment**, preencha:
   - `METERED_TURN_DOMAIN`: o domínio do app (ex.: `resenha.metered.live`)
   - `METERED_TURN_API_KEY`: a API Key
5. **Save, rebuild and deploy**.

O TURN só é usado quando a conexão direta não funciona. Quando uma conexão passa por ele, o app
mostra "via TURN" e, para economizar a cota, envia só para essa pessoa a tela em 720p · 30 FPS · 1 Mbps
(≈450 MB/h) e a câmera em 15 FPS · 250 kbps. Quem tem conexão direta continua em qualidade máxima.
Dá para desligar em "Transmitir tela → Economizar a cota do TURN".

Para diagnosticar, rode no console do navegador `localStorage['resenha.forceTurn'] = '1'` e recarregue:
todas as conexões passarão pelo TURN (apague a chave para voltar ao normal).

Também é possível usar a Cloudflare (`CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN`, pede cartão)
ou qualquer TURN com usuário e senha fixos (`TURN_URLS`, `TURN_USERNAME` e `TURN_CREDENTIAL`).

### 4. Arquivos no Cloudflare R2 (10 GB grátis)

Sem isto, fotos e arquivos ficam no próprio banco (que tem só 0,5 GB no Neon grátis). Com o R2, o banco
guarda só texto e os arquivos vão para lá: 10 GB grátis por mês e **sem custo de download**. Acima de 10 GB,
o R2 cobra US$ 0,015 por GB, mas o Resenha trava os envios em 9,5 GB (`STORAGE_LIMIT_GB`), então não há cobrança surpresa.

1. Crie uma conta em <https://dash.cloudflare.com> e abra **R2 Object Storage** (pede um cartão para ativar, mas não cobra dentro do grátis).
2. **Create bucket** → nome `resenha-arquivos` → localização automática. Deixe o bucket **privado** (não ative acesso público).
3. Na página do R2, copie o **Account ID** (lado direito).
4. **Manage R2 API Tokens → Create API token** → permissão **Object Read & Write**, só para o bucket `resenha-arquivos`. Copie o **Access Key ID** e o **Secret Access Key** (o segredo aparece uma vez só).
5. No Render, em **Environment**, preencha `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` e salve.

Os arquivos que já estavam no banco são levados para o R2 sozinhos, aos poucos. O andamento aparece no
**Painel da equipe → Sistema**.

### 5. Backups automáticos criptografados

1. Invente uma frase longa (ex.: 6 palavras aleatórias) e **guarde num lugar seguro fora do Render** (gerenciador de senhas, papel guardado).
2. No Render, crie a variável `BACKUP_KEY` com essa frase.

Todo dia o servidor faz um backup do banco inteiro, criptografa com AES-256-GCM, guarda no R2 (pasta `backups/`),
baixa de volta e confere se abre. Os últimos 30 dias ficam guardados (`BACKUP_KEEP_DAYS`). O painel
**Sistema** mostra o último backup e tem o botão **Fazer backup agora**.

Para restaurar (num banco **novo**, nunca por cima do que está no ar): baixe o arquivo `.rsnbk` pelo painel
da Cloudflare e rode

```bash
BACKUP_KEY='sua frase' DATABASE_URL='postgres://...banco-novo...' npx tsx server/scripts/restore-backup.ts arquivo.rsnbk
```

(`--check` só confere se o backup abre, sem restaurar nada.)

### 6. Captcha invisível (Cloudflare Turnstile, grátis)

Barra robôs no cadastro, no "esqueci a senha" e no login depois de 3 senhas erradas, sem "clique nos semáforos".

1. No painel da Cloudflare: **Application security → Turnstile → Add widget**.
2. Nome `resenha`, em **Hostnames** adicione o endereço do site (ex.: `resenha-m2bt.onrender.com`), modo **Managed**.
3. Copie a **Site Key** e a **Secret Key** para `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` no Render.

### 7. E-mails de segurança (Brevo, 300 por dia grátis)

Confirmação de e-mail, código para criar uma senha nova e alertas (aparelho novo, senha trocada, 2FA desligado...).

1. Crie uma conta em <https://www.brevo.com> (plano Free).
2. **Senders, domains & IPs → Senders → Add a sender** com o e-mail do Resenha (ex.: `resenha.brasilgames@gmail.com`) e confirme pelo e-mail que a Brevo manda.
3. **SMTP & API → API keys → Generate a new API key**.
4. No Render: `EMAIL_PROVIDER=brevo`, `EMAIL_API_KEY=` a chave e `EMAIL_FROM=` o remetente confirmado.

> Com um remetente @gmail.com, alguns e-mails podem cair no spam. Com domínio próprio (ex.: `resenhabrasil.app.br`),
> dá para autenticar o domínio na Brevo (ou usar `EMAIL_PROVIDER=resend`) e a entrega fica bem melhor.

Sem e-mail configurado, tudo continua funcionando e a recuperação é feita com os códigos de recuperação.

### Conta segura

- Login guardado em cookie protegido (HttpOnly, Secure, SameSite=Lax): scripts da página não conseguem lê-lo.
  Quem estava logado na versão antiga é migrado sozinho. Pedidos vindos de outros sites são recusados (CSRF).
- Senhas que aparecem em vazamentos (Have I Been Pwned, por k-anonimato) são recusadas, e o login avisa se a senha atual vazou.
- Configurações → Segurança: **checkup**, **e-mail**, **histórico de segurança** (180 dias) e aparelhos conectados.

### Arquivos e cotas

- Fotos, vídeos, áudios e arquivos (PDF, zip...) em DMs e canais. Até 25 MB por arquivo com o R2 (8 MB sem ele) — `MAX_FILE_MB`.
- Fotos e vídeos perdem o GPS e outros metadados **no servidor**; programas e scripts (.exe, .bat, .apk...) são recusados pelo conteúdo, mesmo renomeados.
- Cada arquivo abre só por link assinado que expira (12 a 24 h), entregue a quem está na conversa.
- Cotas: 500 MB por pessoa (`USER_QUOTA_MB`), 2 GB por servidor (`GUILD_QUOTA_MB`), 300 MB por dia (`USER_DAILY_MB`). Cada pessoa vê o seu espaço em **Configurações → Meus arquivos**.

## App de desktop (Windows)

O app (`desktop/`, Electron) abre o mesmo Resenha do servidor, então **novidades do site chegam no
app na hora, sem reinstalar**. Ele acrescenta o que o navegador não consegue:

- **Push-to-talk e atalhos globais** (`Ctrl+Shift+M`, `Ctrl+Shift+D`) que funcionam com o jogo em
  primeiro plano. Por privacidade, o app só observa a tecla do push-to-talk e esses atalhos.
- **Transmissão sem freios**: sem a redução de ritmo de janelas em segundo plano e usando a placa de
  vídeo dedicada em notebooks com duas placas.
- **Seletor de tela ou janela** com áudio do computador.
- **Ícone na bandeja**: fechar a janela não derruba a chamada; dá para silenciar pelo menu e abrir com o Windows.
- **"Jogando agora"**: reconhece jogos abertos pela lista de processos e mostra no seu perfil (só o
  nome do jogo sai do computador; dá para desligar nas Configurações). Jogos extras:
  `RESENHA_EXTRA_GAMES="processo=Nome;outro=Outro Nome"`.
- **Atualização automática** da própria casca: baixa sozinha e avisa "Reiniciar e atualizar".

**Como sai uma versão:** o GitHub Actions (`.github/workflows/desktop.yml`) gera o instalador num
Windows a cada mudança em `desktop/`; ele fica na página da execução (Actions → artifact
"Resenha-Windows"). A versão (`version` em `desktop/package.json`) é publicada em
[Releases](https://github.com/Henrique-2203/Data-Engineering/releases/latest), de onde todos baixam e
de onde os apps instalados se atualizam sozinhos. Para lançar uma atualização do app, aumente o
`version`; versões já publicadas não são sobrescritas.

Sem certificado de assinatura, o Windows mostra "O Windows protegeu seu computador" na primeira
instalação: clique em **Mais informações → Executar assim mesmo**.

Para rodar em desenvolvimento: `cd desktop && npm install && npm run dev` (abre `localhost:5173`;
rode `npm run dev` na raiz antes). Opções: `--url=<endereço>` e `--profile=<pasta>`.

## Rodar no seu computador

Requer Node.js 20+.

```bash
npm install
npm run dev
```

Abra <http://localhost:5173>. Sem `DATABASE_URL`, o app usa um Postgres embutido (PGlite) salvo em
`./data`, então não precisa instalar nada.

> Microfone, câmera e tela só funcionam em `localhost` ou em HTTPS. Para testar no celular, use o deploy acima.

Outros comandos:

| Comando | O que faz |
| --- | --- |
| `npm run build` | Compila o frontend (`client/dist`) |
| `npm start` | Sobe o servidor de produção (serve API e frontend na porta `PORT`) |
| `npm run typecheck` | Checa os tipos do servidor e do cliente |
| `npm run test:e2e` | Teste ponta a ponta com dois navegadores (PC + celular): convite, chat, voz, câmera e tela |
| `npm run test:e2e:permissions` | API de cargos, permissões, canais privados, castigo, banimento e limite de voz |
| `npm run test:e2e:server-settings` | Telas de configurações do servidor: ícone, banner, cargos, canal privado, categorias, castigo |
| `npm run test:e2e:desktop` | App de desktop: push-to-talk e atalhos globais, seletor de tela, bandeja (precisa de `cd desktop && npm install`) |
| `npm run test:e2e:call` | Ligação na DM: atender (no celular), recusar, desistir, não atender e offline |
| `npm run test:e2e:chat` | Responder, @menções, reações, envio de imagens e visualizador |
| `npm run test:e2e:social` | Amigos e mensagens diretas com três pessoas (uma no celular) |
| `npm run test:e2e:codec` | O codec escolhido é o usado mesmo quando o espectador iniciou a negociação; estatísticas de envio |
| `npm run test:e2e:voice` | Push-to-talk, ativação por voz, atalho de silenciar e gravação de tecla |
| `npm run test:e2e:turn` | Força a conexão pelo TURN (precisa do `coturn` instalado) e confere a economia de cota |

Veja todas as variáveis de ambiente (inclusive `MAX_STORAGE_MB`, o limite do banco antes de recusar arquivos) (inclusive `RING_TIMEOUT_MS`, o tempo que a ligação toca) em [`.env.example`](.env.example).

## Estrutura

```
server/src/
  index.ts      servidor HTTP, arquivos estáticos
  routes.ts     API REST (contas, servidores, canais, mensagens, convites)
  realtime.ts   Socket.IO: presença, digitação, estado de voz, sinalização WebRTC
  db.ts         Postgres (pg) ou PGlite embutido + schema
client/src/
  voice/        motor WebRTC: negociação, codecs, bitrate, indicador de fala
  components/   interface (React)
  store/        estado (zustand)
shared/types.ts tipos usados pelos dois lados
e2e/smoke.mjs   teste ponta a ponta com Playwright
```

## Próximos passos

- Servidor de mídia (SFU, ex.: LiveKit) opcional para grupos grandes
- App de desktop (Tauri) para capturar o áudio de um jogo específico
