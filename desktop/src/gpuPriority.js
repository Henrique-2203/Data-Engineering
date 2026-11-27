'use strict';
/**
 * Prioridade na placa de vídeo (Windows), o mesmo truque do OBS: com um jogo usando 100% da placa,
 * a captura da tela e a codificação da transmissão ficam esperando na fila da GPU e o FPS da
 * transmissão despenca. Marcando os processos do Resenha como prioridade ALTA no agendador da GPU
 * (D3DKMTSetProcessSchedulingPriorityClass), a transmissão é atendida primeiro — ela usa pouquíssimo
 * da placa, então o jogo praticamente não sente.
 */
let api = null;

function load() {
  if (process.platform !== 'win32') return null;
  if (api !== null) return api || null;
  try {
    const koffi = require('koffi');
    const gdi32 = koffi.load('gdi32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    api = {
      setGpu: gdi32.func('int __stdcall D3DKMTSetProcessSchedulingPriorityClass(void *hProcess, int priority)'),
      open: kernel32.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
      close: kernel32.func('int __stdcall CloseHandle(void *h)'),
    };
  } catch (err) {
    console.warn('[gpu] prioridade de placa de vídeo indisponível', err);
    api = false;
  }
  return api || null;
}

// D3DKMT_SCHEDULINGPRIORITYCLASS: 2 = normal, 4 = alta (5 = tempo real exige administrador)
const LEVEL = { normal: 2, high: 4 };
const PROCESS_SET_INFORMATION = 0x0200;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

/** Muda a prioridade de GPU de um processo. Retorna true se deu certo (nunca lança erro). */
function setGpuPriority(pid, level) {
  const a = load();
  if (!a) return false;
  try {
    const h = a.open(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (!h) return false;
    try {
      return a.setGpu(h, LEVEL[level] ?? LEVEL.normal) === 0;
    } finally {
      a.close(h);
    }
  } catch {
    return false;
  }
}

module.exports = { setGpuPriority, gpuPrioritySupported: () => !!load() };
