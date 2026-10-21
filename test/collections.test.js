'use strict';
// Test hors ligne : chaînes, genres, sagas (TMDB simulé) et fichier de collections.
const path = require('path');
process.env.DATA_DIR = path.join(require('os').tmpdir(), 'nfr-col-' + Date.now());
process.env.FLIXPATROL_FETCH = 'direct';
process.env.FLIXPATROL_WAIT_SECONDS = '0.2';
process.env.NETFLIX_TOP10_DISABLED = '1';
const assert = require('assert');

const calls = [];
global.fetch = async (url) => {
  const u = new URL(url);
  const ok = (d) => ({ ok: true, status: 200, headers: new Map(), json: async () => d, text: async () => (typeof d === 'string' ? d : '') });
  if (u.host === 'flixpatrol.com') return { ok: false, status: 404, headers: new Map(), text: async () => '' };
  if (u.host !== 'api.themoviedb.org') throw new Error('hôte inattendu ' + u.host);
  const p = u.pathname.replace('/3', '');
  calls.push({ p, q: Object.fromEntries(u.searchParams) });
  if (p.startsWith('/watch/providers')) {
    return ok({ results: [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 1754, provider_name: 'TF1+' }, { provider_id: 234, provider_name: 'Arte' }, { provider_id: 147, provider_name: 'M6+' }] });
  }
  if (p.startsWith('/collection/')) {
    const id = Number(p.split('/')[2]);
    return ok({ id, name: 'Saga ' + id, backdrop_path: '/saga.jpg', parts: [
      { id: id * 10 + 2, title: 'Deuxième', release_date: '2004-05-01', poster_path: '/b.jpg', popularity: 9 },
      { id: id * 10 + 1, title: 'Premier', release_date: '2001-11-16', poster_path: '/a.jpg', popularity: 20 },
      { id: id * 10 + 3, title: 'Annoncé', release_date: '', poster_path: null, popularity: 1 },
    ] });
  }
  if (p.startsWith('/search/')) {
    // Recherche : un résultat qui porte exactement le titre demandé (MCU).
    const q = u.searchParams.get('query');
    const id = [...q].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100000, 7);
    return ok({ results: [{ id, title: q, name: q, original_title: q, original_name: q, popularity: 50, release_date: '2015-01-01', first_air_date: '2015-01-01' }] });
  }
  if (p.startsWith('/discover/')) {
    const kind = p.split('/')[2];
    return ok({ total_pages: 1, results: Array.from({ length: 5 }, (_, i) => ({ id: 900 + i, title: `${kind} ${i}`, name: `${kind} ${i}`, poster_path: '/p.jpg', release_date: `20${10 + i}-01-01`, first_air_date: `20${10 + i}-01-01`, popularity: 10 - i })) });
  }
  if (/external_ids$/.test(p)) return ok({ imdb_id: 'tt' + p.match(/\d+/)[0] });
  const m = p.match(/^\/(movie|tv)\/(\d+)$/);
  if (m) return ok({ id: Number(m[2]), title: 'Titre ' + m[2], name: 'Série ' + m[2], poster_path: '/x.jpg', first_air_date: '2011-04-17' });
  return { ok: false, status: 404, headers: new Map() };
};

const catalogs = require('../src/catalogs');
const { buildCollections } = require('../src/collection');
const { decode, encode } = require('../src/config');
const covers = require('../src/covers');
const browse = require('../src/browse');
const top10 = require('../src/top10');

const last = (pred) => [...calls].reverse().find(pred);

(async () => {
  const cfg = decode(encode({ keys: { tmdb: 'k'.repeat(32) }, platforms: ['netflix'], channels: ['tf1', 'francetv', 'arte'] }));

  // 1. Chaînes : TF1+ par sa disponibilité, france.tv par ses chaînes de diffusion (séries seulement).
  let r = await catalogs.catalog(cfg, 'movie', 'nfr.tf1.popular', '');
  assert.ok(r.metas.length, 'TF1+ films');
  assert.strictEqual(last((c) => c.p === '/discover/movie').q.with_watch_providers, '1754');
  r = await catalogs.catalog(cfg, 'series', 'nfr.francetv.new', '');
  assert.ok(r.metas.length, 'france.tv séries');
  const ftv = last((c) => c.p === '/discover/tv').q;
  assert.strictEqual(ftv.with_networks, '361|249|255');
  assert.ok(!ftv.with_watch_providers);
  r = await catalogs.catalog(cfg, 'movie', 'nfr.francetv.new', '');
  assert.strictEqual(r.metas.length, 0, 'france.tv : pas de films (rien plutôt que tout TMDB)');
  const list = catalogs.catalogList(cfg);
  assert.ok(!list.some((c) => c.id === 'nfr.francetv.new' && c.type === 'movie'), 'pas de rangée films france.tv');
  assert.ok(!list.some((c) => c.id === 'nfr.arte.top10'), 'Arte sans top 10');
  assert.ok(!list.some((c) => c.id === 'nfr.tf1.soon'), 'pas de « Bientôt » pour les chaînes');

  // 2. Genres : genre + exclusions + plateformes et chaînes choisies.
  r = await catalogs.catalog(cfg, 'series', 'nfr.g.sf.toprated', 'skip=20');
  assert.ok(r.metas.length, 'genre SF séries');
  const g = last((c) => c.p === '/discover/tv').q;
  assert.strictEqual(g.with_genres, '10765');
  assert.strictEqual(g.without_genres, '16');
  assert.strictEqual(g.with_watch_providers, '8|234|1754', 'Netflix + Arte + TF1+ (france.tv n\'a pas de fournisseur)');
  assert.strictEqual(g.page, '2');
  assert.strictEqual(g.sort_by, 'vote_average.desc');
  assert.ok(!list.some((c) => c.id === 'nfr.g.horreur.popular' && c.type === 'series'), 'Horreur : films seulement');

  // 3. Sagas : plusieurs sagas fusionnées, dans l'ordre de sortie, titres annoncés à la fin.
  r = await catalogs.catalog(cfg, 'movie', 'nfr.s.wizarding', '');
  assert.deepStrictEqual(r.metas.map((x) => x.name), ['Premier', 'Premier', 'Deuxième', 'Deuxième', 'Annoncé', 'Annoncé']);
  r = await catalogs.catalog(cfg, 'series', 'nfr.s.westeros', '');
  assert.strictEqual(r.metas.length, 2, 'Game of Thrones + House of the Dragon');
  const art = await browse.sagaArt(cfg.keys.tmdb, require('../src/sagas').findSaga('middleearth'));
  assert.strictEqual(art.backdrop, '/saga.jpg');
  assert.strictEqual(art.movies, 4, 'les titres annoncés ne comptent pas');
  assert.strictEqual(art.series, 1);

  // 3 bis. Marvel : un seul catalogue, films et séries mélangés dans l'ordre de l'histoire.
  r = await catalogs.catalog(cfg, 'movie', 'nfr.s.marvel', '');
  const { MCU_TIMELINE } = require('../src/mcu');
  assert.strictEqual(r.metas.length, MCU_TIMELINE.length, 'toute la liste, rien de plus (sorties simulées antérieures à la date de suivi)');
  assert.strictEqual(r.metas[0].name, 'Titre ' + [...'Captain America: The First Avenger'].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100000, 7), 'commence par Captain America (1942)');
  const lokiAt = MCU_TIMELINE.findIndex((e) => e.t === 'Loki');
  assert.strictEqual(r.metas[lokiAt].type, 'series', 'Loki garde son type série');
  assert.strictEqual(r.metas[0].type, 'movie');
  assert.strictEqual((await catalogs.catalog(cfg, 'series', 'nfr.s.marvel', '')).metas.length, 0);
  assert.ok(!list.some((c) => c.id === 'nfr.s.marvel' && c.type === 'series'), 'pas de rangée « séries » pour Marvel');

  // 4. Fichier de collections.
  const cols = buildCollections(cfg, 'http://h');
  assert.deepStrictEqual(cols.map((c) => [c.title, c.folders.length]), [['Plateformes', 1], ['Chaînes', 3], ['Genres', 12], ['Sagas & univers', 32], ['Animés', 11]]);
  const ids = new Set(list.map((c) => `${c.type}:${c.id}`));
  for (const c of cols) for (const f of c.folders) for (const s of f.sources) assert.ok(ids.has(`${s.type}:${s.catalogId}`), `source déclarée : ${s.catalogId}`);
  assert.strictEqual(cols[0].folders[0].coverImageUrl, `http://h/covers/netflix.jpg?v=${covers.DESIGN_VERSION}`, 'nom de carte historique conservé');
  assert.strictEqual(cols[2].folders[0].coverImageUrl, `http://h/covers/genre-action.jpg?v=${covers.DESIGN_VERSION}`);
  const off = buildCollections(decode(encode({ genres: false, sagas: false, anime: false, channels: [] })), 'http://h');
  assert.deepStrictEqual(off.map((c) => c.title), ['Plateformes']);

  // 4 bis. Animés : animation japonaise ; mots-clés et studios trouvés par leur nom.
  const animeCol = cols[4];
  const where = animeCol.folders.find((f) => f.id === 'nfr-anime-ouregarder');
  assert.deepStrictEqual(where.sources.map((x) => x.catalogId), ['nfr.a.ouregarder.crunchyroll', 'nfr.a.ouregarder.adn', 'nfr.a.ouregarder.netflix'], 'Crunchyroll, ADN, puis les plateformes choisies');
  r = await catalogs.catalog(cfg, 'series', 'nfr.a.moment.saison', 'genre=Tout');
  assert.ok(r.metas.length, 'saison en cours');
  let q = last((c) => c.p === '/discover/tv').q;
  assert.strictEqual(q.with_genres, '16'); assert.strictEqual(q.with_original_language, 'ja');
  r = await catalogs.catalog(cfg, 'series', 'nfr.a.fantasy.isekai', 'genre=Tout');
  q = last((c) => c.p === '/discover/tv').q;
  assert.ok(q.with_keywords && q.with_genres === '16', 'isekai par mot-clé TMDB');
  r = await catalogs.catalog(cfg, 'series', 'nfr.a.action.series', 'genre=Tout');
  assert.strictEqual(last((c) => c.p === '/discover/tv').q.with_genres, '16,10759', 'animation ET action');
  r = await catalogs.catalog(cfg, 'movie', 'nfr.a.studios.mappa', 'genre=Tout');
  assert.ok(last((c) => c.p === '/search/company').q.query === 'MAPPA' && last((c) => c.p === '/discover/movie').q.with_companies, 'studio par son nom');
  assert.strictEqual(r.metas.length, 10, 'séries et films du studio mélangés');
  assert.ok(r.metas.some((m) => m.type === 'series') && r.metas.some((m) => m.type === 'movie'), 'chaque fiche garde son type');
  assert.deepStrictEqual((await catalogs.catalog(cfg, 'series', 'nfr.a.studios.mappa', '')).metas, [], 'rangée mélangée : type movie seulement');
  assert.ok(covers.baseSpecs().some((x) => x.id === 'anime-moment' && x.layout === 'reel' && !x.fx), 'animés : diaporama de scènes, sans effets');

  // 5. Cartes : images du moment pour une saga et un genre.
  const sagaSpec = await covers.withArt(cfg.keys.tmdb, covers.baseSpecs().find((s) => s.id === 'saga-middleearth'), { sagaArt: browse.sagaArt, serviceTop10: top10.serviceTop10 });
  assert.strictEqual(sagaSpec.note, '4 films et 1 série');
  const genreSpec = await covers.withArt(cfg.keys.tmdb, covers.baseSpecs().find((s) => s.id === 'genre-horreur'), {});
  assert.strictEqual(genreSpec.posters.length, 5);
  const arteSpec = await covers.withArt(cfg.keys.tmdb, covers.baseSpecs().find((s) => s.id === 'arte'), { serviceTop10: top10.serviceTop10 });
  assert.ok(arteSpec.posters.length >= 3, 'Arte : affiches des titres populaires (pas de top 10)');
  assert.ok(/<h1 class="title">Arte<\/h1>/.test(covers.coverHtml(arteSpec)));
  assert.ok(/&#39;/.test(covers.coverHtml({ layout: 'cinema', title: "Qu'est-ce", colors: ['#fff', '#000'] })), 'texte échappé');
  // Logo officiel à la place du nom (le nom revient si le logo ne charge pas).
  const withLogo = covers.coverHtml({ layout: 'fan', title: 'Apple TV', colors: ['#888', '#111'], posters: ['/a.jpg'], logo: '/logo.png', logoWhite: true });
  assert.ok(/<img class="logo white" data-logo src="https:\/\/image\.tmdb\.org\/t\/p\/w500\/logo\.png"/.test(withLogo), 'logo TMDB en blanc');
  assert.ok(/<h1 class="title" hidden>Apple TV<\/h1>/.test(withLogo), 'nom gardé en secours');
  assert.ok(/original\/logo\.svg/.test(covers.coverHtml({ layout: 'fan', title: 'X', colors: ['#888', '#111'], posters: ['/a.jpg'], logo: '/logo.svg' })), 'SVG en taille d\'origine');
  assert.ok(require('../src/platforms').ALL.every((x) => x.logo && x.logo.network), 'chaque plateforme et chaîne a son logo');
  // Animés : GIF de scènes cultes livrés avec l'addon, servis tels quels et jamais refaits.
  for (const f of require('../src/anime').ANIME_FOLDERS) {
    const r = covers.resolveFile(`anime-${f.id}.gif`);
    assert.ok(r && r.type === 'image/gif' && /public[\\/]covers[\\/]anime-/.test(r.file), `GIF fourni : anime-${f.id}`);
  }
  // Lien Cloudflare : adresse lue dans le journal de cloudflared ; éteint par défaut.
  const tunnel = require('../src/tunnel');
  assert.strictEqual('INF |  https://brave-lunar-orchid.trycloudflare.com   |'.match(tunnel.QUICK_RE)[0], 'https://brave-lunar-orchid.trycloudflare.com');
  assert.strictEqual(tunnel.mode(), 'off');
  // Décor animé propre à chaque genre ; rien sur les plateformes.
  const fxIds = require('../src/cover-fx').FX_IDS;
  assert.ok(require('../src/genres').GENRES.every((g) => fxIds.includes(g.id)), 'chaque genre a son décor');
  const fxSpec = covers.baseSpecs().find((x) => x.id === 'genre-horreur');
  assert.ok(/data-fx="horreur"/.test(covers.coverHtml(fxSpec)) && /id="fx-front"/.test(covers.coverHtml(fxSpec)));
  assert.ok(!/fx-back/.test(covers.coverHtml(covers.baseSpecs().find((x) => x.kind === 'service'))));

  // 5 bis. Accueil (NuvioTV lit showInHome) : seulement Top 10 du moment et télé-réalité.
  const man = catalogs.manifest(cfg, 'http://h');
  const onHome = man.catalogs.filter((c) => c.showInHome !== false).map((c) => `${c.type}:${c.id}`);
  assert.deepStrictEqual(onHome, ['movie:nfr.top10', 'series:nfr.top10', 'series:nfr.realitytv']);
  assert.ok(man.catalogs.every((c) => typeof c.showInHome === 'boolean'), 'showInHome toujours explicite');
  // Nuvio PC et mobile : un catalogue à paramètre obligatoire ne va pas sur l'accueil.
  const required = (c) => (c.extra || []).some((e) => e.isRequired);
  const searchOnly = man.catalogs.filter((c) => c.id === catalogs.SEARCH_ID);
  assert.deepStrictEqual(searchOnly.map((c) => c.type), ['movie', 'series'], 'recherche films et séries');
  assert.ok(searchOnly.every((c) => c.extraRequired[0] === 'search' && c.extra[0].isRequired && c.showInHome === false));
  assert.deepStrictEqual(man.catalogs.filter((c) => !required(c)).map((c) => `${c.type}:${c.id}`), onHome, 'mêmes catalogues sur l\'accueil pour toutes les applis');
  assert.ok(man.catalogs.filter(required).filter((c) => c.id !== catalogs.SEARCH_ID).every((c) => c.extra.find((e) => e.name === 'genre').options[0] === 'Tout' && c.extraRequired[0] === 'genre'));
  assert.ok(buildCollections(cfg, 'http://h').every((col) => col.folders.every((f) => f.sources.every((s) => s.genre === 'Tout') && f.catalogSources.every((s) => s.genre === 'Tout'))), 'les dossiers passent le genre');
  r = await catalogs.catalog(cfg, 'series', 'nfr.search', 'search=Kaamelott');
  assert.strictEqual(r.metas[0].name, 'Kaamelott', 'recherche');
  assert.strictEqual(last((c) => c.p === '/search/tv').q.language, 'fr-FR');
  assert.deepStrictEqual((await catalogs.catalog(cfg, 'movie', 'nfr.search', '')).metas, [], 'recherche vide');
  r = await catalogs.catalog(cfg, 'series', 'nfr.g.sf.popular', 'genre=Tout&skip=20');
  assert.ok(r.metas.length, 'le genre « Tout » est ignoré par le serveur');
  assert.strictEqual(last((c) => c.p === '/discover/tv').q.page, '2', 'la pagination marche avec le genre');

  // 6. GIF : URL dans les collections, repli sur la carte fixe, encodeur (images, boucle, zones différentielles).
  assert.strictEqual(cols[3].folders[0].focusGifUrl, `http://h/covers/saga-marvel.gif?v=${covers.DESIGN_VERSION}`);
  assert.strictEqual(cols[3].folders[0].focusGifEnabled, true);
  const still = covers.resolveFile('saga-marvel.gif');
  assert.ok(still && still.type === 'image/jpeg' && /saga-marvel\.jpg$/.test(still.file), 'GIF pas encore fait : carte fixe');
  assert.strictEqual(covers.resolveFile('../secret.gif'), null);
  const gif = require('../src/gif');
  const frame = (fill) => { const rgb = Buffer.alloc(40 * 20 * 3); for (let i = 0; i < rgb.length; i += 3) { rgb[i] = fill(i / 3); rgb[i + 1] = 80; rgb[i + 2] = 160; } return { width: 40, height: 20, rgb }; };
  const out = gif.encodeGif([frame((i) => i % 40 * 6), frame((i) => (i % 40 < 10 ? 255 : i % 40 * 6))], { delayMs: 80 });
  assert.strictEqual(out.toString('latin1', 0, 6), 'GIF89a');
  assert.ok(out.includes(Buffer.from('NETSCAPE2.0', 'latin1')), 'boucle');
  assert.strictEqual(out[out.length - 1], 0x3b);
  const descs = [];
  for (let i = 0; i < out.length - 10; i++) if (out[i] === 0x21 && out[i + 1] === 0xf9 && out[i + 2] === 4 && out[i + 8] === 0x2c) descs.push(i + 8);
  assert.strictEqual(descs.length, 2, '2 images');
  assert.strictEqual(out.readUInt16LE(descs[1] + 5), 10, '2e image : seule la zone qui change (10 px de large)');

  console.log(`OK — chaînes, genres, sagas, collections et cartes (${list.length} catalogues)`);
  process.exit(0);
})().catch((err) => { console.error('ÉCHEC :', err.stack || err.message); process.exit(1); });
