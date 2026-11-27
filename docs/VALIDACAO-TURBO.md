# Validação do Turbo em dois computadores Windows

Objetivo: obter **evidência em hardware real** sobre a estabilidade do Turbo e a origem do limite de FPS. Os testes automáticos usam uma tela sintética (canvas) e **não provam 60 FPS em jogo real**.

Antes de começar: os dois PCs com o app de Windows atualizado, na mesma versão do site (esta branch precisa estar publicada em um ambiente de teste; **nada foi enviado à produção**). Configurações → Voz e vídeo: "Transmissão turbo" ligada nos dois lados, predefinição **1080p · 60 FPS**, "Modo desempenho" ligado em um teste e desligado no outro.

## Roteiro (cada passo: anote o resultado)
1. **Transmissor** entra na call, abre o jogo em **janela sem bordas** e transmite a **janela do jogo**. **Receptor** entra e clica em "Assistir transmissão". Confira o chip **⚡ Turbo** nos dois lados.
2. Menu do jogo (30 s) → partida de treino (60 s) → de novo no menu. Em cada fase, no **receptor**, leia a linha de estatísticas e anote FPS, Mbps e codec. No **transmissor**, anote "Captura / Envio / latência do codificador / limite".
3. **Troque para tela inteira** (monitor) sem encerrar: "Transmitir tela → Escolher tela". O receptor deve continuar no Turbo sem clicar em nada. Repita voltando para a janela.
4. **Pare e reinicie** a transmissão (com mais de 5 s de pausa). O receptor deve voltar ao Turbo sozinho; o chip "⚡ Turbo" deve reaparecer.
5. Com o jogo em partida, ligue o **"Relatar problema da call"** nos DOIS PCs ao mesmo tempo (aba "Texto completo") e guarde o JSON. Campos para comparar:
   - transmissor: `stream.source` (monitor/janela), `stream.window.captureFps` (média/mín/máx/zeros), `encodeFps`, `encoderLatencyMs`, `encoderBusyPerSec`, `viewerShownFps`, `stream.limit` (onde o FPS ficou para trás e por quê), `stream.transport[].state/reason`.
   - receptor: `watching[].presentedFps`, `decodedFps`, `receivedFps`, `frameIntervalMs`, `freezes`/`freezeMs`, `transport`.
   - `transportEvents`: linha do tempo (habilitado → negociando → ativo/fallback, com o motivo).
6. **Desligue o Turbo** em um dos lados e repita o passo 2 para comparar com o WebRTC normal.

## Como interpretar
- `limit.where = capture` e captura abaixo do alvo → o gargalo é capturar a imagem (modo de exibição do jogo, captura de janela x monitor, GPU ocupada). Mais bitrate **não** ajuda.
- `encoder` → codificador não acompanha a captura. "processador" só aparece quando foi preciso pedir software.
- `transport` → fila de envio de alguém encheu (internet dela ou upload de quem transmite).
- `receiver` → enviado ≠ apresentado no receptor sem fila cheia: recepção, decodificação ou exibição do PC de quem assiste.
- `unknown` → faltou medida; **não** é falha comprovada.
- Latência do codificador alta **sozinha** não prova software.

## O que NÃO está provado até esta validação
- Que o limite de captura (≈41 FPS no menu, ≈37 na tela inteira) tenha causa identificada: o que se corrigiu foi a **capacidade de medir e de recuperar**, não uma otimização de captura.
- Que 60 FPS estáveis sejam atingidos em 1080p no jogo real.
