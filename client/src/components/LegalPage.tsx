import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

export const SOURCE_URL = 'https://github.com/Henrique-2203/Data-Engineering';
const UPDATED = '9 de novembro de 2026';

/** Páginas públicas /privacidade e /termos (abrem logado ou não). */
export function LegalPage({ kind }: { kind: 'privacidade' | 'termos' }) {
  const [contact, setContact] = useState<string | null>(null);
  useEffect(() => {
    document.title = kind === 'privacidade' ? 'Privacidade · Resenha' : 'Termos de uso · Resenha';
    api<{ privacyContact: string | null }>('/config').then((c) => setContact(c.privacyContact), () => {});
  }, [kind]);
  const contactLine = contact ? (
    <>
      pelo e-mail <a href={`mailto:${contact}`}>{contact}</a>
    </>
  ) : (
    'pelos canais oficiais do Resenha'
  );

  return (
    <div className="legal">
      <header className="legal-head">
        <a href="/" className="legal-back">
          <ArrowLeft size={18} /> Voltar ao Resenha
        </a>
        <nav>
          <a href="/privacidade" aria-current={kind === 'privacidade' ? 'page' : undefined}>
            Privacidade
          </a>
          <a href="/termos" aria-current={kind === 'termos' ? 'page' : undefined}>
            Termos de uso
          </a>
        </nav>
      </header>
      <article className="legal-body">{kind === 'privacidade' ? <Privacy contact={contactLine} /> : <Terms contact={contactLine} />}</article>
    </div>
  );
}

function Summary({ items }: { items: [string, string][] }) {
  return (
    <ul className="legal-summary">
      {items.map(([icon, text]) => (
        <li key={text}>
          <span>{icon}</span> {text}
        </li>
      ))}
    </ul>
  );
}

function Privacy({ contact }: { contact: ReactNode }) {
  return (
    <>
      <h1>
        <ShieldCheck size={30} /> Política de Privacidade
      </h1>
      <p className="muted">Atualizada em {UPDATED}</p>

      <h2>Resumo em 30 segundos</h2>
      <Summary
        items={[
          ['🚫', 'Não vendemos, não alugamos e não compartilhamos seus dados para propaganda. Não tem anúncio no Resenha.'],
          ['🙈', 'Não usamos rastreadores, cookies de propaganda nem ferramentas de análise de terceiros.'],
          ['🔐', 'Sua senha é guardada embaralhada (hash scrypt): nem nós conseguimos ver qual é.'],
          ['📞', 'Chamadas de voz, vídeo e tela vão direto entre os participantes, criptografadas, e não são gravadas.'],
          ['📦', 'Você pode baixar todos os seus dados e excluir sua conta quando quiser, nas Configurações.'],
          ['👀', 'O código do Resenha é público: qualquer pessoa pode conferir o que ele faz.'],
        ]}
      />

      <h2>1. Quem cuida dos seus dados</h2>
      <p>
        O Resenha é um projeto independente feito no Brasil. Quem o mantém é o controlador dos dados, nos termos da Lei Geral de Proteção de
        Dados (LGPD, Lei 13.709/2018). Fale com a gente sobre privacidade {contact}.
      </p>

      <h2>2. O que guardamos e por quê</h2>
      <table className="legal-table">
        <thead>
          <tr>
            <th>Dado</th>
            <th>Para quê</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Nome de usuário, nome de exibição e senha (embaralhada)</td>
            <td>Criar e proteger sua conta</td>
          </tr>
          <tr>
            <td>Perfil que você escolher preencher: foto, banner, bio, pronomes, links, status</td>
            <td>Mostrar seu perfil para quem divide servidor, amizade ou conversa com você</td>
          </tr>
          <tr>
            <td>Mensagens, imagens, reações, emojis, figurinhas e sons que você envia</td>
            <td>Entregar e mostrar para as pessoas da conversa ou do servidor</td>
          </tr>
          <tr>
            <td>Servidores, cargos, amizades e conversas de que você participa</td>
            <td>Fazer o app funcionar</td>
          </tr>
          <tr>
            <td>Aparelhos conectados: tipo de aparelho/navegador (ex.: "Chrome no Windows") e último acesso</td>
            <td>Mostrar onde sua conta está aberta e deixar você encerrar sessões</td>
          </tr>
          <tr>
            <td>Lista de espera (só se você se inscrever na página inicial): nome, e-mail, WhatsApp opcional, plataformas e como conheceu</td>
            <td>Mandar o seu convite e avisar das novidades do Resenha (com o seu consentimento)</td>
          </tr>
          <tr>
            <td>Denúncias que você envia ou recebe: motivo, detalhes e uma cópia do conteúdo denunciado</td>
            <td>Analisar abusos e cumprir a lei. Quem é denunciado não sabe quem denunciou</td>
          </tr>
          <tr>
            <td>"Jogando agora" (só o nome do jogo, se você usa o app de desktop)</td>
            <td>Mostrar no seu perfil. Fica só na memória enquanto você está online e pode ser desligado</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>O que não guardamos:</strong> o conteúdo das chamadas (não gravamos voz, vídeo nem tela), sua lista de programas
        (o app de desktop só manda o nome do jogo reconhecido), sua localização, seus contatos do celular. Para criar a conta não pedimos CPF,
        telefone nem e-mail (só a lista de espera pede um contato, se você quiser entrar nela).
      </p>
      <p>
        <strong>Endereço IP:</strong> usamos o IP só por alguns minutos, na memória, para bloquear ataques (como alguém tentando adivinhar
        senhas). Ele não fica salvo no nosso banco de dados. O provedor de hospedagem pode registrar acessos em logs técnicos por um
        período curto, como qualquer site.
      </p>

      <h2>3. Segurança</h2>
      <ul>
        <li>Toda a comunicação com o site é criptografada (HTTPS/TLS).</li>
        <li>Senhas com hash scrypt e sal aleatório; sessões guardadas só como hash e encerradas após 60 dias sem uso.</li>
        <li>Verificação em duas etapas opcional (app autenticador) e códigos de recuperação.</li>
        <li>Proteção contra tentativas de senha em massa, spam e envio de arquivos disfarçados.</li>
        <li>
          Chamadas usam criptografia de ponta a ponta do próprio WebRTC (DTLS-SRTP). Quando a conexão direta não é possível (ex.: 4G), o
          áudio e o vídeo passam por um servidor de retransmissão (TURN) <em>ainda criptografados</em>: ele não consegue ouvir nem ver.
        </li>
        <li>
          <Lock size={14} /> Sendo transparentes: as <strong>mensagens de texto e imagens não têm criptografia de ponta a ponta</strong>. Elas
          viajam criptografadas e ficam guardadas no banco de dados do servidor (que também é criptografado pelo provedor), para que você
          veja o histórico em qualquer aparelho. Não lemos suas conversas. Só acessaríamos um conteúdo específico para cumprir ordem
          judicial ou analisar uma denúncia de abuso.
        </li>
        <li>Imagens enviadas ficam em endereços impossíveis de adivinhar, mas quem tiver o link de uma imagem consegue abri-la.</li>
      </ul>

      <h2>4. Com quem os dados ficam (operadores)</h2>
      <p>Para funcionar, o Resenha usa estes serviços, que só processam os dados para isso:</p>
      <ul>
        <li>
          <strong>Render</strong> (hospedagem do site, EUA) e <strong>Neon</strong> (banco de dados, EUA): guardam a conta e o conteúdo.
        </li>
        <li>
          <strong>Metered</strong> (servidor TURN): retransmite chamadas criptografadas quando não dá para conectar direto.
        </li>
        <li>
          <strong>GitHub</strong>: distribui o instalador e as atualizações do app de desktop.
        </li>
      </ul>
      <p>
        Como esses serviços ficam fora do Brasil, há transferência internacional de dados, feita com provedores que adotam padrões de
        segurança reconhecidos (art. 33 da LGPD). Fora isso, só entregamos dados se uma lei ou ordem judicial obrigar.
      </p>

      <h2>5. Por quanto tempo</h2>
      <ul>
        <li>Enquanto sua conta existir. Mensagem apagada sai do banco na hora.</li>
        <li>
          Ao excluir a conta, apagamos imediatamente seu perfil, suas mensagens, imagens, amizades e os servidores de que você é dono. Cópias
          de segurança automáticas do provedor do banco podem levar alguns dias para serem substituídas.
        </li>
        <li>Sessões sem uso por 60 dias são apagadas.</li>
        <li>Denúncias são apagadas 6 meses depois de analisadas (salvo se a lei exigir guardar por mais tempo).</li>
        <li>Contatos da lista de espera ficam até você pedir para sair ou até 12 meses depois do convite. Para sair, escreva para o nosso e-mail.</li>
      </ul>

      <h2>6. Seus direitos (LGPD, art. 18)</h2>
      <p>Você pode, a qualquer momento:</p>
      <ul>
        <li>
          <strong>Ver e baixar seus dados</strong>: Configurações → Segurança e privacidade → Baixar meus dados.
        </li>
        <li>
          <strong>Corrigir</strong>: edite seu perfil nas Configurações.
        </li>
        <li>
          <strong>Excluir</strong>: Configurações → Segurança e privacidade → Excluir minha conta.
        </li>
        <li>
          <strong>Tirar dúvidas, pedir informações ou reclamar</strong>: fale conosco {contact}. Você também pode procurar a Autoridade
          Nacional de Proteção de Dados (ANPD).
        </li>
      </ul>

      <h2>7. Idade mínima</h2>
      <p>
        O Resenha é para quem tem <strong>13 anos ou mais</strong>. Menores de 18 anos devem usar com o conhecimento e a autorização dos
        pais ou responsáveis.
      </p>

      <h2>8. Mudanças nesta política</h2>
      <p>Se mudarmos algo importante, avisaremos dentro do app antes de a mudança valer.</p>

      <p className="muted small">
        Código-fonte público:{' '}
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          {SOURCE_URL.replace('https://', '')}
        </a>
      </p>
    </>
  );
}

function Terms({ contact }: { contact: ReactNode }) {
  return (
    <>
      <h1>Termos de uso</h1>
      <p className="muted">Atualizados em {UPDATED}</p>

      <h2>Resumo</h2>
      <Summary
        items={[
          ['🎮', 'O Resenha é grátis, para conversar, jogar e se divertir com os amigos.'],
          ['🤝', 'Respeite as pessoas. Nada de conteúdo ilegal, ódio, assédio ou spam.'],
          ['🛡️', 'Quem cria um servidor cuida dele: cargos, regras e moderação.'],
          ['⚠️', 'Conteúdo ilegal é removido e a conta pode ser encerrada.'],
        ]}
      />

      <h2>1. Aceitação</h2>
      <p>
        Ao criar uma conta ou usar o Resenha, você concorda com estes termos e com a <a href="/privacidade">Política de Privacidade</a>. É
        preciso ter 13 anos ou mais; menores de 18 anos precisam da autorização dos responsáveis.
      </p>

      <h2>2. Sua conta</h2>
      <ul>
        <li>Você é responsável pelo que acontece na sua conta. Use uma senha forte e só sua; recomendamos ativar a verificação em duas etapas.</li>
        <li>Guarde seus códigos de recuperação: sem e-mail cadastrado, eles são o único jeito de recuperar a conta se você esquecer a senha.</li>
        <li>Não se passe por outra pessoa nem crie contas para burlar uma suspensão.</li>
      </ul>

      <h2>3. O que não é permitido</h2>
      <ul>
        <li>Qualquer conteúdo envolvendo abuso ou exploração de crianças e adolescentes (tolerância zero; denunciamos às autoridades).</li>
        <li>Ameaças, assédio, discurso de ódio, discriminação ou incentivo à violência.</li>
        <li>Golpes, phishing, vírus, spam, ou tentar invadir o Resenha ou contas de outras pessoas.</li>
        <li>Compartilhar dados pessoais de outras pessoas sem autorização (doxxing) ou imagens íntimas sem consentimento.</li>
        <li>Pirataria e conteúdo que viole direitos autorais, incluindo burlar proteções de serviços de streaming.</li>
        <li>Qualquer coisa proibida pela lei brasileira.</li>
      </ul>

      <h2>4. Seu conteúdo</h2>
      <p>
        O que você envia continua sendo seu. Você nos dá apenas a permissão necessária para guardar e mostrar esse conteúdo para as pessoas
        com quem você escolheu compartilhar. Você pode apagar suas mensagens e sua conta quando quiser.
      </p>

      <h2>5. Servidores e moderação</h2>
      <p>
        Quem cria um servidor define as regras dele e pode moderar (castigar, expulsar, banir) dentro das permissões do Resenha. Podemos
        remover conteúdo ou encerrar contas e servidores que violem estes termos ou a lei, e cumprir ordens judiciais, como prevê o Marco
        Civil da Internet (Lei 12.965/2014).
      </p>

      <h2>6. Denúncias</h2>
      <p>
        Viu algo que viola estes termos? Use o botão <strong>Denunciar</strong> (🚩) na mensagem, no perfil ou no menu do servidor. A
        equipe do Resenha analisa, e quem foi denunciado não sabe quem denunciou. Conteúdo envolvendo abuso de menores é removido e
        comunicado às autoridades. Se alguém corre risco de vida, ligue para o <strong>CVV (188)</strong> ou, em emergência, 190 ou 192.
      </p>

      <h2>7. O serviço</h2>
      <ul>
        <li>O Resenha é oferecido de graça e "como está". Fazemos o possível para ele funcionar bem, mas pode haver instabilidade e manutenção.</li>
        <li>Recursos podem mudar com o tempo. Mudanças importantes nestes termos serão avisadas no app.</li>
        <li>Você pode parar de usar quando quiser e excluir sua conta nas Configurações.</li>
      </ul>

      <h2>8. Contato e lei aplicável</h2>
      <p>
        Dúvidas, denúncias ou pedidos: fale conosco {contact}. Estes termos seguem as leis do Brasil, incluindo o Código de Defesa do
        Consumidor quando aplicável.
      </p>
    </>
  );
}
