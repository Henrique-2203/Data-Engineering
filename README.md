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
   - `METERED_TURN_*` / `CLOUDFLARE_TURN_*`: TURN, veja o passo 3
4. Espere o deploy terminar e abra o link `https://resenha-xxxx.onrender.com` no PC e no celular.

> No plano gratuito do Render o servidor "dorme" após 15 minutos sem uso. O primeiro acesso depois
> disso demora uns 50 segundos para acordar. Depois fica normal.

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

## App de desktop (Windows)

O app (`desktop/`, Electron) abre o mesmo Resenha do servidor, então **novidades do site chegam no
app na hora, sem reinstalar**. Ele acrescenta o que o navegador não consegue:

- **Push-to-talk e atalhos globais** (`Ctrl+Shift+M`, `Ctrl+Shift+D`) que funcionam com o jogo em
  primeiro plano. Por privacidade, o app só observa a tecla do push-to-talk e esses atalhos.
- **Transmissão sem freios**: sem a redução de ritmo de janelas em segundo plano e usando a placa de
  vídeo dedicada em notebooks com duas placas.
- **Seletor de tela ou janela** com áudio do computador.
- **Ícone na bandeja**: fechar a janela não derruba a chamada; dá para silenciar pelo menu e abrir com o Windows.
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
| `npm run test:e2e:desktop` | App de desktop: push-to-talk e atalhos globais, seletor de tela, bandeja (precisa de `cd desktop && npm install`) |
| `npm run test:e2e:call` | Ligação na DM: atender (no celular), recusar, desistir, não atender e offline |
| `npm run test:e2e:chat` | Responder, @menções, reações, envio de imagens e visualizador |
| `npm run test:e2e:social` | Amigos e mensagens diretas com três pessoas (uma no celular) |
| `npm run test:e2e:codec` | O codec escolhido é o usado mesmo quando o espectador iniciou a negociação; estatísticas de envio |
| `npm run test:e2e:voice` | Push-to-talk, ativação por voz, atalho de silenciar e gravação de tecla |
| `npm run test:e2e:turn` | Força a conexão pelo TURN (precisa do `coturn` instalado) e confere a economia de cota |

Veja todas as variáveis de ambiente (inclusive `RING_TIMEOUT_MS`, o tempo que a ligação toca) em [`.env.example`](.env.example).

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

- Mensagens diretas (DM) e lista de amigos
- Envio de arquivos e imagens pelo próprio app
- Reações, respostas e menções com notificação
- Cargos e permissões
- Servidor de mídia (SFU, ex.: LiveKit) opcional para grupos grandes
- App de desktop (Tauri) para capturar o áudio de um jogo específico
