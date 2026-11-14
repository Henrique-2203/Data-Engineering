'use strict';
/**
 * "Jogando agora": detecta jogos abertos comparando a lista de processos com jogos conhecidos.
 * Só o nome do jogo sai do computador (nada da lista de programas é enviado).
 */
const { execFile } = require('node:child_process');

/** processo (minúsculo, sem .exe) -> nome do jogo. A ordem define a prioridade. */
const KNOWN = {
  'valorant-win64-shipping': 'Valorant',
  // emuladores de Android (Wild Rift, Free Fire e outros jogos de celular no PC)
  'hd-player': 'BlueStacks',
  dnplayer: 'LDPlayer',
  mumuplayer: 'MuMu Player',
  'mumunxdevice': 'MuMu Player',
  memu: 'MEmu',
  nox: 'NoxPlayer',
  'league of legends': 'League of Legends',
  cs2: 'Counter-Strike 2',
  'fortniteclient-win64-shipping': 'Fortnite',
  gta5: 'GTA V',
  gta5_enhanced: 'GTA V',
  playgtav: 'GTA V',
  'minecraft.windows': 'Minecraft',
  minecraft: 'Minecraft',
  robloxplayerbeta: 'Roblox',
  rocketleague: 'Rocket League',
  dota2: 'Dota 2',
  r5apex: 'Apex Legends',
  r5apex_dx12: 'Apex Legends',
  overwatch: 'Overwatch 2',
  devour: 'Devour',
  phasmophobia: 'Phasmophobia',
  'lethal company': 'Lethal Company',
  rainbowsix: 'Rainbow Six Siege',
  rainbowsix_vulkan: 'Rainbow Six Siege',
  tslgame: 'PUBG',
  'among us': 'Among Us',
  terraria: 'Terraria',
  'stardew valley': 'Stardew Valley',
  eldenring: 'Elden Ring',
  rustclient: 'Rust',
  'deadbydaylight-win64-shipping': 'Dead by Daylight',
  'marvel-win64-shipping': 'Marvel Rivals',
  project8: 'Deadlock',
  fc25: 'EA SPORTS FC 25',
  fc26: 'EA SPORTS FC 26',
  'cod': 'Call of Duty',
  'cod24-cod': 'Call of Duty',
  'helldivers2': 'Helldivers 2',
  'sotgame': 'Sea of Thieves',
  'palworld-win64-shipping': 'Palworld',
  'repo': 'R.E.P.O.',
  'peak': 'PEAK',
  'thefinals': 'The Finals',
  'brawlhalla': 'Brawlhalla',
  'pathofexile_x64': 'Path of Exile',
  'pathofexile2': 'Path of Exile 2',
  'wow': 'World of Warcraft',
  'hollow_knight': 'Hollow Knight',
  'hollow knight silksong': 'Hollow Knight: Silksong',
  'cyberpunk2077': 'Cyberpunk 2077',
  'bg3': "Baldur's Gate 3",
  'bg3_dx11': "Baldur's Gate 3",
  'witcher3': 'The Witcher 3',
  'genshinimpact': 'Genshin Impact',
  'zenlesszonezero': 'Zenless Zone Zero',
  'starrail': 'Honkai: Star Rail',
  'warframe.x64': 'Warframe',
  'destiny2': 'Destiny 2',
  'forzahorizon5': 'Forza Horizon 5',
  'rdr2': 'Red Dead Redemption 2',
};

/** Jogos extras (para testes ou para quem quiser): RESENHA_EXTRA_GAMES="processo=Nome;outro=Outro Nome" */
function extraGames() {
  const out = {};
  for (const pair of (process.env.RESENHA_EXTRA_GAMES ?? '').split(';')) {
    const [proc, name] = pair.split('=');
    if (proc && name) out[proc.trim().toLowerCase()] = name.trim();
  }
  return out;
}

function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          stdout
            .split(/\r?\n/)
            .map((line) => (/^"([^"]+)"/.exec(line)?.[1] ?? '').toLowerCase().replace(/\.exe$/, ''))
            .filter(Boolean),
        );
      });
    } else {
      execFile('ps', ['-A', '-o', 'comm='], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split('\n').map((l) => l.trim().split('/').pop().toLowerCase()).filter(Boolean));
      });
    }
  });
}

async function detectGame() {
  const running = new Set(await listProcesses());
  const games = { ...extraGames(), ...KNOWN };
  for (const [proc, name] of Object.entries(games)) {
    if (name && running.has(proc)) return name;
  }
  return null;
}

/** Observa os jogos abertos e chama onChange(nome | null) quando muda. */
function watchGames(onChange, intervalMs = 15_000) {
  let current = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const game = await detectGame().catch(() => null);
    if (game !== current) {
      current = game;
      onChange(game);
    }
  };
  void tick();
  const t = setInterval(tick, intervalMs);
  return {
    current: () => current,
    stop() {
      stopped = true;
      clearInterval(t);
    },
  };
}

module.exports = { watchGames, detectGame };
