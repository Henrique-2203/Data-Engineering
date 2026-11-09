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

## Se algo der errado

Anote **o que fez**, **o que esperava** e **o que aconteceu** (um print ajuda muito) e me mande.
