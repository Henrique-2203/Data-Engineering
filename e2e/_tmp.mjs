// Pasta temporária para os testes (banco, e-mails, perfis) que é APAGADA quando o teste termina,
// mesmo se ele falhar. Antes cada execução deixava uma pasta em /tmp e o disco enchia.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dirs = [];
let hooked = false;
function cleanup() {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* já apagada */
    }
  }
}

export function tempDir(prefix = 'resenha-') {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  if (!hooked) {
    hooked = true;
    process.on('exit', cleanup);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
  }
  return d;
}
