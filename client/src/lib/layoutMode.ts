import { create } from 'zustand';
import { useApp } from '../store/app';

/**
 * Layout do app: 'classic' (o de sempre) ou 'novo' (abas no computador, barra de baixo no celular).
 * O novo só vale para contas com o recurso em teste 'layout2' liberado pela equipe (server/src/beta.ts);
 * a escolha fica guardada neste aparelho.
 */
export type LayoutChoice = 'classic' | 'novo';
const KEY = 'resenha.layout';
const read = (): LayoutChoice => {
  try {
    return localStorage.getItem(KEY) === 'novo' ? 'novo' : 'classic';
  } catch {
    return 'classic';
  }
};
export const useLayoutChoice = create<{ choice: LayoutChoice }>(() => ({ choice: read() }));
export function setLayoutChoice(choice: LayoutChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* sem armazenamento: vale até fechar */
  }
  useLayoutChoice.setState({ choice });
}
export const useHasFeature = (f: string) => useApp((s) => s.features.includes(f));
/** o layout novo está ligado agora (liberado para a conta E escolhido neste aparelho) */
export function useNovoLayout() {
  const allowed = useHasFeature('layout2');
  const choice = useLayoutChoice((s) => s.choice);
  return allowed && choice === 'novo';
}

/** a tela é de computador (o layout novo muda bastante entre computador e celular) */
const DESKTOP = '(min-width: 901px)';
export const useIsDesktop = create<{ desktop: boolean }>(() => ({ desktop: typeof window === 'undefined' || window.matchMedia(DESKTOP).matches }));
if (typeof window !== 'undefined') {
  window.matchMedia(DESKTOP).addEventListener('change', (e) => useIsDesktop.setState({ desktop: e.matches }));
}
