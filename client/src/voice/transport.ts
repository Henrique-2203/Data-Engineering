/**
 * Transporte da tela de cada espectador: turbo (WebCodecs + canal de dados) ou WebRTC convencional.
 * Tipos e estados usados no diagnóstico. Nada aqui carrega IP, token, mensagem, áudio ou imagem.
 */

/** habilitado = turbo disponível, ainda sem canal · negociando = canal sendo aberto · ativo = mandando por ele ·
 *  recuperando = o canal caiu sem querer e estamos refazendo · fallback = indo pelo WebRTC (com motivo) */
export type TransportState = 'enabled' | 'negotiating' | 'active' | 'recovering' | 'fallback';
export type TransportMode = 'turbo' | 'webrtc' | 'sfu' | 'none';

export interface TransportInfo {
  state: TransportState;
  mode: TransportMode;
  /** motivo do fallback / da recuperação (texto curto, sem dados pessoais) */
  reason?: string;
  codec?: string;
  /** desde quando está neste estado (ms desde a época) */
  since: number;
}

export interface TransportEvent {
  at: number;
  ev: string;
  /** 6 primeiros caracteres do id da conexão (não identifica a pessoa) */
  peer: string | null;
  detail?: Record<string, string | number | boolean | null>;
}

export const FALLBACK_TEXT: Record<string, string> = {
  'sender-disabled': 'o turbo está desligado nas configurações de quem transmite',
  'sender-unsupported': 'o navegador de quem transmite não tem as APIs do turbo',
  'sender-unavailable': 'o turbo de quem transmite não foi iniciado',
  'viewer-disabled': 'o turbo está desligado nas configurações de quem assiste',
  'viewer-unsupported': 'o navegador de quem assiste não decodifica o turbo',
  'viewer-unstable': 'o canal turbo caiu 3 vezes em 2 minutos (quem assiste pediu a transmissão normal)',
  'viewer-no-decoders': 'quem assiste não informou codecs compatíveis',
  'turn-saver': 'conexão via TURN com a economia ligada',
  'no-common-codec': 'nenhum codec em comum entre quem transmite e quem assiste',
  'encoder-unsupported': 'o codificador não aceitou nenhuma configuração neste aparelho',
  'codec-mismatch': 'quem assiste não decodifica o codec que já está em uso',
  'channel-timeout': 'o canal turbo não abriu em 10 s',
  'channel-error': 'erro no canal turbo',
  'channel-closed': 'o canal turbo fechou antes de começar',
  'channel-create-failed': 'não foi possível criar o canal turbo',
  'recovery-timeout': 'quem assiste não pediu o turbo de volta em 20 s',
  stopped: 'a transmissão parou',
};
