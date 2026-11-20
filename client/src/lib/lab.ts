/**
 * Laboratório: mudanças em teste que NÃO vão para os usuários. Cada uma só liga neste aparelho, pelo
 * Painel da equipe → Saúde → Laboratório (ou nos testes automáticos). Desligado = o Resenha de sempre.
 *  - 'fps': transmissão com FPS mais fixo (camadas temporais e bitrate constante na transmissão turbo)
 */
export type LabFlag = 'fps';
const KEY = 'resenha.lab';

function read(): LabFlag[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export const labOn = (f: LabFlag) => read().includes(f);
export function setLab(f: LabFlag, on: boolean) {
  const cur = new Set(read());
  if (on) cur.add(f);
  else cur.delete(f);
  try {
    localStorage.setItem(KEY, JSON.stringify([...cur]));
  } catch {
    /* sem armazenamento */
  }
}
