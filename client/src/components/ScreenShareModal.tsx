import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Cpu, Film, Gauge, Info, Signal, SlidersHorizontal, Smartphone, UserCheck, UserPlus, UserX, Users, Volume2, Zap } from 'lucide-react';
import type { ScreenAudienceMode } from '../../../shared/types';
import { closeModal, findMember, useApp } from '../store/app';
import { updateSettings, useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { CODECS, SCREEN_PRESETS, effectiveBitrate, presetById, screenPresetFor } from '../voice/settings';
import { Avatar } from './Avatar';
import { Modal } from './Modals';

/**
 * Botão "i" ao lado de uma opção: abre um balãozinho curto explicando o que ela faz.
 * Abre ao tocar/clicar (funciona no celular) e fecha ao clicar fora ou com Esc.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <span
      className="info-tip"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation(); // fecha só o balão, não a janela
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={`info-btn${open ? ' open' : ''}`}
        aria-label={`O que é: ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={15} />
      </button>
      {open && (
        <span role="tooltip" id={id} className="info-pop">
          <strong>{label}</strong>
          {children}
        </span>
      )}
    </span>
  );
}

/** Uma linha de opção: ícone, nome curto, "i" com a explicação e o interruptor. */
function OptionRow({
  icon,
  label,
  badge,
  info,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  badge?: string;
  info: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange(v: boolean): void;
}) {
  const id = useId();
  return (
    <div className={`opt-row${checked ? ' on' : ''}`}>
      <span className="opt-icon" aria-hidden>
        {icon}
      </span>
      <label htmlFor={id} className="opt-label">
        {label}
        {badge && <span className="opt-badge">{badge}</span>}
      </label>
      <InfoTip label={label}>{info}</InfoTip>
      <input id={id} type="checkbox" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

const NO_AUDIENCE = { mode: 'all' as const, userIds: [] as string[] };

const AUDIENCE: { id: ScreenAudienceMode; label: string; icon: ReactNode }[] = [
  { id: 'all', label: 'Todos da call', icon: <Users size={16} /> },
  { id: 'friends', label: 'Só amigos', icon: <UserCheck size={16} /> },
  { id: 'only', label: 'Só quem eu escolher', icon: <UserPlus size={16} /> },
  { id: 'except', label: 'Todos menos…', icon: <UserX size={16} /> },
];

/** Quem pode assistir a minha transmissão (vale na hora, inclusive no meio da transmissão). */
export function AudiencePicker() {
  const saved = useVoice((s) => s.settings.screenAudience);
  const a = saved ?? NO_AUDIENCE;
  const channelId = useVoice((s) => s.channelId);
  const guildId = useVoice((s) => s.guildId);
  const friends = useApp((s) => s.friends);
  const meId = useApp((s) => s.me?.id);
  // (lista calculada fora do seletor: um seletor que devolve uma lista nova a cada leitura re-renderiza sem parar)
  const voiceStates = useApp((s) => s.voiceStates);
  const people = useMemo(
    () => [...new Set(Object.values(voiceStates).filter((v) => v.channelId === channelId && v.userId !== meId).map((v) => v.userId))],
    [voiceStates, channelId, meId],
  );
  const set = (mode: ScreenAudienceMode, userIds = a.userIds) => voice.setScreenAudience({ mode, userIds });
  const toggle = (userId: string, on: boolean) => set(a.mode, on ? [...a.userIds, userId] : a.userIds.filter((id) => id !== userId));
  const isFriend = (id: string) => friends.some((f) => f.user.id === id && f.status === 'friend');
  const friendsHere = people.filter(isFriend).length;

  return (
    <section className="share-section">
      <div className="share-head">
        <h3>Quem pode assistir</h3>
        <InfoTip label="Quem pode assistir">
          Quem não puder assistir vê "🔒 transmitindo para outras pessoas". Dá para mudar no meio da transmissão: quem sair da lista para de
          ver na hora. A sua voz continua para todos da call.
        </InfoTip>
      </div>
      <div className="audience-modes" role="radiogroup" aria-label="Quem pode assistir">
        {AUDIENCE.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={a.mode === m.id} className={a.mode === m.id ? 'selected' : ''} onClick={() => set(m.id)}>
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      {a.mode === 'friends' && (
        <p className="muted small">
          {people.length ? `${friendsHere} de ${people.length} pessoa${people.length > 1 ? 's' : ''} da call ${friendsHere === 1 ? 'é sua amiga' : 'são suas amigas'}.` : 'Só seus amigos do Resenha veem.'}
        </p>
      )}
      {(a.mode === 'only' || a.mode === 'except') && (
        <div className="audience-people">
          <p className="muted small">{a.mode === 'only' ? 'Só as pessoas marcadas veem.' : 'As pessoas marcadas NÃO veem.'}</p>
          {people.length === 0 ? (
            <p className="muted small">
              Ninguém mais está na call agora. Quem entrar depois {a.mode === 'only' ? 'só vai ver se você marcar.' : 'vai poder assistir.'}
            </p>
          ) : (
            <ul>
              {people.map((id) => {
                const u = findMember(guildId, id);
                const name = u?.displayName ?? 'Alguém';
                return (
                  <li key={id}>
                    <label className="audience-person">
                      <input type="checkbox" checked={a.userIds.includes(id)} onChange={(e) => toggle(id, e.target.checked)} aria-label={name} />
                      <Avatar user={u} size={24} />
                      <span className="ellipsis">{name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Janela "Transmitir tela": o essencial à vista; o resto em "Avançado". Cada opção tem um "i" explicando. */
export function ScreenShareModal() {
  const settings = useVoice((s) => s.settings);
  const sharing = useVoice((s) => s.screen);
  const channelId = useVoice((s) => s.channelId);
  const viewers = useApp((s) => Object.values(s.voiceStates).filter((v) => v.channelId === channelId).length - 1);
  const preset = screenPresetFor(settings);
  const capped = settings.performanceMode && presetById(settings.screenPreset).id !== preset.id;
  const light = useVoice((s) => s.screenLight);
  const mbps = effectiveBitrate(settings) / 1e6;
  const [starting, setStarting] = useState(false);
  const relayedPeers = useVoice((s) => Object.values(s.remotes).filter((r) => r.relayed).length);

  function update(patch: Partial<typeof settings>) {
    updateSettings(patch);
    if (sharing || 'turnSaver' in patch) voice.refreshEncodings();
  }

  async function start() {
    setStarting(true);
    const ok = await voice.startScreen();
    setStarting(false);
    if (ok) closeModal();
  }

  return (
    <Modal title="Transmitir tela" wide>
      <div className="share-form">
        <AudiencePicker />

        <section className="share-section">
          <div className="share-head">
            <h3>Qualidade</h3>
          </div>
          <div className="opt-row">
            <span className="opt-icon" aria-hidden>
              <Gauge size={18} />
            </span>
            <label htmlFor="share-preset" className="opt-label">
              Resolução e FPS
            </label>
            <InfoTip label="Resolução e FPS">
              O máximo que você envia. Cada amigo escolhe na tela dele se quer assistir em menos (Automático, 720p, 480p) sem mudar nada para
              os outros. Para trocar com a transmissão no ar, pare e comece de novo.
            </InfoTip>
            <select
              id="share-preset"
              value={settings.screenPreset}
              disabled={sharing}
              onChange={(e) => update({ screenPreset: e.target.value, bitrateMbps: null })}
            >
              {SCREEN_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {capped && <p className="muted small share-note">No modo desempenho vai em {preset.label}.</p>}
          {light && (
            <div className="warn-box small">
              Resolução reduzida para manter o FPS sem pesar no jogo.{' '}
              <button className="link-btn" onClick={() => voice.setScreenLight(false)}>
                Voltar para {preset.label}
              </button>
            </div>
          )}
        </section>

        <section className="share-section">
          <div className="share-head">
            <h3>Opções</h3>
          </div>
          <OptionRow
            icon={<Zap size={18} />}
            label="Transmissão turbo"
            badge="recomendado"
            checked={settings.turbo}
            disabled={sharing}
            onChange={(v) => update({ turbo: v })}
            info={
              <>
                Prepara o vídeo uma vez só e manda a mesma cópia para todos: mais FPS e menos peso no seu PC. Se o PC apertar, cai a resolução, não
                o FPS. Quem não suporta recebe pelo modo normal.
              </>
            }
          />
          <OptionRow
            icon={<Cpu size={18} />}
            label="Modo desempenho"
            badge="para jogar"
            checked={settings.performanceMode}
            disabled={sharing}
            onChange={(v) => update({ performanceMode: v })}
            info={
              <>
                Usa a placa de vídeo (H.264), no máximo 1080p, e deixa a transmissão mais leve sozinha se o jogo começar a perder FPS.
              </>
            }
          />
          <OptionRow
            icon={<Volume2 size={18} />}
            label="Som do computador"
            checked={settings.screenAudio}
            disabled={sharing}
            onChange={(v) => update({ screenAudio: v })}
            info={
              <>
                Manda o som do jogo ou do vídeo junto. No Chrome/Edge, na hora de escolher, marque "Compartilhar áudio do sistema" (tela inteira)
                ou "Compartilhar áudio da aba". Dá para desligar o som no meio da transmissão sem parar a imagem.
              </>
            }
          />
          <OptionRow
            icon={<Smartphone size={18} />}
            label="Economizar para quem está no 4G"
            badge={relayedPeers > 0 ? `${relayedPeers} agora` : undefined}
            checked={settings.turnSaver}
            onChange={(v) => update({ turnSaver: v })}
            info={
              <>
                Quem não consegue ligação direta com você (comum no 4G/5G) recebe por um servidor de retransmissão com cota pequena. Ligado, essas
                pessoas recebem 720p · 30 FPS; as outras continuam na qualidade máxima.
              </>
            }
          />
        </section>

        <details className="share-advanced">
          <summary>
            <SlidersHorizontal size={16} /> Avançado
          </summary>
          <div className="opt-row">
            <span className="opt-icon" aria-hidden>
              <Signal size={18} />
            </span>
            <label htmlFor="share-bitrate" className="opt-label">
              Bitrate máximo <strong>{mbps.toFixed(1)} Mbps</strong>
            </label>
            <InfoTip label="Bitrate máximo">
              Mais bitrate deixa a imagem mais nítida em cenas rápidas, mas usa mais internet: cada pessoa assistindo recebe uma cópia. Com{' '}
              {Math.max(1, viewers)} pessoa{viewers > 1 ? 's' : ''}, seu upload precisa de ≈{(mbps * Math.max(1, viewers)).toFixed(0)} Mbps.
            </InfoTip>
          </div>
          <input
            id="share-bitrate"
            className="share-range"
            type="range"
            min={1}
            max={40}
            step={0.5}
            value={mbps}
            onChange={(e) => update({ bitrateMbps: Number(e.target.value) })}
          />
          <div className="opt-row">
            <span className="opt-icon" aria-hidden>
              <Film size={18} />
            </span>
            <span className="opt-label">Tipo de conteúdo</span>
            <InfoTip label="Tipo de conteúdo">
              Jogo/vídeo: quando a internet aperta, mantém a fluidez ({preset.fps} FPS). Texto/código: mantém a nitidez (letras legíveis).
            </InfoTip>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Tipo de conteúdo">
            <button type="button" role="radio" aria-checked={settings.contentType === 'motion'} className={settings.contentType === 'motion' ? 'selected' : ''} onClick={() => update({ contentType: 'motion' })}>
              🎮 Jogo / vídeo
            </button>
            <button type="button" role="radio" aria-checked={settings.contentType === 'detail'} className={settings.contentType === 'detail' ? 'selected' : ''} onClick={() => update({ contentType: 'detail' })}>
              📝 Texto / código
            </button>
          </div>
          <div className="opt-row">
            <span className="opt-icon" aria-hidden>
              <Cpu size={18} />
            </span>
            <label htmlFor="share-codec" className="opt-label">
              Codec
            </label>
            <InfoTip label="Codec">
              O formato do vídeo. H.264 usa a placa de vídeo e funciona em todo lugar (recomendado). VP9 e AV1 dão mais qualidade, mas quase sempre
              usam o processador. No modo desempenho é sempre H.264.
            </InfoTip>
            <select
              id="share-codec"
              value={settings.performanceMode ? 'h264' : settings.codec}
              onChange={(e) => update({ codec: e.target.value as typeof settings.codec })}
              disabled={sharing || settings.performanceMode}
            >
              {CODECS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </details>

        <div className="modal-actions">
          <button className="btn ghost" onClick={closeModal}>
            {sharing ? 'Fechar' : 'Cancelar'}
          </button>
          {!sharing && (
            <button className="btn primary" onClick={start} disabled={starting}>
              {starting ? 'Escolha a tela…' : 'Escolher tela e transmitir'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
