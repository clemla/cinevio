'use strict';
// Test hors ligne : simule TMDB, FlixPatrol et Allociné pour vérifier toute la chaîne.
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'nfr-test-' + Date.now());
process.env.FLIXPATROL_FETCH = 'direct'; // pas de navigateur pendant le test
const assert = require('assert');

const fpHtml = `<html><body><h2>Netflix TOP 10 in France</h2>
<div><h3>TOP 10 Movies</h3><table>
${['The Platform 2','Trouble','Yo Mama','Havoc','Tenor','Discount'].map((t,i)=>`<tr><td>${i+1}.</td><td><a href="/title/${t.toLowerCase().replace(/ /g,'-')}/" class="x"><span>${t}</span></a></td><td>${i * 9 + 1} d</td></tr>`).join('')}
</table></div>
<div><h3>TOP 10 TV Shows</h3><table>
${['Monsters','Nobody Wants This','Heartstopper','The Perfect Couple','The Rookie'].map((t,i)=>`<tr><td><a href="/title/${t.toLowerCase().replace(/ /g,'-')}/">${t}</a></td></tr>`).join('')}
</table></div><div><h3>TOP 10 Kids Movies</h3><a href="/title/kid/">Kid</a></div></body></html>`;

let tmdbCalls = 0;
const titleId = (t) => 1000 + [...t].reduce((a, c) => a + c.charCodeAt(0), 0);
const NF_TSV = ['country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\tcumulative_weeks_in_top_10',
  'France\tFR\t2026-10-04\tTV\t1\tOld Show\tOld Show: Season 1\t5',
  ...['Below', 'East of Eden', 'The Arena', 'Percy Jackson and the Olympians', 'Not a Stranger', 'Matlock'].map((t, i) =>
    `France\tFR\t2026-10-11\tTV\t${i + 1}\t${t}\t${t}: Season 1\t${i === 2 ? 2 : 1}`),
  'Italy\tIT\t2026-10-11\tTV\t1\tAutre\tAutre\t1',
  ...['Film Un', 'Film Deux', 'Film Trois', 'Film Quatre', 'Film Cinq'].map((t, i) => `France\tFR\t2026-10-11\tFilms\t${i + 1}\t${t}\t\t1`),
].join('\n');
const ARENA_NEW = 300001, ARENA_OLD = 300002;
global.fetch = async (url) => {
  const u = new URL(url);
  const ok = (data) => ({ ok: true, status: 200, headers: new Map(), json: async () => data, text: async () => data });
  if (u.host === 'www.netflix.com') {
    const enc = new TextEncoder().encode(NF_TSV);
    return { ok: true, status: 200, headers: new Map(), body: (async function* () { yield enc.slice(0, 50); yield enc.slice(50); })() };
  }
  if (u.host === 'flixpatrol.com') return u.pathname.includes('/top10/netflix/') ? ok(fpHtml) : { ok: false, status: 404, headers: new Map(), text: async () => '' };
  if (u.host === 'www.allocine.fr') return ok(['Joker 3','Le Comte','Wicked','Dune 3','Mufasa','Gladiator III'].map((t,i)=>`<a class="meta-title-link" href="/film/fichefilm_gen_cfilm=${i+10}.html">${t}</a>`).join(''));
  if (u.host !== 'api.themoviedb.org') throw new Error('hôte inattendu ' + u.host);
  tmdbCalls++;
  const p = u.pathname.replace('/3', '');
  if (p.startsWith('/watch/providers')) return ok({ results: [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 119, provider_name: 'Amazon Prime Video' }] });
  if (p.startsWith('/search/')) {
    const q = u.searchParams.get('query'); const kind = p.split('/')[2];
    if (q === 'The Arena' && kind === 'tv') return ok({ results: [
      { id: ARENA_OLD, name: 'The Arena', popularity: 80, first_air_date: '2011-03-01' },
      { id: 300003, name: 'Arena', popularity: 60, first_air_date: '2015-03-01' },
      { id: 300004, name: 'The Arena', popularity: 40, first_air_date: '2018-03-01' },
      { id: ARENA_NEW, name: u.searchParams.get('language') === 'fr-FR' ? "L'Arène" : 'The Arena', original_name: "L'Arène", popularity: 6, first_air_date: '2026-09-30' },
    ] });
    return ok({ results: [{ id: titleId(q), [kind === 'movie' ? 'title' : 'name']: q, popularity: 50, release_date: '2025-01-01', first_air_date: '2025-01-01' }] });
  }
  if (/\/(movie|tv)\/\d+\/watch\/providers/.test(p)) {
    if (p.includes(String(ARENA_OLD)) || p.includes('300003') || p.includes('300004')) return ok({ results: {} });
    return ok({ results: { FR: { flatrate: [{ provider_id: 8 }] } } });
  }
  if (/external_ids$/.test(p)) return ok({ imdb_id: 'tt' + p.match(/\d+/)[0] });
  if (p.startsWith('/discover/')) return ok({ results: Array.from({ length: 20 }, (_, i) => ({ id: 500 + i, title: 'Film ' + i, name: 'Série ' + i, poster_path: '/p.jpg', popularity: 20 - i })) });
  if (p.startsWith('/movie/now_playing')) return ok({ results: [] });
  if (p.startsWith('/trending/')) return ok({ results: [{ id: titleId('Trouble') }] });
  if (p.startsWith('/find/')) return ok({ movie_results: [{ id: 42 }], tv_results: [] });
  if (/^\/tv\/\d+\/season\/\d+/.test(p)) return ok({ episodes: [{ season_number: 1, episode_number: 1, name: 'Pilote', air_date: '2024-01-01' }] });
  const m = p.match(/^\/(movie|tv)\/(\d+)$/);
  if (m) return ok({
    id: Number(m[2]), title: 'Titre FR ' + m[2], name: 'Série FR ' + m[2], overview: 'Résumé en français.', poster_path: '/p.jpg', backdrop_path: '/b.jpg',
    release_date: new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10), first_air_date: '2023-01-01',
    last_episode_to_air: { air_date: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10) }, status: 'Returning Series', runtime: 112, vote_average: 7.4,
    genres: [{ name: 'Science-Fiction' }], credits: { cast: [{ id: 5, name: 'Actrice', character: 'Héroïne', profile_path: '/actrice.jpg' }, { id: 6, name: 'Acteur' }], crew: [{ id: 9, job: 'Director', department: 'Directing', name: 'Réalisatrice', profile_path: '/real.jpg' }, { id: 10, job: 'Screenplay', department: 'Writing', name: 'Scénariste' }] },
    videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc', iso_639_1: 'fr' }] },
    images: { posters: [{ iso_639_1: 'fr', file_path: '/fr.jpg', vote_average: 5 }], backdrops: [], logos: [{ iso_639_1: 'fr', file_path: '/logo.png', vote_average: 5 }] },
    release_dates: { results: [{ iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2024-05-08T00:00:00.000Z', certification: '12' }] }] },
    external_ids: { imdb_id: 'tt42', tvdb_id: 7 }, seasons: [{ season_number: 1, episode_count: 1 }],
    ...(Number(m[2]) === ARENA_NEW ? { name: "L'Arène", type: 'Reality', original_language: 'fr', origin_country: ['FR'], genres: [{ id: 10764, name: 'Réalité' }] } : { type: 'Scripted', original_language: 'en' }),
  });
  return { ok: false, status: 404, headers: new Map() };
};

const { parseTop10Page } = require('../src/sources/flixpatrol');
const { rankTrending, freshness, momentum } = require('../src/top10');
const catalogs = require('../src/catalogs');
const { buildCollections } = require('../src/collection');
const { decode, encode } = require('../src/config');

(async () => {
  // 1. Parsing FlixPatrol
  const parsed = parseTop10Page(fpHtml);
  assert.deepStrictEqual(parsed.movies.map((x) => x.title).slice(0, 3), ['The Platform 2', 'Trouble', 'Yo Mama']);
  assert.strictEqual(parsed.shows.length, 5);
  assert.ok(!parsed.shows.some((x) => x.title === 'Kid'), 'les sections enfants ne doivent pas polluer');
  assert.deepStrictEqual(parsed.movies.map((x) => x.days).slice(0, 3), [1, 10, 19], 'jours dans le top');

  // 1 bis. Import manuel d'une page enregistrée (liens absolus)
  const fsT = require('fs'); const pathT = require('path');
  const imp = pathT.join(process.env.DATA_DIR, 'import');
  fsT.mkdirSync(imp, { recursive: true });
  fsT.writeFileSync(pathT.join(imp, 'TOP 10 on Amazon Prime in France - amazon-prime.html'), fpHtml.replace(/href="\/title\//g, 'href="https://flixpatrol.com/title/'));
  const fpMod = require('../src/sources/flixpatrol');
  const imported = await fpMod.top10('amazon-prime');
  assert.strictEqual(imported.movies[0].title, 'The Platform 2', 'page importée lue');
  assert.strictEqual(await fpMod.top10('disney'), null, 'pas de fichier → réseau (404 simulé)');

  // 2. Classement tendance
  const now = Date.parse('2026-10-19');
  const d = (days) => new Date(now - days * 86400000).toISOString().slice(0, 10);
  const OLD = { kind: 'movie', id: 1, days: 90 }, NEW = { kind: 'movie', id: 2, days: 3 }, MID = { kind: 'movie', id: 3, days: 30 };
  const det = new Map([['movie:1', { release_date: d(900) }], ['movie:2', { release_date: d(20) }], ['movie:3', { release_date: d(200) }]]);
  const ranked = rankTrending([{ weight: 1, refs: [OLD, MID, NEW] }], 'movie', det, [], now);
  assert.ok(!ranked.some((e) => e.ref.id === 1), 'un film de 2,5 ans est écarté');
  assert.strictEqual(ranked[0].ref.id, 2, 'le nouveau récent passe devant même s\'il est 3e');
  assert.strictEqual(freshness(400, 'movie'), null);
  assert.strictEqual(freshness(10, 'tv'), 1);
  assert.ok(momentum(2) > momentum(90));
  const buzz = rankTrending([{ weight: 1, refs: [{ kind: 'movie', id: 3 }, { kind: 'movie', id: 2 }] }], 'movie',
    new Map([['movie:2', { release_date: d(20) }], ['movie:3', { release_date: d(20) }]]), [2], now);
  assert.strictEqual(buzz[0].ref.id, 2, 'tendance TMDB = bonus');

  // 3. Config
  const cfg = decode(encode({ keys: { tmdb: 'a'.repeat(32) }, platforms: ['netflix', 'inconnu'], channels: [] }));
  assert.deepStrictEqual(cfg.platforms, ['netflix']);
  assert.strictEqual(decode('%%%'), null);

  // 4. Catalogues
  const top = await catalogs.catalog(cfg, 'movie', 'nfr.netflix.top10', '');
  assert.strictEqual(top.metas[0].name, 'Titre FR ' + titleId('Film Un'), 'Netflix : source officielle prioritaire');
  assert.ok(top.metas[0].id.startsWith('tt'));
  const series = await catalogs.catalog(cfg, 'series', 'nfr.netflix.top10', '');
  assert.ok(series.metas.length >= 5);
  assert.strictEqual(series.metas[2].tmdbId, ARENA_NEW, 'The Arena (Netflix officiel) → L\'Arène, pas un vieux homonyme');
  assert.ok(!series.metas.some((m) => m.name === 'Old Show'), 'seule la dernière semaine compte');
  const pop = await catalogs.catalog(cfg, 'movie', 'nfr.netflix.popular', 'skip=20');
  assert.strictEqual(pop.metas.length, 20);
  const reality = await catalogs.catalog(cfg, 'series', 'nfr.realitytv', '');
  assert.strictEqual(reality.metas[0].tmdbId, ARENA_NEW, 'la télé-réalité du moment passe en tête');
  const global = await catalogs.catalog(cfg, 'movie', 'nfr.top10', '');
  assert.ok(global.metas.length >= 5 && global.metas.length <= 10, 'top 10 fusionné : ' + global.metas.length);

  // 5. Fiche
  const meta = (await catalogs.metaHandler(cfg, 'movie', 'tt42')).meta;
  assert.strictEqual(meta.name, 'Titre FR 42');
  assert.strictEqual(meta.certification, '-12');
  assert.strictEqual(meta.runtime, '1 h 52');
  assert.ok(meta.poster.endsWith('/fr.jpg'));
  // Bandeau d'accueil : fond sans texte, bien noté avec assez de votes, en 16:9 ; logo PNG en français.
  const { bestBackdrop, bestLogo } = require('../src/meta');
  assert.strictEqual(bestBackdrop([
    { file_path: '/texte.jpg', iso_639_1: 'fr', vote_average: 9, vote_count: 50, width: 3840, height: 2160 },
    { file_path: '/un-vote.jpg', iso_639_1: null, vote_average: 10, vote_count: 1, width: 1920, height: 1080 },
    { file_path: '/petit.jpg', iso_639_1: null, vote_average: 6, vote_count: 20, width: 1000, height: 562 },
    { file_path: '/carre.jpg', iso_639_1: null, vote_average: 8, vote_count: 30, width: 2000, height: 2000 },
    { file_path: '/bon.jpg', iso_639_1: null, vote_average: 6.4, vote_count: 25, width: 3840, height: 2160 },
  ]), '/bon.jpg');
  assert.strictEqual(bestBackdrop([{ file_path: '/texte.jpg', iso_639_1: 'en' }]), null, 'jamais de fond avec texte');
  assert.strictEqual(bestLogo([
    { file_path: '/en.png', iso_639_1: 'en', vote_average: 9 },
    { file_path: '/fr.svg', iso_639_1: 'fr', vote_average: 9 },
    { file_path: '/fr.png', iso_639_1: 'fr', vote_average: 5 },
  ]), '/fr.png');
  assert.strictEqual(bestLogo([{ file_path: '/en.png', iso_639_1: 'en' }]), '/en.png');
  // Fiche enrichie (Nuvio) : photos et rôles des acteurs, réalisation, scénario, âge.
  const ax = meta.app_extras;
  assert.deepStrictEqual(ax.cast[0], { name: 'Actrice', character: 'Héroïne', photo: 'https://image.tmdb.org/t/p/w185/actrice.jpg', tmdbId: 5 });
  assert.strictEqual(ax.cast[1].photo, undefined, 'pas de photo inventée');
  assert.strictEqual(ax.directors[0].photo, 'https://image.tmdb.org/t/p/w185/real.jpg');
  assert.strictEqual(ax.writers[0].name, 'Scénariste');
  assert.strictEqual(ax.certificationLocal, '-12');
  assert.deepStrictEqual(meta.cast, ['Actrice', 'Acteur'], 'noms gardés pour les autres applis');
  const smeta = (await catalogs.metaHandler(cfg, 'series', 'tt42')).meta;
  assert.ok(smeta.type === 'series');

  // 6. Collection cohérente avec le manifest
  const full = decode(encode({}));
  const man = catalogs.manifest(full, 'https://x.fr');
  const ids = new Set(man.catalogs.map((c) => `${c.type}|${c.id}`));
  const cols = buildCollections(full, 'https://x.fr');
  let n = 0;
  for (const col of cols) for (const f of col.folders) for (const s of f.sources) {
    assert.ok(ids.has(`${s.type}|${s.catalogId}`), 'source non déclarée : ' + s.catalogId);
    assert.strictEqual(s.addonId, man.id); n++;
  }
  console.log(`OK — ${n} sources de collection, ${man.catalogs.length} catalogues, ${tmdbCalls} appels TMDB simulés`);
  process.exit(0);
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
