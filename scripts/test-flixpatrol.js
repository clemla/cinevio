'use strict';

/**
 * Vérifie la lecture des top 10 FlixPatrol (toutes les plateformes sauf Netflix).
 *   node scripts/test-flixpatrol.js              → lit chaque plateforme et affiche le résultat
 *   node scripts/test-flixpatrol.js visible      → même chose avec la fenêtre du navigateur visible
 *   node scripts/test-flixpatrol.js disney canal → seulement ces plateformes
 * Relit toujours FlixPatrol, puis met le résultat dans le cache de l'addon (valable FLIXPATROL_REFRESH_HOURS).
 */

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch { /* pas de .env */ }
})();

const args = process.argv.slice(2);
if (args.includes('visible')) {
  process.env.BROWSER_HEADLESS = '0';
  process.env.BROWSER_VISIBLE = '1';
}

const { PLATFORMS } = require('../src/platforms');
const flixpatrol = require('../src/sources/flixpatrol');
const browser = require('../src/sources/browser');
const cache = require('../src/cache');

(async () => {
  const wanted = args.filter((a) => a !== 'visible');
  const slugs = PLATFORMS.filter((p) => p.id !== 'netflix' && p.fp).map((p) => p.fp)
    .filter((s) => !wanted.length || wanted.includes(s));

  console.log('');
  console.log(`Navigateur : ${browser.status().navigateur}`);
  console.log(`Plateformes : ${slugs.join(', ')}`);
  console.log('');

  let ok = 0;
  for (const slug of slugs) {
    const t = Date.now();
    const res = await flixpatrol.fetchTop10(slug).catch((e) => ({ error: e.message }));
    const st = flixpatrol.statuses()[slug] || {};
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    if (res && !res.error) {
      ok++;
      // Le résultat sert aussi à l'addon : pas besoin de relire FlixPatrol au prochain lancement.
      cache.set(`fp2:top10:${slug}`, res, flixpatrol.REFRESH_H * 3600, true);
      cache.set(`fp2:last:top10:${slug}`, res, Math.max(72, flixpatrol.REFRESH_H) * 3600, true);
      console.log(`OK   ${slug.padEnd(15)} ${st.detail}  [${secs} s]`);
      if (res.movies.length) console.log(`       Films  : ${res.movies.slice(0, 3).map((x) => x.title).join(' · ')}`);
      if (res.shows.length) console.log(`       Séries : ${res.shows.slice(0, 3).map((x) => x.title).join(' · ')}`);
      if (res.overall.length) console.log(`       Général : ${res.overall.slice(0, 3).map((x) => x.title).join(' · ')}`);
    } else {
      console.log(`ÉCHEC ${slug.padEnd(14)} ${st.detail || (res && res.error) || 'inconnu'}  [${secs} s]`);
    }
  }

  console.log('');
  console.log(`${ok}/${slugs.length} plateformes lues.`);
  if (ok < slugs.length) console.log('Pages en échec enregistrées dans data/debug/.');
  cache.save();
  await browser.shutdown();
  process.exit(ok ? 0 : 1);
})();
