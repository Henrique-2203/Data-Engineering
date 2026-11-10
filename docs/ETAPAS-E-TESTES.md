# Resenha: o que foi feito e como testar

Documento para conferir com calma tudo o que entrou nas Etapas 1 a 4 (e nos ajustes pedidos no caminho).
Cada item tem **onde fica** e **como testar**. Marque `[x]` conforme for testando.

> Dica: teste com duas contas (a sua e a de um amigo, ou uma segunda conta numa janela anônima).
> O que depende do app de Windows está marcado com 🖥️.

---

## Configurações que ficam no Render

| Variável | Para quê | Situação |
|---|---|---|
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Arquivos no Cloudflare R2 (10 GB grátis) | ✅ configurado |
| `BACKUP_KEY` | Chave dos backups (**guarde uma cópia fora do Render**) | ✅ configurado |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Captcha invisível | ✅ configurado |
| `EMAIL_PROVIDER=brevo`, `EMAIL_API_KEY`, `EMAIL_FROM` | E-mails de segurança | ✅ configurado (IP liberado na Brevo) |
| `PLATFORM_ADMINS` | Seu usuário: vê o Painel da equipe | ✅ |
| `REGISTRATION_CODE` | Código para criar conta. **Apague para abrir o cadastro para todos** | decidir |
| (nenhuma) | Notificações no celular: as chaves são criadas sozinhas e guardadas no banco | ✅ automático |

---

## Etapa 1: fundação (arquivos, privacidade, cotas, backups)

### Arquivos no Cloudflare R2
- [ ] Painel da equipe → **Sistema**: o quadro de arquivos diz "Cloudflare R2".
- [ ] No painel da Cloudflare (R2 → `resenha-arquivos`), aparecem as pastas `att/`, `img/` e `backups/`.

### Envio de arquivos (DM e canais)
- [ ] Clipe 📎 no campo de mensagem → enviar uma **foto**, um **vídeo curto**, um **áudio** e um **PDF**.
- [ ] Foto aparece na grade, vídeo com player (dá para avançar), áudio com player, PDF como cartão com botão de baixar.
- [ ] Barra de progresso aparece em arquivos grandes.
- [ ] Tentar enviar um `.exe` (ou `.bat`, `.apk`) → recusado com aviso de segurança.
- [ ] Arquivo `.zip` mostra o aviso "só abra se confiar em quem enviou".

### GPS removido das fotos
- [ ] Tirar uma foto com o celular (com localização ligada), enviar no Resenha, baixar a foto enviada e conferir
      nas propriedades do arquivo que **não há localização** nem modelo do celular.

### Links protegidos
- [ ] Copiar o link de uma imagem enviada (botão direito → copiar endereço) e abrir numa **janela anônima**
      depois de 24 h → não abre ("Este link expirou").
- [ ] Quem não está na conversa não consegue abrir.

### Cotas e "Meus arquivos"
- [ ] Configurações → **Privacidade e dados** → "Meus arquivos": mostra o espaço usado (de 500 MB) e a lista.
- [ ] Apagar um arquivo pela lista → ele some da conversa para todos.
- [ ] Configurações do servidor → Visão geral: mostra o espaço **do servidor** (de 2 GB), não mais o do banco inteiro.

### Backups
- [ ] Painel da equipe → Sistema → **Fazer backup agora** → aparece ✅ "conferido".
- [ ] No dia seguinte, confirmar que apareceu um backup automático novo.

---

## Etapa 2: conta segura

### Login protegido (cookie) e proteção contra outros sites
- [ ] Sair e entrar de novo funciona; continua logado ao fechar e abrir o navegador/app.
- [ ] Em Configurações → Segurança → aparelhos conectados, "Sair de todos os outros" derruba os outros na hora.

### Cadastro com e-mail confirmado (2 passos)
- [ ] Tela de entrada → **Criar conta**: e-mail, nome de usuário (mostra ✓ disponível / ✗ em uso enquanto digita), nome e senha.
- [ ] Chega um **código de 6 dígitos** no e-mail (confira o spam). Só com o código a conta é criada.
- [ ] "Reenviar código" só libera depois de 45 s; "Corrigir o e-mail" volta ao formulário.
- [ ] Tentar criar outra conta com o mesmo e-mail → recusado.
- [ ] Senha com o nome de usuário dentro, ou muito comum → recusada.

### Login com usuário **ou** e-mail
- [ ] Entrar digitando o e-mail no lugar do usuário.

### Captcha invisível
- [ ] Errar a senha 3 vezes → aparece a verificação anti-robô (geralmente sozinha, sem clicar em nada).

### Senhas vazadas
- [ ] Tentar usar uma senha famosa (ex.: `Senha123!`) no cadastro ou na troca → recusada por ter vazado.

### E-mail e alertas
- [ ] Configurações → Segurança → **E-mail**: adicionar/trocar com código.
- [ ] Entrar de um aparelho novo (ex.: celular) → chega e-mail "Novo acesso à sua conta".
- [ ] Trocar a senha → chega e-mail "Sua senha foi trocada".
- [ ] Ligar e desligar a verificação em duas etapas → chegam os e-mails de aviso.

### Esqueci minha senha (por e-mail)
- [ ] Tela de entrada → "Esqueci minha senha" → usuário ou e-mail → código no e-mail → senha nova → entra.
- [ ] Com a verificação em duas etapas ligada, pede **também** o código do app autenticador.
- [ ] Depois de trocar, os outros aparelhos são desconectados.

### Checkup, histórico e convite de e-mail
- [ ] Configurações → **Minha conta**: cartão com foto/nome/e-mail e o "Checkup de segurança: X de 5".
- [ ] Configurações → **Segurança** → "Ver histórico": logins, trocas de senha, 2FA, e-mail...
- [ ] Conta antiga sem e-mail: ao entrar, aparece o convite "Proteja sua conta com um e-mail" (no máximo 1x por dia).

### Painel da equipe → Sistema → E-mails
- [ ] Mostra se o último envio funcionou; "Enviar e-mail de teste" chega na caixa de entrada.

---

## Ajustes pedidos no caminho

### Configurações em tela cheia
- [ ] Menu à esquerda: Minha conta, Perfil, Segurança, Privacidade e dados, Voz e vídeo, Notificações e sons, Atalhos e app, Sair.
- [ ] No celular, as categorias viram abas no topo e o X não cobre nenhuma aba.

### Overlay no jogo 🖥️ (app 0.3.1+)
- [ ] Entrar numa call e abrir um jogo reconhecido (ex.: Valorant) → overlay aparece no canto: quem está na call,
      quem fala (contorno verde), mutado, AO VIVO.
- [ ] Alguém toca um som do soundboard → aparece "😂 Fulano tocou 'Som'".
- [ ] Com a janela do Resenha na frente, o overlay **some**.
- [ ] Ao transmitir a tela inteira, o overlay **não aparece** para quem assiste.
- [ ] **Ctrl+Shift+O** esconde/mostra.
- [ ] Configurações → Atalhos e app → Overlay no jogo: canto da tela, "só quem fala", transparência, "Quando mostrar".

### Tamanho das transmissões (só na sua tela)
- [ ] Assistindo uma transmissão (fica em destaque): arrastar a **divisória** muda o tamanho (setas do teclado também).
- [ ] Botão no pé da divisória: **pessoas ao lado** → a divisória passa a arrastar para os lados.
- [ ] Botão "Tirar do destaque" → na grade, **Aumentar/Diminuir** a transmissão.
- [ ] **Janela flutuante**: a transmissão vira uma janelinha por cima de tudo (até do jogo).
- [ ] O amigo que transmite não vê nenhuma dessas mudanças.

---

## Etapa 3: segurança visível

### Registro de auditoria
- [ ] Configurações do servidor → **Registro**: aparecem frases como "Fulano baniu Ciclano — motivo: …",
      "pôs … de castigo por 1 hora", "mudou os cargos de …", "apagou uma mensagem de …".
- [ ] Filtro "Mostrar" (membros, cargos, canais...).
- [ ] Um membro comum **não** vê a aba; dando a permissão "Ver o registro de auditoria" num cargo, ele passa a ver.

### Cadeado da chamada
- [ ] Na call, botão **🔒 Criptografada** → mostra para cada pessoa: conexão direta ou via retransmissão, DTLS e um
      **código de segurança** de 12 dígitos.
- [ ] Você e o amigo abrem a janela: o código ao lado do nome dele (na sua tela) é **igual** ao código ao lado do
      seu nome (na tela dele).

### Página pública de Segurança
- [ ] Abrir `/seguranca` (link no rodapé da página inicial, na tela de login e em Configurações → Segurança).
- [ ] Abrir `/.well-known/security.txt`: mostra o e-mail de contato e a validade.

### GitHub
- [ ] Aba **Actions**: "Verificações", "Análise de segurança (CodeQL)" e "App de desktop" com ✅.
- [ ] Aba **Security**: alertas do Dependabot e achados do CodeQL (por enquanto, nenhum).

### App de Windows 0.3.2 🖥️
- [ ] Configurações → Atalhos e app mostra a versão 0.3.2 (atualiza sozinho; "Reiniciar e atualizar").

---

## Pedidos da call

### Chat da call
- [ ] Entrar num canal de voz → botão 💬 no topo (à direita) abre o **Chat da call** ao lado da chamada.
- [ ] Mandar um link/print: quem está na call vê; com o painel fechado aparece o contador "N nova(s)".
- [ ] Sair da call e voltar depois: as mensagens continuam lá.
- [ ] No celular, o chat abre em tela cheia e o X fecha.

### Volume da transmissão que estou assistindo
- [ ] Assistindo a tela de alguém: passar o mouse na transmissão → controle de volume no canto (só muda para você).
- [ ] Baixar o volume da transmissão **não** muda o volume da voz da pessoa.
- [ ] Botão de alto-falante silencia/volta ao volume de antes.

### Ligar/desligar o som da minha transmissão
- [ ] Transmitir com "compartilhar áudio" marcado → no seu quadro aparece **Áudio da transmissão ligado**.
- [ ] Clicar → vira "desligado": a imagem continua, os amigos param de ouvir o som e veem "🔇 sem áudio".
- [ ] Clicar de novo → volta o som.

### Valorant (e outros jogos) na lista de janelas 🖥️ (app 0.3.3)
- [ ] Configurações → Atalhos e app mostra a versão **0.3.3**.
- [ ] Com o Valorant aberto em **tela cheia**, aba "Janela": aparece o aviso explicando que o Windows minimiza o jogo.
- [ ] No Valorant: Configurações → Vídeo → Modo de exibição → **Janela sem bordas**. Em até 4 s (ou no ↻ Atualizar) o
      Valorant aparece na lista e dá para transmitir só ele.

---

## Etapa 4: comunidade

### Busca de mensagens
- [ ] Campo **Buscar** no topo do canal (no celular, a lupa). Enter abre os resultados à direita.
- [ ] Busca sem acento acha com acento ("amanha" acha "Amanhã").
- [ ] Filtros: **De** (pessoa), **Em** (canal), **Tipo** (arquivo, imagem, link, fixadas, enquetes).
- [ ] Clicar num resultado leva até a mensagem (piscando), mesmo se ela for antiga.
- [ ] Canal privado: quem não vê o canal **não** acha as mensagens dele na busca.
- [ ] Em conversa direta, a busca procura só naquela conversa.

### Mensagens fixadas
- [ ] Passar o mouse numa mensagem → 📌 **Fixar** (só quem tem "Gerenciar mensagens"; na DM, os dois).
- [ ] A mensagem ganha a marca "fixada"; o botão 📌 no topo do canal lista as fixadas (clicar leva até ela).
- [ ] Desafixar pela própria mensagem ou pela lista. Limite: 50 por canal.
- [ ] Aparece no Registro: "fixou uma mensagem de …".

### Enquetes
- [ ] Botão de gráfico 📊 no campo de mensagem → pergunta, 2 a 10 opções, duração (1 h a 1 semana), "mais de uma opção".
- [ ] Votar: os resultados (barras e %) aparecem depois do seu voto; os outros veem na hora.
- [ ] Clicar de novo tira o voto; trocar de opção troca o voto.
- [ ] Passar o mouse numa opção mostra quem votou nela.
- [ ] Depois do prazo: "Encerrada", ninguém vota mais, a mais votada fica em destaque.

### Moderação automática
- [ ] Configurações do servidor → **Moderação automática** (só quem gerencia o servidor).
- [ ] Palavras proibidas: testar com a conta de um amigo, inclusive disfarçada (b0b4o, buuurro) e com * no fim
      (idiot* pega "idiotice"). Aparece "Mensagem bloqueada pela moderação automática…".
- [ ] Bloquear convites: link de convite de outro servidor (Resenha ou Discord) é bloqueado; o do próprio servidor passa.
- [ ] Bloquear links: qualquer link é bloqueado.
- [ ] Anti-spam: a mesma mensagem 3 vezes em 1 minuto, ou mais de 5 menções, é bloqueada.
- [ ] Editar uma mensagem também passa pelo filtro.
- [ ] Dono, administradores, quem gerencia mensagens e os **cargos isentos** não são filtrados.
- [ ] Registro → filtro "Moderação automática": cada bloqueio aparece (sem guardar o texto da mensagem).

### Modo lento
- [ ] Lápis ao lado do canal → **Modo lento** (5 s até 6 h).
- [ ] Quem não gerencia mensagens vê "🐢 Modo lento" no campo e espera a contagem para mandar de novo.
- [ ] Quem gerencia mensagens/canais não espera.

### Eventos agendados
- [ ] Botão **Eventos** no topo da lista de canais → **Marcar evento**: nome, data/hora, duração, canal de voz, descrição.
- [ ] Todo membro pode marcar (permissão nova "Criar eventos", ligada para todos; dá para tirar de um cargo).
- [ ] **Tenho interesse**: na hora do evento, quem marcou recebe o aviso "📅 Começou: …" (e no celular, se ligou as notificações).
- [ ] Durante o evento o botão fica verde "Agora: …" e o evento ganha **Entrar na call**.
- [ ] Só quem criou (ou quem gerencia o servidor) edita ou cancela. Fica no Registro.

### Notificações no celular
- [ ] No Android (Chrome): Configurações → Notificações e sons → **Notificações no celular** → permitir.
- [ ] No iPhone: Safari → Compartilhar → **Adicionar à Tela de Início**, abrir pelo ícone e ligar na mesma tela.
- [ ] "Enviar notificação de teste" chega no aparelho.
- [ ] Com o Resenha **fechado** (ou em segundo plano): mensagem direta e menção (@você ou @todos) chegam como notificação.
- [ ] Mensagem comum (sem menção) **não** notifica no celular.
- [ ] Tocar na notificação abre o Resenha direto na conversa/canal.
- [ ] Com o Resenha aberto e na tela em outro aparelho, o celular não toca (sem aviso repetido).
- [ ] Sair da conta no aparelho para de receber as notificações dessa conta nele.

---

## Pedidos dos amigos (jogatina)

### Transmissão mais leve (FPS do jogo) 🖥️ app 0.3.4
- [ ] Janela de transmitir: **🎮 Modo desempenho** já vem ligado (H.264 pela placa de vídeo, no máximo 1080p).
- [ ] Transmitir jogando e comparar o FPS com e sem transmissão (antes perdia quase metade).
- [ ] Se o PC sofrer (ou codificar pelo processador), aparece "Sua transmissão ficou em 720p · 30 FPS…" e quem
      assiste recebe a versão leve. Na janela de transmitir dá para "Voltar para 1080p".
- [ ] Configurações → Atalhos e app: **Dar prioridade ao jogo** marcado (com jogo aberto, o Resenha fica atrás dele no
      processador).
- [ ] A prévia da sua própria tela pausa quando você está no jogo (economiza a placa de vídeo).
- [ ] Overlay com "Mostrar só quem está falando": sem ninguém falando, ele some de verdade (mais leve para o jogo).
- [ ] Lembrete: cada amigo assistindo é uma codificação a mais no seu PC.

### Supressão de ruído (teclado)
- [ ] Configurações → Voz e vídeo → **Supressão de ruído: Forte (IA)** (já vem ligada). Durante a call aparece
      "Na chamada agora: Forte (IA)".
- [ ] Digitar no teclado perto do microfone: os amigos não ouvem e a bolinha verde de "falando" não acende.
- [ ] Falar normalmente: a voz não corta.
- [ ] Opções: Leve (IA, menos processador), Básica (do navegador), Desligada.

### Atualizações sem derrubar a call
- [ ] Numa call, quando o Resenha atualizar: aparece "O Resenha está se atualizando. A call continua…" e a voz não corta.
- [ ] Depois que a call acaba, aparece o pop-up **O Resenha foi atualizado** com o resumo; só fecha no **Entendi**;
      não aparece de novo (nem nos outros aparelhos da mesma conta).
- [ ] App de Windows: o aviso "Atualização pronta" só aparece fora do jogo e fora da call.
- [ ] Banner "Nova versão" durante a call: pede para atualizar só quando sair da call.

### Suporte
- [ ] Botão de **boia** no pé da coluna de servidores (à esquerda) → abrir um chamado (assunto, título, mensagem).
- [ ] Painel da equipe → aba **Suporte**: responder. A pessoa recebe aviso no app, no celular (se ligou) e no e-mail.
- [ ] A boia mostra o número de respostas novas; some ao ler.
- [ ] Página pública **/suporte** com dúvidas comuns e "Abrir um chamado no Resenha".

### Site separado do app
- [ ] `/` abre o site de apresentação mesmo logado (botão **Abrir o Resenha**); o app fica em **/app**.
- [ ] Links antigos (`/entrar`) e convites continuam funcionando; o app de Windows e o app instalado no celular abrem
      direto no app.

---

## Transmissão turbo e enquete (10/11)

### Transmissão turbo ⚡ (app 0.3.5)
- [ ] Janela de transmitir: **⚡ Transmissão turbo** já vem marcada.
- [ ] Quem assiste vê no canto da transmissão "⚡ Turbo · 1920×1080 · 60 FPS · … Mbps · H.264".
- [ ] Quem transmite vê no painel: Captura X FPS · Envio Y FPS · **ms por quadro** · "na tela de quem assiste: Z FPS".
- [ ] Jogando e transmitindo para 2–3 amigos: o FPS de quem assiste fica acima de 40 (antes caía para 15–25).
- [ ] Se o PC apertar, aparece "Sua transmissão foi para 720p (mantendo 60 FPS)…" (a resolução cai, o FPS não).
- [ ] Amigo com internet ruim: só ele perde quadros; os outros continuam lisos.
- [ ] Se "Captura" estiver abaixo de 40: deixe o jogo em "janela sem bordas" e use o app de Windows 0.3.5
      (ele dá prioridade de placa de vídeo para a captura enquanto você transmite).
- [ ] Desmarcar "Transmissão turbo" volta ao modo antigo (para comparar ou se algo der errado).

### Enquete: quem votou
- [ ] Depois de votar, cada opção mostra as fotos de quem votou nela.
- [ ] "Ver quem votou" abre a lista com o nome de cada pessoa por opção ("Você" no seu voto).
- [ ] Antes de votar aparece "vote para ver o resultado e quem votou" (o resultado não influencia o voto).

---

## Banner da call
- [ ] Configurações → Perfil → **Banner da call**: 13 temas prontos com prévia num quadro largo e num estreito.
- [ ] Escolher um tema: na call, o seu quadro (para você e para os amigos) ganha o fundo na hora.
- [ ] **Enviar meu banner** (PNG, JPG ou WebP; GIF não) e ajustar a **posição da imagem** no quadro.
- [ ] **Usar o banner do perfil** (aparece se você tiver banner no perfil).
- [ ] Com a câmera ligada, o quadro mostra a câmera (o banner some).
- [ ] Foto e nome continuam legíveis em todos os temas; o contorno verde de quem fala continua aparecendo.

---

## Relatar problema da call (diagnóstico)
- [ ] Numa call, botão **Relatar problema** (ao lado de "Criptografada"): mede por 5 segundos sem atrapalhar a call.
- [ ] Aparece **O que encontramos**, com dicas em português (ex.: "a captura da tela está em 25 FPS…", "perda de 8% na voz…").
- [ ] **Ver exatamente o que vai ser enviado**: tabelas com aparelho, placa de vídeo, conexão com cada pessoa (atraso,
      perda, TURN), a sua transmissão (captura, envio, ms por quadro) e o que você assiste. Sem áudio, vídeo, mensagens ou IP.
- [ ] Enviar: vira um chamado de Suporte. No Painel da equipe → Suporte, o chamado mostra o **Diagnóstico da call**.
- [ ] Teste de amanhã: quem transmitir o jogo relata uma vez com o jogo rodando; quem assiste relata outra. Com os dois,
      dá para ver se o gargalo é captura, codificação ou internet.

---

## Saúde das calls (Painel da equipe → Saúde)
- [ ] **Agora**: quantas pessoas online, em call, quantas calls e quantas transmitindo.
- [ ] **Conexões**: % que deram certo, tempo para conectar, % de minutos via TURN, atualizações que não derrubaram a call.
- [ ] **Voz**: atraso médio, perda média, % de minutos com voz ruim.
- [ ] **Transmissões**: % de minutos com 40+ FPS (o objetivo), FPS na tela de quem assiste, captura x envio, tempo por
      quadro, % em turbo e em versão leve. Barrinhas por dia (verde, amarelo, vermelho).
- [ ] **TURN**: MB usados no mês (compare com a cota no painel do Metered).
- [ ] **Erros do site**: os mais frequentes, já sem e-mails, números longos, ids e endereços.
- [ ] Configurações → **Privacidade e dados**: "Ajudar a melhorar as calls com números anônimos" liga e desliga o envio.
- [ ] Os números aparecem conforme o pessoal usa as calls (uma amostra por minuto de call).

---

## Música, YouTube e conversa "Só da call"
- [ ] Mande um link do YouTube (youtube.com, youtu.be, Shorts, com ?t=) e um do Spotify (música, álbum, playlist) no
      chat: aparece um card com título e miniatura. O player só carrega quando você toca no card.
- [ ] Nome e horário das mensagens alinhados com a foto de perfil.
- [ ] Na call, botão de **TV** (Assistir juntos): cole um link do YouTube → toca para todo mundo, sincronizado.
- [ ] Quem entra depois começa no mesmo ponto do vídeo. Pausar, tocar e arrastar a barra vale para todos.
- [ ] Volume do vídeo é só seu. **Fila**: adicione vídeos; quando um acaba, o próximo começa para todos.
- [ ] No card do YouTube no chat (estando numa call): **Assistir juntos na call**.
- [ ] Painel de mensagens da call (ícone de balão): aba **Só da call** (padrão) e aba **Canal**.
  - [ ] **Só da call**: só quem está na chamada vê; não fica salvo; quem entra depois vê o que foi conversado nesta call;
        quando todo mundo sai, apaga tudo. A moderação automática do servidor vale aqui também.
  - [ ] Dá para apagar as suas mensagens. Quando alguém coloca um vídeo no "Assistir juntos", aparece um aviso.
  - [ ] **Canal**: o chat salvo do canal de voz, como antes (busca e fixadas continuam funcionando).
- [ ] **Ouvindo agora** (app de Windows 0.3.6): com o Spotify do PC tocando, aparece "🎵 Ouvindo Música · Artista" no seu
      perfil e na lista de membros. Pausou: some. Trocou de música: troca (em até ~10 s).
  - [ ] Com um jogo aberto, aparece o jogo no lugar da música.
  - [ ] Configurações → Atalhos e app → "Mostrar no meu perfil a música que estou ouvindo no Spotify do PC" desliga.
  - [ ] Só o título da janela do Spotify é lido (nenhum outro programa); funciona com o app do Spotify, não com o Spotify no navegador.

---

## Se algo der errado

Anote **o que fez**, **o que esperava** e **o que aconteceu** (um print ajuda muito) e me mande.
