import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

export const SOURCE_URL = 'https://github.com/Henrique-2203/Data-Engineering';
const UPDATED = '9 de novembro de 2026';

/** Páginas públicas /privacidade, /termos e /seguranca (abrem logado ou não). */
export function LegalPage({ kind }: { kind: 'privacidade' | 'termos' | 'seguranca' }) {
  const [contact, setContact] = useState<string | null>(null);
  useEffect(() => {
    document.title = kind === 'privacidade' ? 'Privacidade · Resenha' : kind === 'seguranca' ? 'Segurança · Resenha' : 'Termos de uso · Resenha';
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
          <a href="/seguranca" aria-current={kind === 'seguranca' ? 'page' : undefined}>
            Segurança
          </a>
        </nav>
      </header>
      <article className="legal-body">
        {kind === 'privacidade' ? <Privacy contact={contactLine} /> : kind === 'seguranca' ? <Security contact={contactLine} /> : <Terms contact={contactLine} />}
      </article>
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
            <td>Mensagens, fotos, vídeos, arquivos, reações, emojis, figurinhas e sons que você envia</td>
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
            <td>E-mail (opcional, só se você adicionar em Configurações → Segurança)</td>
            <td>Avisar de acessos novos e mudanças de segurança e enviar o código para criar uma senha nova. Nunca para propaganda</td>
          </tr>
          <tr>
            <td>Histórico de segurança: entradas na conta, trocas de senha, 2FA e e-mail, com o tipo de aparelho e a data (180 dias)</td>
            <td>Mostrar para você o que aconteceu na sua conta e detectar acessos suspeitos</td>
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
        telefone nem e-mail (o e-mail é opcional, para segurança; a lista de espera pede um contato se você quiser entrar nela).
      </p>
      <p>
        <strong>Cookies:</strong> usamos um único cookie, essencial, que mantém você conectado. Ele é protegido (HttpOnly e Secure): nem
        scripts da página conseguem lê-lo, e outros sites não conseguem usá-lo. Não usamos cookies de propaganda nem de rastreamento.
      </p>
      <p>
        <strong>Estatísticas sem rastreador:</strong> contamos só totais por dia (quantas visitas a página inicial teve e de onde vieram,
        quantas mensagens e chamadas aconteceram), sem cookies e sem identificar quem visitou. De cada conta guardamos apenas o último dia
        em que ela usou o Resenha, para saber quantas pessoas estão ativas.
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
        <li>Proteção contra tentativas de senha em massa, spam e envio de arquivos disfarçados; verificação anti-robô quando algo parece suspeito.</li>
        <li>Senhas que já apareceram em vazamentos de outros sites são recusadas, e avisamos se a sua aparecer em um vazamento novo.</li>
        <li>
          Alertas por e-mail de acesso em aparelho novo e de mudanças de segurança. Os e-mails do Resenha nunca pedem sua senha nem têm link
          para entrar.
        </li>
        <li>
          Para criar uma senha nova pelo e-mail, quem tem verificação em duas etapas precisa também do código do app: só o e-mail não basta
          para tomar a conta.
        </li>
        <li>
          Chamadas usam criptografia de ponta a ponta do próprio WebRTC (DTLS-SRTP). Quando a conexão direta não é possível (ex.: 4G), o
          áudio e o vídeo passam por um servidor de retransmissão (TURN) <em>ainda criptografados</em>: ele não consegue ouvir nem ver.
        </li>
        <li>
          <Lock size={14} /> Sendo transparentes: as <strong>mensagens e arquivos não têm criptografia de ponta a ponta</strong>. Eles
          viajam criptografados e ficam guardados no servidor (criptografados em disco pelos provedores), para que você
          veja o histórico em qualquer aparelho. Não lemos suas conversas. Só acessaríamos um conteúdo específico para cumprir ordem
          judicial ou analisar uma denúncia de abuso.
        </li>
        <li>
          Fotos e vídeos perdem a <strong>localização (GPS)</strong>, o modelo do celular e outros dados escondidos antes de serem guardados.
        </li>
        <li>
          Arquivos só abrem por <strong>links protegidos que expiram</strong> em até 24 horas e só são entregues a quem está na conversa.
          Programas e scripts (.exe, .bat, .apk...) não podem ser enviados.
        </li>
        <li>Backups diários do banco de dados, criptografados (AES-256) e conferidos depois de feitos.</li>
      </ul>

      <h2>4. Com quem os dados ficam (operadores)</h2>
      <p>Para funcionar, o Resenha usa estes serviços, que só processam os dados para isso:</p>
      <ul>
        <li>
          <strong>Render</strong> (hospedagem do site, EUA) e <strong>Neon</strong> (banco de dados, EUA): guardam a conta e o conteúdo.
        </li>
        <li>
          <strong>Cloudflare R2</strong> (armazenamento de arquivos): guarda fotos, vídeos, arquivos e os backups criptografados.
        </li>
        <li>
          <strong>Cloudflare Turnstile</strong> (verificação anti-robô): analisa sinais técnicos do navegador no cadastro e em tentativas
          suspeitas de login, sem "clique nos semáforos".
        </li>
        <li>
          <strong>Brevo</strong> (envio de e-mails): entrega os e-mails de segurança para quem adicionou um e-mail.
        </li>
        <li>
          <strong>Have I Been Pwned</strong> (senhas vazadas): recebe só os 5 primeiros caracteres de um código gerado a partir da senha,
          nunca a senha em si, para saber se ela já apareceu em vazamentos de outros sites.
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
          Ao excluir a conta, apagamos imediatamente seu perfil, suas mensagens, arquivos, amizades e os servidores de que você é dono. Os
          arquivos saem do armazenamento em poucos minutos. Os backups criptografados são substituídos em até 30 dias.
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

/** /seguranca: como o Resenha protege contas, conversas e chamadas, em linguagem simples. */
function Security({ contact }: { contact: ReactNode }) {
  return (
    <>
      <h1>
        <Lock size={30} /> Segurança no Resenha
      </h1>
      <p className="muted">Atualizada em {UPDATED}</p>
      <p>
        Esta página explica, sem enrolação, o que fazemos para proteger você. O código do Resenha é público, então qualquer pessoa pode conferir
        que é isso mesmo que acontece: <a href={SOURCE_URL}>{SOURCE_URL.replace('https://', '')}</a>.
      </p>

      <h2>Resumo</h2>
      <Summary
        items={[
          ['🔐', 'Senha guardada embaralhada (scrypt), recusamos senhas que já vazaram e você pode ativar a verificação em duas etapas.'],
          ['📞', 'Chamadas de voz, câmera e tela criptografadas de ponta a ponta, com código de segurança para conferir. Nada é gravado.'],
          ['🛡️', 'Login guardado num cookie que nenhum script da página consegue ler, e proteção contra ações vindas de outros sites.'],
          ['📍', 'Fotos e vídeos perdem a localização (GPS) e outros dados escondidos antes de serem guardados.'],
          ['🔗', 'Arquivos só abrem por links que expiram, entregues a quem está na conversa. Programas (.exe, .apk...) são bloqueados.'],
          ['💾', 'Backup diário do banco, criptografado e testado depois de feito.'],
        ]}
      />

      <h2>1. Sua conta</h2>
      <ul>
        <li>
          <strong>Senha:</strong> guardada só como um "hash" scrypt com sal aleatório. Nem a equipe consegue ver qual é. Senhas fracas, comuns
          ou que já apareceram em vazamentos de outros sites (consultamos o Have I Been Pwned sem enviar a sua senha) são recusadas.
        </li>
        <li>
          <strong>Verificação em duas etapas</strong> com app autenticador (Google Authenticator, Authy...) e códigos de recuperação. Quem tem
          o 2FA ligado precisa dele até para trocar a senha pelo e-mail.
        </li>
        <li>
          <strong>Alertas por e-mail</strong> quando alguém entra de um aparelho novo, a senha é trocada ou o 2FA é desligado. Nossos e-mails
          nunca pedem sua senha nem têm link para entrar.
        </li>
        <li>
          <strong>Contra robôs e tentativas em massa:</strong> limites por conta e por endereço, captcha invisível depois de erros e bloqueio
          temporário após várias senhas erradas.
        </li>
        <li>
          <strong>Você no controle:</strong> em Configurações → Segurança há o checkup, a lista de aparelhos conectados (com "sair de todos"),
          o histórico de segurança dos últimos 180 dias, a cópia dos seus dados e a exclusão da conta.
        </li>
      </ul>

      <h2>2. Conversas e arquivos</h2>
      <ul>
        <li>Tudo viaja criptografado (HTTPS/TLS) e fica guardado em servidores criptografados em disco pelos provedores.</li>
        <li>
          Fotos e vídeos perdem a <strong>localização (GPS)</strong>, o modelo do celular e outros metadados no nosso servidor, antes de
          serem guardados.
        </li>
        <li>
          Cada arquivo só abre por um <strong>link assinado que expira</strong> (12 a 24 horas), entregue só a quem está na conversa. Um link
          repassado para fora para de funcionar.
        </li>
        <li>
          O tipo do arquivo é conferido pelo conteúdo: <strong>programas e scripts são recusados</strong> mesmo renomeados, e páginas da web
          enviadas nunca rodam como parte do site.
        </li>
      </ul>

      <h2>3. Chamadas</h2>
      <ul>
        <li>
          Voz, câmera e transmissão de tela usam a criptografia de ponta a ponta do WebRTC (DTLS-SRTP) e vão direto entre os participantes.
          Não gravamos nada.
        </li>
        <li>
          Quando a conexão direta não é possível (ex.: 4G), o áudio e o vídeo passam por um servidor de retransmissão (TURN) <em>ainda
          criptografados</em>: ele só repassa, sem conseguir ouvir ou ver.
        </li>
        <li>
          <strong>Código de segurança:</strong> na chamada, toque em "🔒 Criptografada". Cada pessoa tem um código que é igual nos dois lados
          se ninguém estiver no meio. Se quiser ter certeza, compare em voz alta.
        </li>
      </ul>

      <h2>4. Servidores e moderação</h2>
      <ul>
        <li>Cargos e permissões são conferidos pelo servidor em cada ação, não só escondidos na tela.</li>
        <li>
          <strong>Registro de auditoria:</strong> quem administra vê quem baniu, expulsou, castigou ou mudou cargos e canais nos últimos 90 dias.
        </li>
        <li>Qualquer pessoa pode denunciar mensagens, perfis e servidores; a equipe analisa e quem foi denunciado não sabe quem denunciou.</li>
      </ul>

      <h2>5. Bastidores</h2>
      <ul>
        <li>Backup diário do banco de dados, criptografado com AES-256, guardado fora do servidor e aberto de volta para conferir.</li>
        <li>
          A cada mudança, verificações automáticas procuram bibliotecas com falhas conhecidas e erros de segurança no código (Dependabot e
          CodeQL do GitHub), além de testes automáticos do app inteiro.
        </li>
        <li>Sem anúncios, sem rastreadores e sem venda de dados. Veja a <a href="/privacidade">Política de Privacidade</a>.</li>
      </ul>

      <h2>6. O que ainda não fazemos (sendo honestos)</h2>
      <ul>
        <li>
          <strong>Mensagens de texto e arquivos não têm criptografia de ponta a ponta.</strong> Eles ficam guardados criptografados no
          servidor para você ver o histórico em qualquer aparelho. Não lemos suas conversas; só acessaríamos um conteúdo específico por ordem
          judicial ou para analisar uma denúncia.
        </li>
        <li>
          O instalador do app para Windows ainda não tem assinatura digital paga, então o Windows pode mostrar um aviso na primeira instalação.
          Baixe sempre pelo nosso site ou pela página oficial no GitHub.
        </li>
      </ul>

      <h2 id="reportar">7. Encontrou uma falha de segurança?</h2>
      <p>Obrigado por ajudar! Escreva {contact} com:</p>
      <ul>
        <li>o que você encontrou e como reproduzir;</li>
        <li>o impacto que imagina (o que alguém mal-intencionado conseguiria fazer).</li>
      </ul>
      <p>
        Respondemos em até 5 dias úteis e corrigimos o quanto antes. Pedimos que você não acesse, altere ou apague dados de outras pessoas,
        não atrapalhe o serviço e nos dê um tempo para corrigir antes de divulgar. Quem segue estas regras de boa-fé não será tratado como
        atacante. Também publicamos estas informações em <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
      </p>
    </>
  );
}
