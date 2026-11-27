# Estado atual do Resenha

Legenda: ✅ **concluído** (tem teste automático e passou) · 🧪 **experimental** (existe, mas fechado a contas da lista ou em laboratório) · ⚠️ **não validado** (código pronto e testado só em ambiente simulado; falta teste em aparelho/serviço real) · 📋 **planejado** (veja `docs/ROADMAP.md`).

Versões: app de Windows **0.3.10** · app Android **1.0.2** publicado (o código do repositório tem mudanças **não lançadas**) · site: a cada push da branch de trabalho. ~100 testes em `e2e/`. Segurança auditada item a item em `SECURITY_AUDIT.md`.

## ✅ Concluído
**Contas e acesso:** cadastro (e-mail confirmado, termos, captcha Turnstile, senha vazada HIBP), login, recuperação por e-mail ou códigos, 2FA (TOTP + códigos), sessões/aparelhos, exportar e apagar conta, suspensão pela equipe, códigos de convite pessoais, lista de espera, cadastro abrível/fechável.
**Servidores e permissões:** servidores, canais (texto/voz/avisos/privados), categorias, cargos com bitmask e overrides, hierarquia, convites, regras com "Aceito", boas-vindas, servidor oficial com entrada automática, Explorar (públicos), auditoria do servidor, limites de recursos.
**Chat:** mensagens com formatação, respostas, reações, fixadas, busca, não lidas, menções, enquetes, eventos, emojis/figurinhas/sons, modo lento, **moderação automática** (palavras, links com **sites liberados**, convites, anti-spam, cargos isentos), anexos (R2 ou banco, cotas, lixeira, links assinados, imagens re-encodadas sem EXIF), prévia de YouTube/Spotify, imagem externa só com clique.
**Social:** amigos, DMs, **bloqueio de pessoas** (DM/pedido/ligação nos dois sentidos, presença escondida, aviso na call), denúncias, suporte, apoio por Pix (confirmação manual) e anéis de Fundador.
**Chamadas:** voz P2P com TURN, ruído por IA (Forte/Leve) e do navegador, transmissão de tela (presets, turbo, qualidade por pessoa, quem pode assistir), câmera, chat da call, soundboard, assistir juntos, moderação de voz (mover/silenciar/ensurdecer/desconectar), banners, diagnóstico "Relatar problema", cadeado de criptografia, **volume por pessoa até 200%**, **câmera do celular por QR Code** (no computador; no celular liga a câmera direto).
**Interface:** claro/escuro, cores, papéis de parede, ícones do app, layout novo (abas no desktop, barra inferior no celular) e câmera do celular **liberados para todos**, pop-up de novidades, PWA e notificações push.
**Operação:** painel da equipe (saúde, capacidade, TURN, medidor de internet, novas contas, apoio, denúncias), **chaves de emergência** e "sair de todos os aparelhos", backups criptografados, `security.txt` e página de segurança.
**Segurança:** auditoria completa (`SECURITY_AUDIT.md`), matriz de autorização das ~200 rotas, testes de abuso (WebSocket, uploads, XSS, SSRF, força bruta), filtro de nomes com homóglifos, cofre de segredos, varredura de segredos no CI.
**Desktop (Windows):** captura de tela/áudio, overlay no jogo, Spotify local, atualização automática.

## 🧪 Experimental (fechado por flag ou laboratório)
- **Resenha Bot** (comandos `/`, DJ, jogos, tickets): ligado só às contas da lista `bots`; "Para todos" é decisão do dono.
- **Bots de terceiros** (Configurações → Desenvolvedor): lista `botdev`. API/webhook assinados, SSRF-safe, registro de erros. Faltam Termos/Privacidade, denúncia de bot e desligamento automático (veja roadmap).
- **IA nos bots** (`/ia`, `/traduzir`, `/resumo`): **desligada** (`BOTS_AI=1` liga). Tem teto de custo e limites por conta/servidor.
- **SFU Cloudflare** e **FPS fixo** (camadas temporais/CBR): laboratório, atrás de chave da equipe, não lançados.
- **Servidor de testes** ("Laboratório Resenha") criado pelo painel para contas liberadas.

## ⚠️ Código pronto, não validado em aparelho/serviço real
- **App Android:** `onJsConfirm`/`onJsAlert` e a **tela "sem conexão" com tentativa automática** compilam e foram revisados, mas não rodaram num aparelho; a versão **1.0.3 não foi lançada** (`android/release.json` aponta para 1.0.2).
- **Virar a câmera do celular várias vezes** (correção): testado só com câmera falsa do Chromium.
- **Volume acima de 100%:** lógica testada; ganho audível em PCs reais não medido.
- **DJ:** áudio real do YouTube não testado em automação (só a lógica); player escondido contraria a recomendação de uso do YouTube.
- **Telas novas sem teste visual:** campo "Sites liberados" no painel de moderação (a API é testada).
- **Bloqueio dentro de servidores:** mensagens recolhidas só no app (o servidor ainda entrega).

## 📋 Planejado
Veja `docs/ROADMAP.md`. Em resumo: ações do dono (MFA, chaves, GitHub, DNS de e-mail), liberar bots, configuração "quem pode me chamar", convites com validade, pentest externo, e itens jurídicos (idade mínima, LGPD, retenção).

## Pendências que dependem do dono
Ver `docs/HANDOFF.md` ("Aguardando o dono") e `SECURITY_AUDIT.md` seção 6.
