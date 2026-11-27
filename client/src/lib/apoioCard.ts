const CALLS_KEY = 'resenha.callsJoined';

/** calls de que a pessoa participou neste aparelho (só serve para decidir se o card de apoio pode aparecer) */
export function countCallJoined() {
  try {
    localStorage.setItem(CALLS_KEY, String((Number(localStorage.getItem(CALLS_KEY)) || 0) + 1));
  } catch {}
}

export function callsJoined() {
  try {
    return Number(localStorage.getItem(CALLS_KEY)) || 0;
  } catch {
    return 0;
  }
}
