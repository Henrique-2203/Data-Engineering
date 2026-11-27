import type { CallChatMessage } from '../../../shared/types';
import { getSocket, onSocketReady } from '../lib/socket';
import { useVoice } from '../store/voice';

/**
 * Chat privado da call: só quem está na call vê. As mensagens ficam só na memória do servidor
 * enquanto a call durar (não vão para o banco) e somem quando todo mundo sai.
 */
export const callChat = {
  send(content: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const s = getSocket();
      if (!s) return resolve({ ok: false, error: 'Sem conexão.' });
      s.timeout(8000).emit('callchat:send', { content }, (err: unknown, r: { ok: boolean; error?: string }) =>
        resolve(err ? { ok: false, error: 'Sem resposta do servidor. Tente de novo.' } : r),
      );
    });
  },
  remove(id: string) {
    getSocket()?.emit('callchat:delete', { id });
  },
  /** ao entrar na call: pega o que já foi conversado nela */
  sync() {
    getSocket()?.emit('callchat:get', {}, (r: { channelId: string | null; messages: CallChatMessage[] }) => {
      if (!r || r.channelId !== useVoice.getState().channelId) return;
      useVoice.setState({ callChat: r.messages });
    });
  },
  clear: () => useVoice.setState({ callChat: [] }),
};

const bound = new WeakSet<object>();
onSocketReady((s) => {
  if (bound.has(s)) return;
  bound.add(s);
  s.on('callchat:message', ({ channelId, message }: { channelId: string; message: CallChatMessage }) => {
    if (useVoice.getState().channelId !== channelId) return;
    useVoice.setState((st) => (st.callChat.some((m) => m.id === message.id) ? st : { callChat: [...st.callChat, message].slice(-200) }));
  });
  s.on('callchat:delete', ({ channelId, id }: { channelId: string; id: string }) => {
    if (useVoice.getState().channelId !== channelId) return;
    useVoice.setState((st) => ({ callChat: st.callChat.filter((m) => m.id !== id) }));
  });
});
