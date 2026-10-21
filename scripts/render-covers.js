'use strict';

/**
 * Dessine les cartes des collections avec Chrome ou Edge.
 *   node scripts/render-covers.js            → cartes de base du zip (public/covers/) à partir des
 *                                              cartes du moment de ce serveur (data/covers/)
 *   node scripts/render-covers.js maintenant → cartes du moment (affiches TMDB) dans data/covers/,
 *                                              toutes refaites tout de suite (clé TMDB du .env requise)
 *   node scripts/render-covers.js secours    → cartes de secours sans images (nom sur fond coloré)
 * L'addon refait lui-même les cartes du moment chaque jour : ce script sert à forcer ou à vérifier.
 */

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* pas de .env */ }
})();

const covers = require('../src/covers');
const browser = require('../src/sources/browser');

(async () => {
  const t = Date.now();
  if (process.argv.includes('maintenant')) {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error('TMDB_API_KEY manquante dans .env');
    const top10 = require('../src/top10');
    const browse = require('../src/browse');
    const r = await covers.refresh(key, { serviceTop10: top10.serviceTop10, sagaArt: browse.sagaArt }, { force: true });
    console.log(`${r.rendered} carte(s) du moment dans data/covers/ (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  } else if (process.argv.includes('secours')) {
    const done = await covers.renderStatic();
    console.log(`${done.length} cartes de secours dans public/covers/ (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  } else {
    const done = await covers.bundleCurrent();
    console.log(`${done.length} cartes de base dans public/covers/, d'après les cartes du moment (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  }
  await browser.shutdown();
  require('../src/cache').save();
  process.exit(0);
})().catch(async (err) => {
  console.error('Échec :', err.message);
  await browser.shutdown();
  process.exit(1);
});
