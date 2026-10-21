'use strict';

/**
 * Chargement de pages avec le vrai navigateur installé (Chrome, Edge ou Chromium).
 *
 * Certains sites (FlixPatrol) sont derrière une vérification Cloudflare que le fetch de Node
 * ne passe pas, alors qu'un vrai navigateur la passe tout seul en quelques secondes.
 * On pilote donc Chrome/Edge par le protocole DevTools, via un « pipe » (aucune dépendance npm,
 * aucun port ouvert). Le profil est gardé dans data/browser-profile pour réutiliser le cookie
 * de vérification d'une fois sur l'autre.
 *
 * Variables d'environnement :
 *   BROWSER_PATH        chemin du navigateur (sinon détecté : Chrome, puis Edge, puis Chromium)
 *   BROWSER_HEADLESS    auto (défaut : invisible, puis fenêtre hors écran si la vérification échoue)
 *                       1 = toujours invisible, 0 = toujours en fenêtre (hors écran)
 *   BROWSER_VISIBLE     1 = fenêtre visible à l'écran (pour vérifier ce qui se passe)
 *   BROWSER_TIMEOUT     secondes max pour une page (défaut 40)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');
const PAGE_TIMEOUT = Number(process.env.BROWSER_TIMEOUT || 40) * 1000;
const IDLE_CLOSE_MS = 20000;
const HEADLESS_MODE = String(process.env.BROWSER_HEADLESS || 'auto').toLowerCase();

const CHALLENGE_RE = /Just a moment|Un instant|Attention Required|Checking your browser|Vérification|cf-chl|challenge-platform/i;

/** Emplacements habituels des navigateurs, par système. */
function candidates() {
  const list = [];
  if (process.env.BROWSER_PATH) list.push(process.env.BROWSER_PATH);
  if (process.platform === 'win32') {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    list.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(local, 'Chromium', 'Application', 'chrome.exe'),
      path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    );
  } else {
    for (const dir of (process.env.PATH || '').split(':')) {
      for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
        list.push(path.join(dir, name));
      }
    }
    list.push('/opt/pw-browsers/chromium');
  }
  return list;
}

let cachedExe;
function findBrowser() {
  if (cachedExe !== undefined) return cachedExe;
  cachedExe = null;
  for (const p of candidates()) {
    try {
      const st = fs.statSync(p);
      if (st.isFile()) { cachedExe = p; break; }
      // Dossier Playwright : /opt/pw-browsers/chromium-xxxx/chrome-linux/chrome
      if (st.isDirectory()) {
        const inner = path.join(p, 'chrome-linux', 'chrome');
        if (fs.existsSync(inner)) { cachedExe = inner; break; }
      }
    } catch { /* absent */ }
  }
  if (!cachedExe && process.platform === 'linux') {
    try {
      const base = '/opt/pw-browsers';
      const dir = fs.readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
      const inner = dir && path.join(base, dir, 'chrome-linux', 'chrome');
      if (inner && fs.existsSync(inner)) cachedExe = inner;
    } catch { /* absent */ }
  }
  return cachedExe;
}

function browserName(exe) {
  const b = path.basename(exe || '').toLowerCase();
  if (b.includes('msedge') || b.includes('edge')) return 'Edge';
  if (b.includes('brave')) return 'Brave';
  if (b.includes('chromium') || (exe || '').includes('pw-browsers')) return 'Chromium';
  return 'Chrome';
}

/* ------------------------------------------------------------------ */
/* Session DevTools sur pipe (fd 3 : vers le navigateur, fd 4 : retour) */
/* ------------------------------------------------------------------ */

class Browser {
  constructor(exe, headless, profileDir = PROFILE_DIR) {
    this.profileDir = profileDir;
    this.exe = exe;
    this.headless = headless;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.closed = false;
    this.stderr = '';
  }

  async start() {
    let profile = this.profileDir;
    try { fs.mkdirSync(profile, { recursive: true }); } catch { profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nfr-browser-')); }
    const args = [
      '--remote-debugging-pipe',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      '--mute-audio',
      '--lang=fr-FR',
      '--window-size=1280,900',
    ];
    if (this.headless) args.push('--headless=new');
    else args.push(process.env.BROWSER_VISIBLE === '1' ? '--window-position=80,80' : '--window-position=-32000,-32000');
    // Bac à sable de Chrome indisponible en root ou dans un conteneur Docker (BROWSER_NO_SANDBOX=1).
    const root = process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;
    if (root || process.env.BROWSER_NO_SANDBOX === '1') args.push('--no-sandbox', '--disable-dev-shm-usage');
    args.push('about:blank');

    this.proc = spawn(this.exe, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
    this.out = this.proc.stdio[3];
    this.in = this.proc.stdio[4];
    this.in.on('data', (chunk) => this.onData(chunk));
    const fail = (why) => {
      if (this.closed) return;
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error(why));
      this.pending.clear();
    };
    this.proc.on('exit', (code) => fail(`le navigateur s'est fermé (code ${code})${this.stderr ? ' : ' + this.stderr.trim().split('\n').pop() : ''}`));
    this.proc.on('error', (err) => fail(`lancement impossible : ${err.message}`));
    this.out.on('error', () => {});

    const version = await this.send('Browser.getVersion', {}, null, 15000);
    this.userAgent = String(version.userAgent || '').replace(/HeadlessChrome/g, 'Chrome');
    this.product = version.product;
    this.uaMetadata = uaMetadata(this.userAgent);
    return this;
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this.buffer.indexOf('\0')) >= 0) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      let msg;
      try { msg = JSON.parse(raw); } catch { continue; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'erreur DevTools'));
        else resolve(msg.result || {});
      }
    }
  }

  send(method, params = {}, sessionId = null, timeout = 15000) {
    if (this.closed) return Promise.reject(new Error('navigateur fermé'));
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools : pas de réponse à ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.out.write(JSON.stringify(msg) + '\0');
    });
  }

  async evaluate(sessionId, expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'erreur JS');
    return r.result ? r.result.value : undefined;
  }

  /**
   * Ouvre l'URL dans un onglet, attend la fin de la vérification anti-robots,
   * puis renvoie { html, title, url }.
   * ready(state) : condition supplémentaire sur l'état de la page (titre, nb de liens…).
   */
  async fetchPage(url, ready, timeoutMs = PAGE_TIMEOUT) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    try {
      if (this.headless && this.userAgent) {
        await this.send('Network.setUserAgentOverride', {
          userAgent: this.userAgent, acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8', platform: navigatorPlatform(),
          ...(this.uaMetadata ? { userAgentMetadata: this.uaMetadata } : {}),
        }, sessionId);
      }
      await this.send('Page.enable', {}, sessionId);
      await this.send('Page.navigate', { url }, sessionId, 30000);

      const deadline = Date.now() + timeoutMs;
      let state = null;
      let stableSince = 0;
      while (Date.now() < deadline) {
        await sleep(1000);
        state = await this.evaluate(sessionId, `({
          title: document.title,
          ready: document.readyState,
          challenge: !!(window._cf_chl_opt || document.querySelector('#challenge-form, #challenge-stage, [name="cf-turnstile-response"]')),
          links: document.querySelectorAll('a[href*="/title/"]').length,
          len: document.documentElement ? document.documentElement.outerHTML.length : 0
        })`).catch(() => null); // la page peut se recharger pendant la vérification
        if (!state) { stableSince = 0; continue; }
        // Le titre de la page de vérification suffit : la vraie page peut contenir des éléments
        // Cloudflare (formulaire de connexion…) et ne doit pas être prise pour la vérification.
        const titleOk = !CHALLENGE_RE.test(state.title || '');
        const content = ready ? ready(state) : !state.challenge;
        if (state.ready === 'complete' && titleOk && content) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= 800) break; // laisse finir le rendu
        } else stableSince = 0;
      }
      const html = await this.evaluate(sessionId, 'document.documentElement.outerHTML');
      const info = await this.evaluate(sessionId, '({ title: document.title, url: location.href })');
      const challenge = !stableSince;
      return { html: html || '', title: info.title, url: info.url, challenge, state };
    } finally {
      await this.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  /**
   * Dessine une page HTML et renvoie une image (Buffer JPEG).
   * La page peut définir window.__ready (promesse) : on l'attend avant la capture
   * (polices, images, ajustement des textes).
   */
  async renderImage(html, { width = 1280, height = 720, quality = 88, timeoutMs = 25000 } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    try {
      await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await this.send('Page.enable', {}, sessionId);
      const { frameTree } = await this.send('Page.getFrameTree', {}, sessionId);
      await this.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId, 20000);
      await this.send('Runtime.evaluate', {
        expression: `Promise.race([
          (async () => { await (window.__ready || Promise.resolve()); return true; })(),
          new Promise((r) => setTimeout(() => r(false), ${timeoutMs - 3000}))
        ])`,
        awaitPromise: true, returnByValue: true,
      }, sessionId, timeoutMs);
      const shot = await this.send('Page.captureScreenshot', {
        format: 'jpeg', quality, clip: { x: 0, y: 0, width, height, scale: 1 },
      }, sessionId, 20000);
      return Buffer.from(shot.data, 'base64');
    } finally {
      await this.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  /**
   * Capture une animation image par image : la page doit définir window.__setFrame(t), t de 0 à 1.
   * Renvoie des PNG (Buffer) à la taille width×scale.
   */
  async renderFrames(html, { width = 1280, height = 720, scale = 0.375, frames = 36, timeoutMs = 25000 } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    try {
      // La page est dessinée directement à la taille du GIF (facteur d'échelle de l'écran) : 7 fois
      // moins de pixels à peindre qu'en 1280×720 réduit après coup.
      await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
      await this.send('Page.enable', {}, sessionId);
      const { frameTree } = await this.send('Page.getFrameTree', {}, sessionId);
      await this.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId, 20000);
      await this.send('Runtime.evaluate', {
        expression: `Promise.race([(async () => { await (window.__ready || Promise.resolve()); return true; })(), new Promise((r) => setTimeout(() => r(false), ${timeoutMs - 3000}))])`,
        awaitPromise: true, returnByValue: true,
      }, sessionId, timeoutMs);
      const out = [];
      for (let i = 0; i < frames; i++) {
        // Pas besoin d'attendre une image : la capture en dessine une nouvelle avec l'état à jour.
        await this.send('Runtime.evaluate', {
          expression: `if (window.__setFrame) window.__setFrame(${i / frames}); 0`,
        }, sessionId, 10000);
        const shot = await this.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false }, sessionId, 20000);
        out.push(Buffer.from(shot.data, 'base64'));
      }
      return out;
    } finally {
      await this.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  async close() {
    if (this.closed) return;
    try { await this.send('Browser.close', {}, null, 5000); } catch { /* déjà fermé */ }
    this.closed = true;
    setTimeout(() => { try { this.proc.kill(); } catch { /* fini */ } }, 3000).unref();
  }
}

/** Client hints cohérents avec le user-agent (sinon le mode invisible les laisse vides). */
function uaMetadata(ua) {
  const chrome = /Chrome\/(\d+)\.([\d.]+)/.exec(ua);
  if (!chrome) return null;
  const major = chrome[1];
  const full = `${major}.${chrome[2]}`;
  const edge = /Edg\/(\d+)\.([\d.]+)/.exec(ua);
  const brand = edge ? 'Microsoft Edge' : /Brave/.test(ua) ? 'Brave' : 'Google Chrome';
  const brandMajor = edge ? edge[1] : major;
  const brandFull = edge ? `${edge[1]}.${edge[2]}` : full;
  const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  return {
    brands: [{ brand: 'Not)A;Brand', version: '8' }, { brand: 'Chromium', version: major }, { brand, version: brandMajor }],
    fullVersionList: [{ brand: 'Not)A;Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: full }, { brand, version: brandFull }],
    fullVersion: brandFull,
    platform,
    platformVersion: process.platform === 'win32' ? '10.0.0' : os.release().split('-')[0],
    architecture: process.arch.startsWith('arm') ? 'arm' : 'x86',
    bitness: /64/.test(process.arch) ? '64' : '32',
    model: '',
    mobile: false,
    wow64: false,
  };
}

function navigatorPlatform() {
  return process.platform === 'win32' ? 'Win32' : process.platform === 'darwin' ? 'MacIntel' : 'Linux x86_64';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/* File d'attente : un seul navigateur, une page à la fois             */
/* ------------------------------------------------------------------ */

let current = null; // { browser, headless }
let idleTimer = null;
let chain = Promise.resolve();
let lastPageAt = 0;
const MODE_FILE = path.join(DATA_DIR, 'browser-mode.json');
/** Mode qui a marché la dernière fois (mémorisé sur disque : évite de retenter l'invisible pour rien). */
function loadPreferHeadless() {
  if (HEADLESS_MODE === '0') return false;
  if (HEADLESS_MODE === '1') return true;
  try { return JSON.parse(fs.readFileSync(MODE_FILE, 'utf8')).headless !== false; } catch { return true; }
}
function savePreferHeadless(value) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(MODE_FILE, JSON.stringify({ headless: value, at: new Date().toISOString() })); } catch { /* sans importance */ }
}
let preferHeadless = loadPreferHeadless();
let lastError = null;

async function getBrowser(headless) {
  if (current && current.headless === headless && !current.browser.closed) return current.browser;
  if (current) await current.browser.close();
  const exe = findBrowser();
  if (!exe) throw new Error('aucun navigateur trouvé (installe Chrome ou Edge, ou indique BROWSER_PATH dans .env)');
  const browser = await new Browser(exe, headless).start();
  current = { browser, headless };
  return browser;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (current) current.browser.close();
    current = null;
  }, IDLE_CLOSE_MS);
  idleTimer.unref();
}

/**
 * Charge une page avec le navigateur. Renvoie { html, title, url, via, challenge }.
 * Les appels sont mis en file (une page à la fois, espacées de quelques secondes).
 * options.minGapMs : pause minimale entre deux pages (modération).
 */
function fetchHtml(url, { ready, minGapMs = Number(process.env.BROWSER_MIN_GAP_MS || 4000) } = {}) {
  const job = chain.then(async () => {
    clearTimeout(idleTimer);
    const wait = lastPageAt + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);

    const modes = HEADLESS_MODE === 'auto' ? [preferHeadless, !preferHeadless] : [HEADLESS_MODE !== '0'];
    let result = null;
    let err = null;
    for (const headless of modes) {
      try {
        const browser = await getBrowser(headless);
        // En auto, le premier essai est écourté : si la vérification ne passe pas vite, on change de mode.
        const firstOfTwo = modes.length === 2 && headless === modes[0];
        result = await browser.fetchPage(url, ready, firstOfTwo ? Math.min(PAGE_TIMEOUT, 20000) : PAGE_TIMEOUT);
        result.via = `${browserName(browser.exe)}${headless ? '' : ' (fenêtre)'}`;
        if (!result.challenge) {
          if (preferHeadless !== headless) savePreferHeadless(headless);
          preferHeadless = headless; // on garde le mode qui marche
          break;
        }
      } catch (e) {
        err = e;
        if (current) { await current.browser.close(); current = null; }
      }
    }
    lastPageAt = Date.now();
    scheduleIdleClose();
    if (!result) {
      lastError = err ? err.message : 'échec inconnu';
      throw err || new Error(lastError);
    }
    lastError = result.challenge ? 'vérification anti-robots non résolue' : null;
    return result;
  });
  chain = job.catch(() => {});
  return job;
}

/*
 * Cartes des collections : un navigateur invisible à part (son propre profil), indépendant de celui
 * qui lit FlixPatrol. Plusieurs cartes sont dessinées en même temps, chacune dans son onglet
 * (RENDER_CONCURRENCY, 3 par défaut) : chaque onglet a son processus, donc son cœur de processeur.
 */
const RENDER_PROFILE_DIR = path.join(DATA_DIR, 'render-profile');
const RENDER_SLOTS = Math.max(1, Number(process.env.RENDER_CONCURRENCY || 3));
let renderer = null; // Promise<Browser>
let renderActive = 0;
const renderQueue = [];
let renderIdle = null;

function getRenderer() {
  if (renderer) {
    return renderer.then((b) => (b.closed ? (renderer = null, getRenderer()) : b));
  }
  const exe = findBrowser();
  if (!exe) return Promise.reject(new Error('aucun navigateur trouvé (installe Chrome ou Edge, ou indique BROWSER_PATH dans .env)'));
  renderer = new Browser(exe, true, RENDER_PROFILE_DIR).start()
    .then((b) => { renderProc = b.proc; return b; })
    .catch((err) => { renderer = null; throw err; });
  return renderer;
}

function withRenderer(fn) {
  return new Promise((resolve, reject) => {
    renderQueue.push({ fn, resolve, reject });
    pumpRender();
  });
}

function pumpRender() {
  clearTimeout(renderIdle);
  while (renderActive < RENDER_SLOTS && renderQueue.length) {
    const { fn, resolve, reject } = renderQueue.shift();
    renderActive++;
    getRenderer().then(fn).then(resolve, async (err) => {
      // Navigateur planté : on le relance au prochain appel.
      if (renderer) { const b = await renderer.catch(() => null); if (b && b.closed) renderer = null; }
      reject(err);
    }).finally(() => { renderActive--; pumpRender(); });
  }
  if (!renderActive && !renderQueue.length && renderer) {
    renderIdle = setTimeout(async () => {
      const b = await renderer.catch(() => null);
      renderer = null;
      if (b) b.close();
    }, IDLE_CLOSE_MS);
    renderIdle.unref();
  }
}

/** Dessine du HTML en image JPEG (cartes des collections). */
function renderHtml(html, options = {}) {
  return withRenderer((browser) => browser.renderImage(html, options));
}

/** Capture les images d'une animation (GIF des cartes). */
function renderFramesHtml(html, options = {}) {
  return withRenderer((browser) => browser.renderFrames(html, options));
}

function status() {
  const exe = findBrowser();
  return {
    navigateur: exe ? `${browserName(exe)} (${exe})` : 'introuvable',
    mode: HEADLESS_MODE === 'auto' ? `auto (actuellement ${preferHeadless ? 'invisible' : 'fenêtre hors écran'})` : HEADLESS_MODE === '0' ? 'fenêtre' : 'invisible',
    derniereErreur: lastError,
  };
}

async function shutdown() {
  clearTimeout(idleTimer);
  clearTimeout(renderIdle);
  if (current) await current.browser.close();
  current = null;
  if (renderer) { const b = await renderer.catch(() => null); renderer = null; if (b) await b.close(); }
}

let renderProc = null; // pour l'arrêt brutal (exit est synchrone)
process.on('exit', () => {
  if (current) try { current.browser.proc.kill(); } catch { /* fini */ }
  if (renderProc) try { renderProc.kill(); } catch { /* fini */ }
});

module.exports = { fetchHtml, renderHtml, renderFramesHtml, findBrowser, status, shutdown, CHALLENGE_RE };
