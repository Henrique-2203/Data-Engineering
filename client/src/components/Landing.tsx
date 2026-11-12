import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Download, Globe, Lock, Monitor, Smartphone, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { api, hasSession } from '../lib/api';
import { SOURCE_URL } from './LegalPage';

/** Animação de entrada quando a seção aparece na tela. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.lp-reveal');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Página inicial pública: apresentação, download, lista de espera. */
export function Landing() {
  useReveal();
  useEffect(() => {
    document.title = 'Resenha · Call, chat e tela em Full HD de graça';
    // conta a visita (só um total por dia e a origem; nada que identifique a pessoa)
    try {
      // aparelhos da equipe não contam (marcado ao entrar com uma conta da equipe)
      if (!sessionStorage.getItem('resenha.visit') && localStorage.getItem('resenha.noStats') !== '1') {
        sessionStorage.setItem('resenha.visit', '1');
        const params = new URLSearchParams(location.search);
        void api('/stats/view', { body: { src: params.get('src') ?? params.get('utm_source') ?? undefined, ref: document.referrer || undefined } }).catch(() => {});
      }
    } catch {
      /* navegador sem sessionStorage: não conta */
    }
  }, []);

  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true">
        <i className="lp-blob a" />
        <i className="lp-blob b" />
        <i className="lp-blob c" />
      </div>

      <div className="lp-beta" role="note">
        🚧 <strong>O Resenha está em desenvolvimento (beta).</strong> Pode ter bugs, e sua opinião ajuda a construir.
      </div>

      <header className="lp-nav">
        <a href="/" className="lp-logo">
          <img src="/icon.svg" alt="" width={34} height={34} /> Resenha <span className="lp-tag">BETA</span>
        </a>
        <nav>
          <button onClick={() => scrollTo('recursos')}>Recursos</button>
          <button onClick={() => scrollTo('baixar')}>Baixar</button>
          <button onClick={() => scrollTo('privacidade')}>Privacidade</button>
          <a href="/suporte" className="lp-link">
            Suporte
          </a>
          <a className={`lp-btn small ${hasSession() ? 'primary' : 'ghost'}`} href="/app">
            {hasSession() ? 'Abrir o Resenha' : 'Entrar'}
          </a>
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text lp-reveal">
            <p className="lp-kicker">
              <Sparkles size={16} /> Feito no Brasil, pra galera que joga junto
            </p>
            <h1>
              Sua call. Sua tela. <span className="lp-grad">Sem pagar nada.</span>
            </h1>
            <p className="lp-lead">
              Chat, voz e transmissão de tela em <strong>Full HD</strong> com os amigos. Soundboard, emojis, figurinhas e foto em GIF: o que
              nos outros apps é pago, aqui é <strong>de graça</strong>. E com o jeitinho que você já conhece.
            </p>
            <div className="lp-cta">
              <button className="lp-btn primary" onClick={() => scrollTo('lista')}>
                Entrar na lista de espera
              </button>
              <a className="lp-btn" href="/api/download/windows">
                <Download size={18} /> Baixar para Windows <span className="lp-beta-chip">beta</span>
              </a>
            </div>
            <p className="lp-small">
              Já tem convite? <a href="/app">Use no navegador</a>, sem instalar nada.
            </p>
          </div>
          <div className="lp-hero-video lp-reveal">
            <Trailer />
          </div>
        </section>

        <section className="lp-stats lp-reveal">
          <Stat value="1080p" label="transmissão de tela" />
          <Stat value="510 kbps" label="de áudio na call" />
          <Stat value="R$ 0" label="pra usar tudo" />
          <Stat value="0" label="anúncios e rastreadores" />
        </section>

        <section id="recursos" className="lp-features">
          <Feature
            title="Mesmo jeitinho que você já conhece"
            text="Servidores, canais de texto e voz, cargos com cor, categorias e mensagens diretas. Abriu, já sabe usar: zero curva de aprendizado."
            img={<Laptop src="/landing/desk-chat.webp" alt="Chat do Resenha com servidores, canais e membros" />}
          />
          <Feature
            reverse
            title="Transmita a gameplay em Full HD"
            text="Compartilhe a tela com áudio para a galera toda assistir junto, com codec na placa de vídeo e qualidade ajustável. Sem assinatura."
            img={<Laptop src="/landing/trailer-poster.jpg" alt="Transmissão de tela em uma call do Resenha" />}
          />
          <Feature
            title="Soundboard na call"
            text="Sons do servidor tocando para todos, com emoji animado em quem apertou. Cada um controla o próprio volume."
            img={<Phone src="/landing/phone-soundboard.webp" alt="Soundboard do Resenha no celular" />}
          />
          <Feature
            reverse
            title="Emojis, figurinhas e foto em GIF"
            text="Emojis e figurinhas personalizados que funcionam em qualquer servidor, foto de perfil animada, banner e apelido por servidor."
            img={<Phone src="/landing/phone-chat.webp" alt="Chat com figurinhas e emojis personalizados" />}
          />
          <Feature
            title="Mostra o jogo que você tá jogando"
            text="O app de desktop reconhece o jogo aberto e mostra no seu perfil. Só o nome do jogo sai do seu PC, e dá para desligar."
            img={<Phone src="/landing/phone-profile.webp" alt="Perfil mostrando Jogando Valorant" />}
          />
        </section>

        <section className="lp-compare lp-reveal">
          <h2>Grátis de verdade</h2>
          <p className="lp-sub">O que costuma exigir assinatura, no Resenha vem liberado para todo mundo.</p>
          <table>
            <thead>
              <tr>
                <th />
                <th className="us">Resenha</th>
                <th>Outros apps</th>
              </tr>
            </thead>
            <tbody>
              {[
                'Transmissão de tela em Full HD',
                'Áudio da call em alta qualidade (até 510 kbps)',
                'Usar emojis e figurinhas de outros servidores',
                'Foto de perfil em GIF e banner',
                'Foto e apelido diferentes por servidor',
                'Soundboard sem limite de vagas',
              ].map((row) => (
                <tr key={row}>
                  <td>{row}</td>
                  <td className="us">
                    <Check size={18} /> Grátis
                  </td>
                  <td className="paid">💲 Pago</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="baixar" className="lp-download">
          <h2 className="lp-reveal">Use onde quiser</h2>
          <div className="lp-cards">
            <DownloadCard
              icon={<Monitor size={28} />}
              title="Windows"
              badge="Beta disponível"
              text="Push-to-talk com o jogo em primeiro plano, transmissão sem travas do navegador e ícone na bandeja. Atualiza sozinho."
              action={<WindowsButton />}
              note='Na 1ª vez, o Windows pode mostrar "O Windows protegeu seu computador": clique em Mais informações → Executar assim mesmo.'
            />
            <DownloadCard
              icon={<Globe size={28} />}
              title="Navegador"
              badge="Disponível"
              text="Chrome, Edge ou Firefox, no PC ou no celular. Não precisa instalar nada."
              action={
                <a className="lp-btn" href="/app">
                  Abrir no navegador
                </a>
              }
            />
            <DownloadCard
              icon={<Smartphone size={28} />}
              title="Android e iPhone"
              badge="Em breve"
              soon
              text="O app de celular está em desenvolvimento. Enquanto isso, o Resenha funciona no navegador do celular."
              action={
                <button className="lp-btn" onClick={() => scrollTo('lista')}>
                  Quero ser avisado
                </button>
              }
            />
          </div>
        </section>

        <section id="lista" className="lp-waitlist lp-reveal">
          <div className="lp-waitlist-text">
            <h2>Entre na lista de espera</h2>
            <p>
              Estamos liberando o acesso aos poucos para manter tudo rápido e estável. Deixe seu contato para receber o <strong>convite</strong>{' '}
              e ser o primeiro a saber quando o app de celular sair.
            </p>
            <ul>
              <li>
                <Check size={16} /> Sem spam: só o convite e novidades importantes do Resenha
              </li>
              <li>
                <Check size={16} /> Seus dados não são vendidos nem compartilhados
              </li>
              <li>
                <Check size={16} /> Saia da lista quando quiser
              </li>
            </ul>
          </div>
          <WaitlistForm />
        </section>

        <section id="privacidade" className="lp-privacy">
          <h2 className="lp-reveal">Seus dados são seus</h2>
          <div className="lp-privacy-grid">
            {[
              ['🔐', 'Senha criptografada', 'Guardada com hash scrypt: nem a equipe consegue ver.'],
              ['📞', 'Chamadas criptografadas', 'Voz, vídeo e tela vão direto entre vocês e não são gravados.'],
              ['🚫', 'Sem anúncios', 'Não vendemos dados, não usamos rastreadores nem cookies de propaganda.'],
              ['🛡️', 'Sua conta protegida', 'Verificação em duas etapas, aparelhos conectados e códigos de recuperação.'],
              ['📦', 'Você no controle', 'Baixe tudo que guardamos sobre você ou exclua a conta quando quiser (LGPD).'],
              ['👀', 'Código público', 'Qualquer pessoa pode conferir o que o Resenha faz.'],
            ].map(([icon, title, text]) => (
              <div key={title} className="lp-privacy-item lp-reveal">
                <span>{icon}</span>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            ))}
          </div>
          <p className="lp-small center">
            <Lock size={14} /> Veja <a href="/seguranca">como protegemos você</a>, a <a href="/privacidade">Política de Privacidade</a> e os <a href="/termos">Termos de uso</a>.
          </p>
        </section>

        <section className="lp-faq lp-reveal">
          <h2>Perguntas frequentes</h2>
          <Faq q="É grátis mesmo?">
            Sim. Tudo que existe hoje é grátis, sem anúncios. Se um dia surgir algum extra pago, será algo que custa caro para manter (como 4K), e
            o que você já usa continua grátis.
          </Faq>
          <Faq q="Está pronto?">
            Ainda não: o Resenha está em <strong>beta</strong>. Já dá para conversar, falar, transmitir a tela e usar tudo da página, mas pode
            aparecer algum bug. Se encontrar, use o botão de denúncia ou fale com a gente.
          </Faq>
          <Faq q="Preciso instalar?">
            Não. Funciona no navegador do PC e do celular. O app de Windows é opcional e serve para o push-to-talk funcionar com o jogo em
            primeiro plano.
          </Faq>
          <Faq q="Funciona com quem joga no console?">
            Sim, pelo celular: a pessoa entra na call pelo navegador do celular e joga no console normalmente.
          </Faq>
          <Faq q="Como recebo o convite da lista de espera?">
            Pelo e-mail (ou WhatsApp, se você informar) que deixou na lista. Fique de olho também na caixa de spam.
          </Faq>
        </section>

        <section className="lp-final lp-reveal">
          <img src="/icon.svg" alt="" width={84} height={84} />
          <h2>Chama a resenha.</h2>
          <div className="lp-cta center">
            <button className="lp-btn primary" onClick={() => scrollTo('lista')}>
              Entrar na lista de espera
            </button>
            <a className="lp-btn" href="/api/download/windows">
              <Download size={18} /> Baixar para Windows
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <span>
          <img src="/icon.svg" alt="" width={20} height={20} /> Resenha · beta
        </span>
        <nav>
          <a href="/privacidade">Privacidade</a>
          <a href="/termos">Termos</a>
          <a href="/seguranca">Segurança</a>
          <a href="/suporte">Suporte</a>
          <a href="mailto:resenha.brasilgames@gmail.com">resenha.brasilgames@gmail.com</a>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            Código público
          </a>
        </nav>
      </footer>
    </div>
  );
}

function Trailer() {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  return (
    <div className="lp-trailer">
      <video ref={ref} src="/landing/trailer.mp4" poster="/landing/trailer-poster.jpg" autoPlay muted loop playsInline preload="metadata" aria-label="Vídeo: amigos numa call do Resenha assistindo uma transmissão de gameplay" />
      <button
        className="lp-sound"
        onClick={() => {
          const v = ref.current;
          if (!v) return;
          v.muted = !v.muted;
          if (!v.muted) {
            v.currentTime = 0;
            void v.play();
          }
          setMuted(v.muted);
        }}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />} {muted ? 'Ativar som' : 'Som ligado'}
      </button>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="lp-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Feature({ title, text, img, reverse }: { title: string; text: string; img: ReactNode; reverse?: boolean }) {
  return (
    <div className={`lp-feature lp-reveal${reverse ? ' reverse' : ''}`}>
      <div className="lp-feature-text">
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <div className="lp-feature-img">{img}</div>
    </div>
  );
}

const Laptop = ({ src, alt }: { src: string; alt: string }) => (
  <div className="lp-laptop">
    <img src={src} alt={alt} loading="lazy" />
  </div>
);
const Phone = ({ src, alt }: { src: string; alt: string }) => (
  <div className="lp-phone">
    <img src={src} alt={alt} loading="lazy" />
  </div>
);

function DownloadCard({ icon, title, badge, text, action, note, soon }: { icon: ReactNode; title: string; badge: string; text: string; action: ReactNode; note?: string; soon?: boolean }) {
  return (
    <div className="lp-card lp-reveal">
      <div className="lp-card-head">
        {icon}
        <h3>{title}</h3>
        <span className={`lp-badge${soon ? ' soon' : ''}`}>{badge}</span>
      </div>
      <p>{text}</p>
      {action}
      {note && <p className="lp-small">{note}</p>}
    </div>
  );
}

function WindowsButton() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    api<{ windowsVersion: string }>('/download/info').then((r) => setVersion(r.windowsVersion), () => {});
  }, []);
  return (
    <a className="lp-btn primary" href="/api/download/windows">
      <Download size={18} /> Baixar {version ? `v${version}` : ''} (.exe)
    </a>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="lp-q">
      <summary>
        {q} <ChevronDown size={18} />
      </summary>
      <p>{children}</p>
    </details>
  );
}

const PLATFORMS = [
  ['windows', 'Windows'],
  ['android', 'Android'],
  ['iphone', 'iPhone'],
  ['navegador', 'Navegador'],
] as const;

function WaitlistForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['windows']);
  const [source, setSource] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(''); // armadilha para robôs
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ position: number; already: boolean; invited?: boolean } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setDone(await api('/waitlist', { body: { name, email, whatsapp, platforms, source: source || undefined, consent, website } }));
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="lp-form lp-done" role="status">
        <div className="lp-done-icon">🎉</div>
        <h3>{done.already ? 'Você já estava na lista!' : 'Você está na lista!'}</h3>
        <p>
          Sua posição: <strong className="lp-pos">nº {done.position}</strong>
        </p>
        {done.invited ? (
          <p className="lp-invited">
            📩 <strong>Seu convite já foi para o seu e-mail!</strong> Abra o e-mail, copie o código e <a href="/app">crie sua conta</a>. Não chegou em alguns minutos? Olhe o
            spam.
          </p>
        ) : (
          <p className="lp-small">Vamos mandar o convite por e-mail{whatsapp ? ' ou WhatsApp' : ''}. Chama os amigos para entrarem também:</p>
        )}
        <button
          className="lp-btn"
          onClick={() => {
            const url = location.origin;
            if (navigator.share) void navigator.share({ title: 'Resenha', text: 'Call, chat e tela em Full HD de graça. Entra na lista!', url }).catch(() => {});
            else void navigator.clipboard?.writeText(url);
          }}
        >
          Compartilhar o Resenha
        </button>
      </div>
    );
  }

  return (
    <form className="lp-form" onSubmit={submit}>
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" placeholder="Como podemos te chamar?" />
      </label>
      <label>
        E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={120} autoComplete="email" placeholder="voce@email.com" />
      </label>
      <label>
        <span>
          WhatsApp <span className="lp-muted">(opcional)</span>
        </span>
        <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} maxLength={20} autoComplete="tel" placeholder="(11) 91234-5678" inputMode="tel" />
      </label>
      <fieldset>
        <legend>Onde você quer usar?</legend>
        <div className="lp-chips">
          {PLATFORMS.map(([id, label]) => {
            const on = platforms.includes(id);
            return (
              <button
                type="button"
                key={id}
                className={`lp-chip${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => setPlatforms(on ? platforms.filter((p) => p !== id) : [...platforms, id])}
              >
                {on ? <Check size={14} /> : <X size={14} className="lp-chip-x" />} {label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label>
        <span>
          Como conheceu o Resenha? <span className="lp-muted">(opcional)</span>
        </span>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Escolha…</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="amigo">Um amigo me indicou</option>
          <option value="outro">Outro</option>
        </select>
      </label>
      <input className="lp-hp" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden="true" name="website" />
      <label className="lp-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
        <span>
          Quero receber o convite e novidades do Resenha nesse contato. Li a{' '}
          <a href="/privacidade" target="_blank" rel="noopener">
            Política de Privacidade
          </a>
          .
        </span>
      </label>
      {error && <p className="lp-error">{error}</p>}
      <button className="lp-btn primary block" disabled={busy || !consent || platforms.length === 0}>
        {busy ? 'Enviando…' : 'Quero meu convite'}
      </button>
    </form>
  );
}
