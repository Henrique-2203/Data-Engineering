import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { closeModal, useApp } from '../store/app';
import { useVoice } from '../store/voice';

/**
 * Novidades do Resenha, em linguagem simples, para quem usa. Regra: só o que muda no uso.
 * Melhorias de segurança aparecem só como "ficou mais seguro", sem detalhes técnicos (não ensinamos
 * a ninguém onde estavam os pontos fracos). A mais nova fica em cima; o id é a data (AAAA-MM-DD, com uma letra no fim se sair mais de uma no mesmo dia).
 */
export const CHANGELOG: { id: string; title: string; items: [string, string][] }[] = [
  {
    id: '2026-11-11b',
    title: 'Deixe o Resenha com a sua cara',
    items: [
      ['🌗', 'Modo claro, escuro ou seguindo o sistema: Configurações → Aparência.'],
      ['🎨', '8 cores de destaque e 3 fundos para o modo escuro: Padrão, Meia-noite e Preto total (economiza bateria em telas OLED).'],
      ['🖼️', 'Papel de parede nos chats: 12 desenhos nossos, uma cor ou a sua foto, com ajuste para escurecer e desfocar. Vale para todos os chats ou só para uma conversa (botão de paleta no topo dela). Só você vê, e a foto fica só no seu aparelho.'],
    ],
  },
  {
    id: '2026-11-11a',
    title: 'Transmissão do seu jeito',
    items: [
      ['📶', 'Qualidade para cada um: na transmissão que você está assistindo, toque no botão de qualidade e escolha Automático, Original, 720p ou 480p. Muda só para você. No Automático, o Resenha baixa a qualidade sozinho se a sua internet não der conta e sobe de novo quando melhorar.'],
      ['💡', 'Se você escolheu "Original" e a sua internet está sofrendo, o Resenha sugere uma qualidade menor (você decide).'],
      ['🔒', 'Quem pode assistir: ao transmitir, escolha Todos da call, Só amigos, Só quem eu escolher ou Todos menos… Dá para mudar no meio da transmissão. Quem não pode assistir vê "transmitindo para outras pessoas".'],
      ['🧭', 'A janela de transmitir ficou mais simples: o essencial à vista, o resto em "Avançado", e um botão "i" explicando cada opção.'],
    ],
  },
  {
    id: '2026-11-10f',
    title: 'Assistir juntos melhorado',
    items: [
      ['🫥', 'O título e a barra de tempo somem sozinhos depois de 3 segundos sem mexer o mouse (e voltam quando você mexe).'],
      ['💬', 'Legendas: botão de legenda no player, só para você.'],
      ['⚙️', 'Qualidade do vídeo: no botão de engrenagem, liga os controles do próprio YouTube só no seu player (qualidade, legendas e idioma). Pausar e pular por eles vale para todos.'],
      ['👋', 'O X agora fecha o vídeo só para você: os outros continuam assistindo, e você volta quando quiser ("Voltar a assistir"). Para parar para todo mundo, use o botão ■.'],
      ['🔁', 'O vídeo não depende de quem colocou: se essa pessoa sair da call, continua para os outros.'],
    ],
  },
  {
    id: '2026-11-10e',
    title: 'Música e vídeos com a galera',
    items: [
      ['▶️', 'Links do YouTube e do Spotify viram player no chat: toque no card para assistir ou ouvir ali mesmo. O player só carrega quando você toca.'],
      ['📺', 'Assistir juntos: na call, toque no botão de TV e cole um link do YouTube. O vídeo toca sincronizado para todo mundo, com fila, pausa e "pular para" valendo para todos. O volume é só seu.'],
      ['🔒', 'Conversa "Só da call": no painel de mensagens da call, a aba "Só da call" é só para quem está na chamada. Nada fica salvo: some quando a call acaba. A aba "Canal" continua sendo o chat salvo do canal.'],
      ['🎵', 'Ouvindo agora (app de Windows): com o Spotify do PC tocando, a música aparece no seu perfil, como o "Jogando agora". Dá para desligar em Configurações → Atalhos e app.'],
      ['💬', 'O nome e o horário das mensagens agora ficam alinhados com a foto de perfil.'],
    ],
  },
  {
    id: '2026-11-10d',
    title: 'Calls mais confiáveis',
    items: [
      ['📈', 'Para achar problemas antes de você: durante a call, o Resenha soma por dia números anônimos de qualidade (atraso, perda da voz, FPS das transmissões) e erros do site. Não vai quem você é, com quem fala nem nada do que é dito ou mostrado. Dá para desligar em Configurações → Privacidade e dados.'],
    ],
  },
  {
    id: '2026-11-10c',
    title: 'Relatar problema da call',
    items: [
      ['🩺', 'Algo estranho na call (voz cortando, transmissão travando)? Toque em "Relatar problema" na barra da call: o Resenha mede a conexão por 5 segundos, mostra o que encontrou e manda os números para a equipe. Nunca vai áudio, vídeo, mensagens nem seu endereço IP, e você vê tudo antes de enviar.'],
    ],
  },
  {
    id: '2026-11-10b',
    title: 'Banner da call',
    items: [
      ['🎨', 'Banner da call: escolha um fundo para o seu quadro na chamada. São 13 temas (Cidade Neon, Tático, Blocos, Zona da Tempestade, Corrida, Espaço…), sua própria imagem ou o banner do perfil. Ele se ajusta ao tamanho do quadro de cada pessoa. Configurações → Perfil.'],
    ],
  },
  {
    id: '2026-11-10a',
    title: 'Transmissão turbo',
    items: [
      ['⚡', 'Transmissão turbo: o vídeo da sua tela é preparado uma vez só para todos os amigos. Fica bem mais fluida (no nosso teste com 3 amigos, de cerca de 25 para mais de 50 FPS) e pesa menos no seu PC.'],
      ['🎮', 'Quando o PC aperta, a transmissão diminui a resolução e mantém o FPS.'],
      ['🖥️', 'App de Windows: enquanto você transmite, a captura da tela ganha prioridade na placa de vídeo (o jogo quase não sente).'],
      ['📊', 'Enquetes: depois de votar, toque em "Ver quem votou" para ver o nome de quem escolheu cada opção.'],
    ],
  },
  {
    id: '2026-11-09b',
    title: 'Novidades para quem joga',
    items: [
      ['🎮', 'Transmissão mais leve: o novo "Modo desempenho" usa a placa de vídeo e, se o PC começar a sofrer, deixa a transmissão mais leve sozinho para não tirar FPS do jogo.'],
      ['🎙️', 'Supressão de ruído com IA: tira teclado, cliques e ventilador sem cortar sua voz. Já vem ligada (Configurações → Voz e vídeo).'],
      ['🔁', 'Atualizações não derrubam mais a call: a voz continua enquanto o Resenha se atualiza.'],
      ['🛟', 'Suporte: fale com a equipe pelo botão de boia, no pé da coluna de servidores (à esquerda).'],
      ['🌐', 'O site do Resenha abre mesmo com você logado. O app fica no endereço /app.'],
      ['🔒', 'Melhorias de segurança: sua conta e suas conversas ficaram ainda mais protegidas.'],
    ],
  },
  {
    id: '2026-11-09a',
    title: 'Novidades na call e nos servidores',
    items: [
      ['💬', 'Chat da call, volume separado para cada transmissão e botão para ligar ou desligar o som da sua transmissão.'],
      ['🔎', 'Busca de mensagens, mensagens fixadas, enquetes e eventos agendados.'],
      ['🛡️', 'Moderação automática e modo lento para quem cuida de servidores.'],
      ['📱', 'Notificações no celular de mensagens diretas, menções e eventos.'],
      ['🔒', 'Melhorias de segurança.'],
    ],
  },
];

export const LATEST_CHANGELOG = CHANGELOG[0].id;

/** Novidades que esta conta ainda não confirmou. Conta nova não vê histórico antigo. */
export function pendingChangelog(seen: string | null, accountCreatedAt: string | null) {
  if (!seen) {
    // conta criada depois da última novidade: nada para mostrar
    if (accountCreatedAt && accountCreatedAt.slice(0, 10) >= LATEST_CHANGELOG.slice(0, 10)) return [];
    return CHANGELOG.slice(0, 1);
  }
  return CHANGELOG.filter((c) => c.id > seen);
}

/** Pop-up de novidades: só fecha com "Entendi" (vale para todos os aparelhos da conta). */
export function ChangelogModal() {
  const entries = useApp((s) => s.pendingChangelog);
  if (!entries.length) return null;
  async function confirm() {
    useApp.setState({ pendingChangelog: [] });
    closeModal();
    await api('/me/changelog-seen', { body: { id: entries[0].id } }).catch(() => {});
  }
  return (
    <div className="modal-backdrop">
      <div className="modal changelog" role="dialog" aria-modal="true" aria-label="Novidades do Resenha">
        <div className="modal-head">
          <h2>
            <Sparkles size={20} /> O Resenha foi atualizado
          </h2>
        </div>
        <div className="modal-body">
          {entries.map((e) => (
            <section key={e.id}>
              <h3>{e.title}</h3>
              <ul className="changelog-list">
                {e.items.map(([icon, text]) => (
                  <li key={text}>
                    <span aria-hidden>{icon}</span> {text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="modal-actions">
            <button className="btn primary" autoFocus onClick={() => void confirm()}>
              Entendi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mostra as novidades quando der: nunca no meio de uma call (espera ela acabar) nem por cima de outra janela. */
export function maybeShowChangelog() {
  const app = useApp.getState();
  if (!app.pendingChangelog.length || app.modal) return;
  if (useVoice.getState().status !== 'idle') return;
  useApp.setState({ modal: { kind: 'changelog' } });
}

/** Fica de olho: quando a call acabar ou a janela aberta fechar, mostra as novidades pendentes. */
export function ChangelogWatcher() {
  useEffect(() => {
    maybeShowChangelog();
    const offVoice = useVoice.subscribe((s, prev) => s.status === 'idle' && prev.status !== 'idle' && maybeShowChangelog());
    const offApp = useApp.subscribe((s, prev) => !s.modal && prev.modal && setTimeout(maybeShowChangelog, 400));
    return () => {
      offVoice();
      offApp();
    };
  }, []);
  return null;
}
