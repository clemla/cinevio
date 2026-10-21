'use strict';

/**
 * Lien public Cloudflare (https) vers l'addon, pour l'utiliser ailleurs que sur ce PC :
 * téléphone, télé, hors de chez soi.
 *
 *   CLOUDFLARE_TUNNEL=1                 tunnel rapide, sans compte : adresse *.trycloudflare.com,
 *                                       nouvelle à chaque lancement
 *   CLOUDFLARE_TUNNEL_TOKEN=<jeton>     tunnel nommé de ton compte Cloudflare : adresse fixe
 *   + PUBLIC_URL=https://addon.mondomaine.fr   (le nom d'hôte configuré pour ce tunnel)
 *   CLOUDFLARED_PATH=<chemin>           cloudflared déjà installé ailleurs
 *
 * cloudflared est cherché dans bin/, puis dans le PATH. S'il manque, il est téléchargé une fois
 * depuis les versions officielles de Cloudflare sur GitHub (Windows et Linux).
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const QUICK_RE = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i;
const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';

const status = { mode: 'off', state: 'off', url: '', error: '', since: 0 };
let child = null;
let stopping = false;
let retryDelay = 10000;

function mode() {
  if (process.env.CLOUDFLARE_TUNNEL_TOKEN) return 'named';
  if (/^(1|true|oui|yes|on)$/i.test(process.env.CLOUDFLARE_TUNNEL || '')) return 'quick';
  return 'off';
}

function set(fields) {
  Object.assign(status, fields, { since: Date.now() });
}

/** Nom du fichier à télécharger pour ce système, ou null (macOS : brew install cloudflared). */
function assetName() {
  const arch = process.arch;
  if (process.platform === 'win32') return arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe';
  if (process.platform === 'linux') return arch === 'arm64' ? 'cloudflared-linux-arm64' : arch === 'arm' ? 'cloudflared-linux-arm' : 'cloudflared-linux-amd64';
  return null;
}

const localBin = () => path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

function works(bin) {
  try {
    const r = spawnSync(bin, ['--version'], { timeout: 10000, windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

async function download(dest) {
  const name = assetName();
  if (!name) throw new Error("installe cloudflared (macOS : « brew install cloudflared ») puis relance");
  set({ state: 'downloading' });
  console.log('[cloudflare] Téléchargement de cloudflared (une seule fois, quelques dizaines de Mo)…');
  const res = await fetch(RELEASES + name, { redirect: 'follow' });
  if (!res.ok) throw new Error(`téléchargement de cloudflared impossible (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5e6) throw new Error('téléchargement de cloudflared incomplet');
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(dest + '.tmp', buf, { mode: 0o755 });
  fs.renameSync(dest + '.tmp', dest);
}

async function findBinary() {
  if (process.env.CLOUDFLARED_PATH) {
    if (works(process.env.CLOUDFLARED_PATH)) return process.env.CLOUDFLARED_PATH;
    throw new Error(`CLOUDFLARED_PATH ne fonctionne pas : ${process.env.CLOUDFLARED_PATH}`);
  }
  const local = localBin();
  if (fs.existsSync(local) && works(local)) return local;
  if (works('cloudflared')) return 'cloudflared';
  await download(local);
  if (!works(local)) throw new Error('cloudflared téléchargé mais ne démarre pas');
  return local;
}

function run(bin, port) {
  const m = mode();
  const args = m === 'named'
    ? ['tunnel', '--no-autoupdate', 'run', '--token', process.env.CLOUDFLARE_TUNNEL_TOKEN]
    : ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`];
  set({ state: 'starting', url: m === 'named' ? (process.env.PUBLIC_URL || '').replace(/\/$/, '') : '', error: '' });
  child = spawn(bin, args, { windowsHide: true });
  let lastLine = '';
  const onData = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      lastLine = line.replace(/^\S+\s+(INF|WRN|ERR)\s+/, '').trim();
      const quick = m === 'quick' && line.match(QUICK_RE);
      if (quick && quick[0] !== status.url) set({ state: 'starting', url: quick[0] });
      if (/Registered tunnel connection/i.test(line) && status.url && status.state !== 'ready') {
        set({ state: 'ready' });
        retryDelay = 10000;
        console.log(`\n  Lien Cloudflare : ${status.url}/configure`);
        if (m === 'quick') console.log('  (il change à chaque lancement : réinstalle l\'addon dans Nuvio avec le nouveau lien)\n');
      }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData); // cloudflared écrit son journal sur stderr
  child.on('error', (err) => set({ state: 'error', error: err.message }));
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    const why = lastLine || `arrêt (code ${code})`;
    set({ state: 'error', error: why });
    console.warn(`[cloudflare] Tunnel coupé : ${why}. Nouvel essai dans ${Math.round(retryDelay / 1000)} s.`);
    setTimeout(() => run(bin, port), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 5 * 60 * 1000);
  });
}

/** Lance le tunnel si .env le demande. Ne bloque jamais le serveur. */
async function start(port) {
  const m = mode();
  status.mode = m;
  if (m === 'off') return status;
  if (m === 'named' && !process.env.PUBLIC_URL) {
    set({ state: 'error', error: 'CLOUDFLARE_TUNNEL_TOKEN demande aussi PUBLIC_URL (l\'adresse du tunnel)' });
    console.warn(`[cloudflare] ${status.error}`);
    return status;
  }
  try {
    run(await findBinary(), port);
  } catch (err) {
    set({ state: 'error', error: err.message });
    console.warn(`[cloudflare] ${err.message}`);
  }
  return status;
}

function stop() {
  stopping = true;
  if (child) child.kill();
}
process.on('exit', stop); // les signaux (Ctrl+C, fermeture) passent par cache.js, qui appelle exit

module.exports = { start, stop, status, mode, QUICK_RE };
