'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Cache mémoire avec TTL, persisté sur disque pour survivre aux redémarrages
 * (évite de re-solliciter TMDB / FlixPatrol à chaque déploiement).
 */

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'cache.json');
const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 50000);

const store = new Map();
const inflight = new Map();
let dirty = false;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(raw)) {
      if (v && v.e > now) store.set(k, v);
    }
  } catch {
    /* premier démarrage */
  }
}

function save() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const now = Date.now();
    const obj = {};
    for (const [k, v] of store) if (v.e > now && v.p) obj[k] = v;
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(obj));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (err) {
    console.warn('[cache] sauvegarde impossible :', err.message);
  }
}

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.e <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.v;
}

/** ttl en secondes ; persist = écrit sur disque (pour les données coûteuses). */
function set(key, value, ttl, persist = false) {
  if (store.size >= MAX_ENTRIES) {
    const first = store.keys().next().value;
    store.delete(first);
  }
  store.set(key, { v: value, e: Date.now() + ttl * 1000, p: persist });
  if (persist) dirty = true;
}

/** Mémoïse une fonction async, et fusionne les appels simultanés sur la même clé. */
async function wrap(key, ttl, fn, persist = false) {
  const cached = get(key);
  if (cached !== undefined) return cached;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await fn();
      if (value !== undefined && value !== null) set(key, value, ttl, persist);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

load();
setInterval(save, 60 * 1000).unref();
// Sauvegarde à l'arrêt : Ctrl+C (SIGINT), fermeture de la fenêtre sous Windows (SIGHUP),
// Ctrl+Pause (SIGBREAK), arrêt système (SIGTERM), et toute sortie normale.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => { save(); process.exit(0); }); } catch { /* signal absent sur ce système */ }
}
process.on('exit', save);

module.exports = { get, set, wrap, save };
