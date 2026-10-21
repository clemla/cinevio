'use strict';
// Test hors ligne : ancien classement servi tout de suite, mise à jour en fond, panne, corrections manuelles.
const path = require('path');
const fs = require('fs');
process.env.DATA_DIR = path.join(require('os').tmpdir(), 'nfr-swr-' + Date.now());
process.env.FLIXPATROL_FETCH = 'direct';
process.env.FLIXPATROL_WAIT_SECONDS = '0.3';
process.env.FLIXPATROL_RETRY_MINUTES = '0';
const assert = require('assert');

let mode = 'ok';
let version = 1;
let calls = 0;
global.fetch = async () => {
  calls++;
  if (mode === 'down') return { ok: false, status: 503, headers: new Map(), text: async () => 'panne' };
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 800));
  const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t) => `${t} v${version}`);
  const html = `<h3>TOP 10 Movies</h3>${titles.map((t, i) => `<a href="/title/${t.toLowerCase().replace(/ /g, '-')}${i === 0 ? '-2026' : ''}/">${t}</a> ${i + 1} d`).join('')}`;
  return { ok: true, status: 200, headers: new Map(), text: async () => html };
};

const cache = require('../src/cache');
const fp = require('../src/sources/flixpatrol');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. Premier lancement lent : on n'attend pas plus que FLIXPATROL_WAIT_SECONDS, la lecture continue en fond.
  mode = 'slow';
  let t = Date.now();
  let r = await fp.top10('disney');
  assert.strictEqual(r, null, 'rien en cache : on rend la main');
  assert.ok(Date.now() - t < 700, 'attente bornée');
  await sleep(900);
  r = await fp.top10('disney');
  assert.ok(r && r.movies[0].title === 'Alpha v1', 'la lecture en fond a rempli le cache');
  assert.strictEqual(r.movies[0].slug, 'alpha-v1-2026');
  assert.strictEqual(fp.slugYear(r.movies[0].slug), 2026);

  // 2. Classement périmé : l'ancien est servi tout de suite, la mise à jour arrive en fond.
  cache.set('fp2:top10:disney', r, 0.001, true);
  await sleep(10);
  version = 2;
  mode = 'slow';
  t = Date.now();
  r = await fp.top10('disney');
  assert.ok(Date.now() - t < 100, 'pas d\'attente');
  assert.ok(r.stale && r.movies[0].title === 'Alpha v1', 'ancien classement servi');
  await sleep(900);
  r = await fp.top10('disney');
  assert.ok(!r.stale && r.movies[0].title === 'Alpha v2', 'nouveau classement en place');

  // 3. FlixPatrol en panne : on garde le dernier vrai classement au lieu du repli TMDB.
  cache.set('fp2:top10:disney', r, 0.001, true);
  await sleep(10);
  mode = 'down';
  r = await fp.top10('disney', { wait: Infinity });
  assert.ok(r && r.stale && r.movies[0].title === 'Alpha v2', 'dernier bon classement en cas de panne');

  // 4. Une seule lecture à la fois par page.
  mode = 'slow'; version = 3; calls = 0;
  cache.set('fp2:top10:canal', null, 0, true);
  await Promise.all([fp.top10('canal', { wait: Infinity }), fp.top10('canal', { wait: Infinity }), fp.top10('canal', { wait: Infinity })]);
  assert.ok(calls <= 2, `lectures dédoublonnées (${calls})`);

  // 5. Corrections manuelles.
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'corrections.json'), JSON.stringify({
    _aide: 'commentaire ignoré', 'the-final-destination': 'movie:19912', 'Paris Has Fallen': 'tv:777', 'marrakech-comedy-festival': null,
  }));
  const top10 = require('../src/top10');
  assert.deepStrictEqual(await top10.matchItem('k', { title: 'The Final Destination', slug: 'the-final-destination' }, {}), { kind: 'movie', id: 19912 });
  assert.deepStrictEqual(await top10.matchItem('k', { title: 'Paris Has Fallen', slug: 'paris-has-fallen' }, {}), { kind: 'tv', id: 777 });
  assert.strictEqual(await top10.matchItem('k', { title: 'Marrakech Comedy Festival', slug: 'marrakech-comedy-festival' }, {}), null);

  // 6. Page « Bientôt » au format réel (liens /title/<id>/streaming/, date, saison, type).
  const card = (slug, title, date, season, kind) => `<div class="aspect-poster"><a href="/title/${slug}/streaming/"><picture><img alt="${title}"></picture></a></div>`
    + `<div><div>${date} | ${season}</div><h3><a href="/title/${slug}/streaming/" class="hover:underline">${title}</a></h3><div>${kind} | United States | 12/19/2023 | Disney+</div></div>`;
  const coming = fp.parseComingPage(`<title>Coming on Disney+ in France • FlixPatrol</title>${card('percy-jackson-and-the-olympians', 'Percy Jackson and the Olympians', '11/20/2026', 'season 3', 'TV Show')}${card('alls-fair', 'All&#039;s Fair', '2026+', 'season 2', 'TV Show')}${card('zootopia-3', 'Zootopia 3', '03/05/2027', '', 'Movie')}`);
  assert.deepStrictEqual(coming.map((x) => [x.title, x.kind, x.date, x.season]), [
    ['Percy Jackson and the Olympians', 'tv', '2026-11-20', 3], ["All's Fair", 'tv', null, 2], ['Zootopia 3', 'movie', '2027-03-05', null]]);

  console.log('OK — cache FlixPatrol (attente bornée, ancien classement, panne, dédoublonnage) et corrections, page « Bientôt »');
  process.exit(0);
})().catch((err) => { console.error('ÉCHEC :', err.message); process.exit(1); });
