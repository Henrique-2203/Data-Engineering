# Resenha: o que foi feito e como testar

Documento para conferir com calma tudo o que entrou nas Etapas 1, 2 e 3 (e nos ajustes pedidos no caminho).
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

## Se algo der errado

Anote **o que fez**, **o que esperava** e **o que aconteceu** (um print ajuda muito) e me mande.
