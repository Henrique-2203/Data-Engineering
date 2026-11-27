# Problemas conhecidos, hipóteses e pendências

Formato: **sintoma → o que se sabe → o que foi tentado → o que falta**. Atualize ao resolver ou descobrir algo novo.

## Aguardando confirmação em uso real
1. **Voz dos amigos baixa com a supressão de ruído desligada** (relatado por usuários, mesmo com volume no máximo).
   - Sabe-se: a voz remota toca num `<audio>` comum (sem processamento), e a supressão só altera o **microfone de quem fala/ouve**; não achamos no código nada que reduza o volume recebido.
   - Hipótese (não confirmada): o Windows abaixa outros sons durante chamadas (Som → Comunicações → "Não fazer nada"), ou o microfone de quem fala é baixo.
   - Feito: volume por pessoa até **200%** (amplificador com limitador) + dica na opção "Desligada". Testado só a lógica.
   - Falta: reproduzir; pedir "Relatar problema" (`voice/diagnostics.ts`) a quem reclamar, com sistema/navegador/microfone.
2. **Câmera do celular travando ao virar mais de uma vez.** Causa provável: abrir a 2ª câmera com a 1ª ainda aberta. Correção (libera a atual antes, tenta `exact`/`ideal`/livre, volta para a anterior se falhar, bloqueia toques repetidos) testada **só com câmera falsa**. Falta confirmar em celulares reais.
3. **App Android preso numa página com letras pretas** quando o site estava fora do ar/atualizando (WebView sem tratamento de erro; fundo escuro do app + página de erro do sistema). Correção: tela própria "sem conexão" com nova tentativa a cada 4 s (`MainActivity.java`). Compila (Java inteiro compilado contra o framework Android 15), **não testada em aparelho e não lançada** (APK 1.0.3 pendente). Causa raiz exata no aparelho do relato não foi vista.
4. **`confirm()`/`alert()` no Android:** substituídos por `askConfirm`/`askNotice` (testado em navegador). `onJsConfirm`/`onJsAlert` nativos adicionados como rede de segurança e **não testados em aparelho**.
5. **Usuário sem conseguir mandar link** num servidor: era a moderação automática ("bloquear links"). Liberação é por **cargo isento** ou, agora, por **sites liberados**. Se um admin disser que configurou e continua bloqueado, pedir nome do cargo e tela de Moderação automática (o mecanismo foi reproduzido e funciona).

## Limitações conhecidas (aceitas ou a tratar)
- **Render grátis dorme** e durante deploy/cold start responde 502 por até ~1 min: o site cai e a página de erro aparece (no Android já tem tela própria; no navegador não). Mitigação futura: plano pago ou ping de manutenção (custo/termos a avaliar).
- **Deploy a cada push** na branch de trabalho: não há site de teste separado (adiado por causa das 750 h).
- **Neon:** o app roda DDL no boot; não dá para usar role sem permissão de alterar o esquema sem antes separar migração.
- **Rate limit em memória** (uma instância). Se escalar para mais de uma, mover para Redis.
- **Mudo forçado por moderador** não é imposto no P2P (cliente adulterado pode ignorar); mover/desconectar funcionam.
- **Bloqueio:** mensagens do bloqueado em servidores comuns ficam recolhidas só no app; presença é escondida; o servidor não filtra a entrega.
- **Convite de servidor** é permanente (sem validade/limite) — roadmap P1.
- **Histórico do git** contém um nome de usuário real antigo (não é segredo). Reescrever é decisão do dono.
- **Mídia no mesmo domínio do app** (UPL-09 parcial); sem antivírus/CSAM (UPL-13/15).
- **DJ:** player do YouTube escondido (opacity 0) foge da recomendação do YouTube; risco de o YouTube limitar o embed. Plano B: voltar a mostrar o vídeo. Se ninguém ouve, o servidor avança a fila pela duração (precisa de `YOUTUBE_API_KEY`).
- **Formato do `user.id` enviado a bots mudou** (agora derivado por bot): bots antigos que guardavam o id interno precisam se adaptar.

## Testes: instabilidades conhecidas
- `smoke.mjs` e outros com vídeo falham sob **CPU ocupada** (rodar em paralelo). Rodar sequencial resolve.
- `security.mjs` já falhou uma vez em "mesmo código 2FA funcionou duas vezes" na virada da janela de 30 s do TOTP; passa na repetição.
- Limites reais atrapalham testes: recuperação de senha 6/15 min por conta; criar bot com limite por hora; mensagens 5 por 5 s por canal (use `sleep`).
- Testes de tela exigem `npm run build` antes (usam `client/dist`).
- `confirm()` nativo não existe mais: testes usam `autoConfirm` (`e2e/_ui.mjs`); `page.on('dialog')` só para detectar uso indevido.

## Tentativas anteriores que não funcionaram / foram descartadas
- Trocar a role do app no Neon por uma sem DDL → quebraria o boot (descartado; ver `docs/DECISIONS.md`).
- `confirm()` nativo para ações destrutivas → silencioso em Android/Electron/automação (substituído).
- Status 502 para falhas de bot → hospedagem troca por "Erro 502" genérico (usa 424).
- Prazo só de inatividade no cliente HTTP dos bots → bot que goteja 1 byte/s prendia a conexão (corrigido com prazo total de 3 s).
- Filtro de nome descartando letra desconhecida → deixava passar "Resenħa"/"Resenhα" (agora vira `?` e há mais homóglifos).
- Baixar SDK do Android no ambiente de desenvolvimento: `dl.google.com` é bloqueado aqui; só dá para compilar o Java contra o `android-all` do Maven Central (feito, sem R/BuildConfig reais).

## Pendências abertas
Ver `docs/ROADMAP.md` (P0 e P1) e `docs/HANDOFF.md` ("Aguardando o dono").

## Turbo / captura (fase 1)
- **FPS baixo na captura (≈41 FPS no menu do CS2, ≈37 em tela inteira)**: causa **não identificada**. A fase 1 só melhorou a medição (origem da captura, janela de amostras, onde o FPS ficou para trás). Hipóteses abertas: modo de exibição do jogo, captura de janela x monitor, prioridade de GPU, tela parada gerando poucos quadros. Validar com `docs/VALIDACAO-TURBO.md`.
- `encoderLatencyMs` (antes "tempo por quadro") mede entrada→saída do codificador, **não** o tempo de processamento; não indica software por si só.
- Testes do Turbo usam tela sintética (canvas): provam encanamento, não FPS de jogo.
- Relatórios de diagnóstico antigos trazem 0 no lugar de "não medido"; `explain()` trata os dois formatos.
