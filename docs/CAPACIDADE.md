# Quanto o Resenha aguenta e quando vale pagar

Medido em 10/11/2026 com os testes `e2e/capacity/server-load.mjs` (servidor, com Postgres de verdade) e
`e2e/capacity/call-size.mjs` (calls de 2 a 8 pessoas). Rode de novo depois de mudanças grandes.

## 1. Servidor (chat, presença, entrar em call)

Pessoas conectadas ao mesmo tempo, em grupos de 10 amigos, 20% delas em call:

| Pessoas | Memória | Uso normal (1 mensagem/min por pessoa) | Muito agitado (1 mensagem a cada 10 s) |
|---|---|---|---|
| 100 | 185 MB | 2% de 1 núcleo · mensagem chega em 10 ms | 6% · 10 ms |
| 300 | 246 MB | 3% · 10 ms | 12% · 9 ms (as mais lentas: 0,7 s) |
| 600 | 250 MB | 6% · 9 ms | 22% · 8 ms |

O plano grátis do Render dá **512 MB** e **0,1 núcleo (10%)**:

- **Memória** sobra até 600 pessoas.
- **Processador** é o limite: no uso normal o grátis aguenta **~600 pessoas conectadas juntas**; num pico muito agitado,
  **~150 a 250**. Acima disso o Render segura o processador e as mensagens começam a atrasar (a voz e a transmissão não,
  porque vão direto entre os aparelhos).
- O plano pago mais barato do Render (Starter, ~US$ 7/mês) dá 0,5 núcleo: uns **5 vezes mais** (o pico agitado de 600 pessoas cabe).

## 2. Banco de dados (Neon grátis: 0,5 GB)

- Cada mensagem ocupa **~560 bytes** com os índices (fotos e arquivos ficam no R2, fora do banco).
- 0,5 GB ≈ **800 mil mensagens** (menos o espaço de contas, servidores etc.).
- Exemplo: 100 pessoas mandando 50 mensagens por dia = 5 mil/dia → **~5 meses** de folga.
- Painel da equipe → Sistema mostra quanto já foi usado; o envio de arquivos já trava antes de estourar.

## 3. Calls

Na call do Resenha cada pessoa se conecta **direto** com todas as outras (sem servidor de mídia no meio). Isso é ótimo
para a qualidade e não custa nada de servidor, mas cada pessoa envia uma cópia da voz para cada outra:

| Pessoas na call | Conectaram | Upload de voz de cada pessoa | Quem transmite a tela (720p 60) para todos |
|---|---|---|---|
| 2 | todos, em 0,4 s | ~100 kbps | ~4 Mbps (1 espectador) |
| 4 | todos, em 0,6 s | ~290 kbps | ~11 Mbps (3 espectadores) |
| 6 | todos, em 0,9 s | ~480 kbps | ~12 Mbps (5 espectadores) |
| 8 | todos, em 1,9 s | ~670 kbps | ~11 Mbps (7 espectadores) |

- **Voz**: até 8–10 pessoas a voz é leve (menos de 1 Mbps de upload para cada um). O limite atual é 10 por call (`MAX_VOICE_PEERS`).
- **Transmissão**: com o turbo o PC codifica **uma vez só**, mas a internet ainda manda **uma cópia para cada espectador**.
  Regra prática do upload de quem transmite: **bitrate × número de espectadores** (1080p 60 ≈ 8 Mbps cada; 720p 60 ≈ 4 Mbps).
  Com 5 amigos assistindo em 1080p são ~40 Mbps de upload; muita internet residencial não tem isso.
  - Até **3–4 espectadores** em 1080p (ou 5–6 em 720p) funciona bem numa boa fibra.
  - No teste com 6 e 8 pessoas o FPS de quem assiste caiu, mas ali as 8 "pessoas" eram navegadores rodando no mesmo
    computador de teste (o processador dele lotou). Num grupo real, cada um está no próprio PC.
- **Para transmitir para muita gente** (10, 20, 50 pessoas) é preciso um **servidor de mídia (SFU)**: quem transmite manda
  uma cópia só e o servidor repassa. Isso gasta banda de servidor, que custa dinheiro. Opções para estudar quando chegar a hora:
  Cloudflare Calls (tem uma franquia grande de tráfego grátis por mês) ou um servidor próprio barato.

## 4. TURN (quem não tem conexão direta: 4G/5G, CGNAT)

- **Provedor principal: Cloudflare Realtime** (TURN Server): **1.000 GB por mês grátis**, depois US$ 0,05 por GB.
  Variáveis no Render: `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` (Cloudflare → Realtime → TURN Server →
  criar chave). Com a Cloudflare funcionando, o Metered **não** é entregue aos navegadores (só entra se a Cloudflare falhar).
- **Reserva: Metered** (`METERED_TURN_DOMAIN`, `METERED_TURN_API_KEY`), cota pequena no plano grátis.
- Painel da equipe → Saúde mostra quantos minutos passaram pelo TURN e quantos MB no mês. A conta é uma estimativa do
  Resenha (só conta o aparelho que usa o TURN pelo próprio lado); o número oficial é o do painel do provedor.
- Coloque a cota em `TURN_QUOTA_MB` (no Render) para ver a barra em Sistema e receber aviso quando passar de 80%:
  com a Cloudflare, `1000000` (1.000 GB).
- Transmissões via TURN já vão em qualidade reduzida para economizar.

## 5. Avisos automáticos

Painel da equipe → Sistema → **Limites do plano (agora)**: processador, memória, TURN e quem está conectado. Banco e
arquivos ficam logo abaixo. Passou de **80%** em algum limite, a equipe recebe um **e-mail** (no máximo um por dia por
limite). Variáveis (no Render, se o plano mudar): `CPU_LIMIT` (núcleos, padrão 0.1), `MEMORY_LIMIT_MB` (512),
`TURN_QUOTA_MB` (sem padrão).

## 6. Quando pagar o quê

| Sinal | O que fazer |
|---|---|
| Processador passando de 80% nos horários de pico, ou mais de ~150 pessoas online juntas com chat agitado | Render Starter (~US$ 7/mês). De quebra, o site não dorme e dá para ligar o site de teste (`docs/LANCAMENTOS.md`) |
| Banco passando de 80% | Plano pago do Neon (cobrado pelo uso) ou apagar mensagens antigas de servidores abandonados |
| Arquivos passando de 80% (R2, 10 GB grátis) | O R2 cobra pouco por GB acima do grátis; antes disso dá para baixar as cotas por pessoa/servidor |
| TURN perto da cota | Com a Cloudflare: passar de 1.000 GB/mês custa US$ 0,05 por GB a mais (ligue um alerta de cobrança na Cloudflare) |
| Querem transmitir para mais de ~5 pessoas, ou calls com mais de 10 | Servidor de mídia (SFU): é uma mudança de arquitetura, vale planejar junto |

Hoje, com um grupo de amigos, **tudo cabe no grátis com bastante folga**. O primeiro limite que deve aparecer, se o
Resenha crescer, é o processador do Render em horário de pico.
