'use strict';
/**
 * "Som do computador" da transmissão SEM o próprio Resenha (sem a voz da call voltando para quem
 * assiste). Roda o programa nativo resenha-sysaudio.exe (desktop/native/sysaudio.cpp), que usa a
 * captura de áudio de aplicativo do Windows excluindo o processo do Resenha e todos os filhos dele,
 * e repassa o áudio (PCM 16 bits, 48 kHz, estéreo) para a página, que monta a faixa da transmissão.
 * Sem o programa ou num Windows antigo (antes do 10 versão 2004), start() devolve false e o app usa
 * a captura antiga do som do sistema.
 */
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

/** caminho do programa: empacotado em resources/native; nos testes, RESENHA_SYSAUDIO_HELPER */
function helperCommand() {
  const fake = process.env.RESENHA_SYSAUDIO_HELPER; // testes: "node caminho/do/falso.js"
  if (fake) {
    const [cmd, ...args] = fake.split('|');
    return { cmd, args };
  }
  if (process.platform !== 'win32') return null;
  const exe = path.join(process.resourcesPath || '', 'native', 'resenha-sysaudio.exe');
  return existsSync(exe) ? { cmd: exe, args: [] } : null;
}

let proc = null;
let lastError = null;

/**
 * Começa a capturar e manda os pedaços de áudio para `send(chunk)`. Espera a confirmação ("ready")
 * do programa por até 3 s. Devolve true se começou.
 */
function start(send) {
  stop();
  const h = helperCommand();
  if (!h) {
    lastError = 'sem o programa de áudio';
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, why) => {
      if (settled) return;
      settled = true;
      if (!ok) {
        lastError = why;
        console.warn('[som do pc]', why);
        stop();
      }
      resolve(ok);
    };
    let child;
    try {
      child = spawn(h.cmd, [...h.args, String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return done(false, err.message);
    }
    proc = child;
    let errText = '';
    child.stderr.on('data', (d) => {
      errText += String(d);
      if (/^ready/m.test(errText)) done(true);
      const m = /^error (.+)$/m.exec(errText);
      if (m) done(false, m[1].trim());
    });
    child.stdout.on('data', (chunk) => {
      if (proc === child) send(chunk);
    });
    child.on('error', (err) => done(false, err.message));
    child.on('exit', (code) => {
      if (proc === child) proc = null;
      done(false, `terminou (código ${code})`);
    });
    setTimeout(() => done(false, 'o programa de áudio não respondeu'), 3000);
  });
}

function stop() {
  const p = proc;
  proc = null;
  if (!p) return;
  try {
    p.stdin.end(); // o programa termina sozinho quando o stdin fecha
  } catch {
    /* já fechou */
  }
  setTimeout(() => {
    try {
      p.kill();
    } catch {
      /* já terminou */
    }
  }, 1500);
}

const active = () => !!proc;
const status = () => ({ active: active(), lastError });

module.exports = { start, stop, active, status };
