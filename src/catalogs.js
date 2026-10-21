'use strict';

/** Manifest et catalogues de l'addon. */

const tmdb = require('./sources/tmdb');
const top10 = require('./top10');
const meta = require('./meta');
const browse = require('./browse');
const { PLATFORMS, CHANNELS, ROWS, findService } = require('./platforms');
const { GENRES, GENRE_ROWS, findGenre, genreTypes } = require('./genres');
const { SAGAS, findSaga, sagaTypes } = require('./sagas');
const anime = require('./anime');

const ADDON_ID = process.env.ADDON_ID || 'community.nuviofr';
const ADDON_NAME = process.env.ADDON_NAME || 'Cinévio';
const VERSION = require('../package.json').version;
const PAGE = 20;

const ROW_LABELS = {
  top10: (s) => `Top 10 ${s.name}`,
  new: (s) => `Nouveautés ${s.name}`,
  popular: (s) => `Populaires sur ${s.name}`,
  toprated: (s) => `Mieux notés sur ${s.name}`,
  soon: (s) => `Bientôt sur ${s.name}`,
};

const GLOBAL_TOP10_ID = 'nfr.top10';
/** Recherche (titres et affiches en français) : catalogue « recherche seulement », jamais sur l'accueil. */
const SEARCH_ID = 'nfr.search';
/** Genre « obligatoire » des catalogues de dossiers (voir catalogList) : sans effet sur le contenu. */
const FOLDER_GENRE = 'Tout';
const REALITY_ID = 'nfr.realitytv';

/** Rangées réellement proposées pour un service (Arte n'a pas de top 10 FlixPatrol, les chaînes pas de « Bientôt »). */
function rowsFor(service, cfg) {
  return ROWS.map((r) => r.id).filter((row) => {
    if (!cfg.rows[row]) return false;
    if ((row === 'top10' || row === 'soon') && !service.fp) return false;
    if (row === 'soon' && service.noSoon) return false;
    return true;
  });
}

function typesFor(service) {
  return service.types || ['movie', 'series'];
}

const catalogId = (service, row) => `nfr.${service.id}.${row}`;
const genreCatalogId = (genre, row) => `nfr.g.${genre.id}.${row}`;
const sagaCatalogId = (saga) => `nfr.s.${saga.id}`;
const GENRE_ROW_LABEL = { popular: 'Populaires', new: 'Nouveautés', toprated: 'Mieux notés' };

/** Plateformes puis chaînes choisies. */
function selectedServices(cfg) {
  return [
    ...PLATFORMS.filter((p) => cfg.platforms.includes(p.id)),
    ...CHANNELS.filter((c) => (cfg.channels || []).includes(c.id)),
  ];
}

/** Liste ordonnée des catalogues (aussi utilisée pour la collection). */
function catalogList(cfg) {
  // Seuls le Top 10 du moment et la télé-réalité vont sur l'accueil. Les catalogues des dossiers en sont
  // écartés de deux façons, pour toutes les applis Nuvio :
  //  - showInHome: false → Nuvio TV (Android TV) ;
  //  - un genre obligatoire (« Tout ») → Nuvio PC et mobile, qui écartent de l'accueil tout catalogue
  //    à paramètre obligatoire. Les collections passent ce genre ; le serveur l'ignore.
  const list = [
    { type: 'movie', id: GLOBAL_TOP10_ID, name: 'Top 10 du moment', showInHome: true },
    { type: 'series', id: GLOBAL_TOP10_ID, name: 'Top 10 du moment', showInHome: true },
  ];
  for (const type of ['movie', 'series']) {
    list.push({
      type, id: SEARCH_ID, name: ADDON_NAME, showInHome: false,
      extra: [{ name: 'search', isRequired: true }, { name: 'skip' }], extraSupported: ['search', 'skip'], extraRequired: ['search'],
    });
  }
  if (cfg.realityTv) {
    list.push({ type: 'series', id: REALITY_ID, name: 'Télé-réalité FR', extra: [{ name: 'skip' }], extraSupported: ['skip'], showInHome: true });
  }
  const add = (entry, paginated) => {
    entry.showInHome = false;
    entry.extra = [{ name: 'genre', isRequired: true, options: [FOLDER_GENRE] }];
    entry.extraRequired = ['genre'];
    entry.extraSupported = ['genre'];
    if (paginated) { entry.extra.push({ name: 'skip' }); entry.extraSupported.push('skip'); }
    list.push(entry);
  };
  for (const s of selectedServices(cfg)) {
    for (const row of rowsFor(s, cfg)) {
      for (const type of typesFor(s)) {
        const paginated = row === 'new' || row === 'popular' || row === 'toprated';
        add({ type, id: catalogId(s, row), name: ROW_LABELS[row](s), _service: s.id, _row: row }, paginated);
      }
    }
  }
  if (cfg.genres) {
    for (const g of GENRES) {
      for (const r of GENRE_ROWS) {
        for (const type of genreTypes(g)) {
          add({ type, id: genreCatalogId(g, r.id), name: `${g.name} · ${GENRE_ROW_LABEL[r.id]}`, _genre: g.id, _row: r.id }, true);
        }
      }
    }
  }
  if (cfg.sagas) {
    for (const saga of SAGAS) {
      for (const type of sagaTypes(saga)) add({ type, id: sagaCatalogId(saga), name: saga.name, _saga: saga.id }, true);
    }
  }
  if (cfg.anime) {
    for (const folder of anime.ANIME_FOLDERS) {
      for (const row of anime.animeRows(folder, cfg)) {
        add({ type: anime.animeType(row), id: anime.animeCatalogId(folder, row), name: `Animés · ${folder.name} · ${row.label}` }, true);
      }
    }
  }
  return list;
}

function manifest(cfg, baseUrl) {
  const catalogs = catalogList(cfg).map(({ _service, _row, _genre, _saga, ...c }) => c);
  return {
    id: ADDON_ID,
    version: VERSION,
    name: ADDON_NAME,
    description: 'Métadonnées en français, plateformes et chaînes françaises, genres, sagas et top 10 du moment (streaming + cinéma).',
    logo: `${baseUrl}/covers/logo.png`,
    background: `${baseUrl}/covers/background.jpg`,
    resources: ['catalog', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:'],
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}

/** Clé TMDB effective : celle de l'utilisateur, sinon celle de l'instance. */
function effectiveKeys(cfg) {
  return {
    tmdb: cfg.keys.tmdb || process.env.TMDB_API_KEY || '',
    fanart: cfg.keys.fanart || process.env.FANART_API_KEY || '',
    mdblist: cfg.keys.mdblist || process.env.MDBLIST_API_KEY || '',
  };
}

function parseExtra(extraStr) {
  const out = {};
  if (!extraStr) return out;
  for (const part of extraStr.split('&')) {
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return out;
}

/** Point d'entrée catalogue : renvoie { metas }. */
async function catalog(cfg, type, id, extraStr) {
  const keys = effectiveKeys(cfg);
  if (!keys.tmdb) return { metas: [] };
  const kind = meta.tmdbKind(type);
  const extra = parseExtra(extraStr);
  const skip = Number(extra.skip || 0);

  if (id === SEARCH_ID) {
    const query = String(extra.search || '').trim();
    if (!query) return { metas: [] };
    const data = await tmdb.get(keys.tmdb, `/search/${kind}`, {
      query, language: 'fr-FR', region: 'FR', include_adult: 'false', page: Math.floor(skip / PAGE) + 1,
    }, 6 * 3600).catch(() => null);
    // Les plus connus d'abord parmi les bons résultats (TMDB trie déjà par pertinence).
    const results = ((data && data.results) || []).filter((r) => r.poster_path || r.popularity > 5);
    return { metas: await meta.previewsFromResults(keys, kind, results), cacheMaxAge: 6 * 3600 };
  }

  if (id === GLOBAL_TOP10_ID) {
    if (skip) return { metas: [] };
    const { refs } = await top10.mergedTop10(keys.tmdb, kind);
    return { metas: await meta.previewsFromRefs(keys, refs), cacheMaxAge: 3600 };
  }

  if (id === REALITY_ID) {
    // Page 1 : d'abord les émissions présentes dans les classements du moment, puis le reste.
    const page = Math.floor(skip / PAGE) + 1;
    const results = await tmdb.realityTvFR(keys.tmdb, page);
    if (page > 1) return { metas: await meta.previewsFromResults(keys, 'tv', results), cacheMaxAge: 6 * 3600 };
    const { refs } = await top10.realityTrending(keys.tmdb).catch(() => ({ refs: [] }));
    const hot = await meta.previewsFromRefs(keys, refs);
    const seen = new Set(hot.map((m) => m.tmdbId));
    const rest = await meta.previewsFromResults(keys, 'tv', results.filter((r) => !seen.has(r.id)));
    return { metas: [...hot, ...rest].slice(0, PAGE + hot.length), cacheMaxAge: 3 * 3600 };
  }

  // Genres : nfr.g.<genre>.<rangée>, limités aux plateformes et chaînes choisies.
  const gm = /^nfr\.g\.([a-z0-9]+)\.([a-z0-9]+)$/.exec(id);
  if (gm) {
    const genre = findGenre(gm[1]);
    if (!genre || !GENRE_ROW_LABEL[gm[2]]) return { metas: [] };
    const providerIds = await browse.providerIdsForConfig(keys.tmdb, [...cfg.platforms, ...(cfg.channels || [])]);
    const results = await browse.genrePage(keys.tmdb, genre, kind, gm[2], providerIds, Math.floor(skip / PAGE) + 1);
    return { metas: await meta.previewsFromResults(keys, kind, results), cacheMaxAge: 6 * 3600 };
  }

  // Animés : nfr.a.<dossier>.<rangée>. Rangées « mix » : séries et films mélangés (catalogue de type movie).
  const am = /^nfr\.a\.([a-z0-9]+)\.([a-z0-9]+)$/.exec(id);
  if (am) {
    const folder = anime.findAnimeFolder(am[1]);
    const row = folder && anime.animeRows(folder, cfg).find((x) => x.id === am[2]);
    if (!row || anime.animeType(row) !== type) return { metas: [] };
    const perPage = row.kind === 'mix' ? PAGE * 2 : PAGE;
    const items = await anime.animePage(keys.tmdb, folder, row, cfg, Math.floor(skip / perPage) + 1);
    return { metas: await meta.previewsFromMixed(keys, items), cacheMaxAge: 6 * 3600 };
  }

  // Sagas : nfr.s.<saga>, dans l'ordre de sortie.
  const sm = /^nfr\.s\.([a-z0-9]+)$/.exec(id);
  if (sm) {
    const saga = findSaga(sm[1]);
    if (!saga) return { metas: [] };
    if (saga.timeline) {
      // Films et séries mélangés : chaque fiche garde son type (NuvioTV ouvre la bonne page).
      if (type !== 'movie') return { metas: [] };
      const refs = await browse.timelineRefs(keys.tmdb, saga);
      return { metas: await meta.previewsFromRefs(keys, refs.slice(skip, skip + PAGE * 3)), cacheMaxAge: 12 * 3600 };
    }
    const items = await browse.sagaItems(keys.tmdb, saga, kind);
    return { metas: await meta.previewsFromResults(keys, kind, items.slice(skip, skip + PAGE * 3)), cacheMaxAge: 12 * 3600 };
  }

  const m = /^nfr\.([a-z0-9]+)\.([a-z0-9]+)$/.exec(id);
  if (!m) return { metas: [] };
  const service = findService(m[1]);
  const row = m[2];
  if (!service) return { metas: [] };

  if (row === 'top10') {
    if (skip) return { metas: [] };
    const { refs } = await top10.serviceTop10(keys.tmdb, service, kind);
    return { metas: await meta.previewsFromRefs(keys, refs), cacheMaxAge: 3600 };
  }
  if (row === 'soon') {
    if (skip) return { metas: [] };
    const { refs } = await top10.comingSoon(keys.tmdb, service, kind);
    return { metas: await meta.previewsFromRefs(keys, refs), cacheMaxAge: 6 * 3600 };
  }

  const providerIds = await tmdb.providerIdsFor(keys.tmdb, service);
  // Sans données de disponibilité ni chaînes de diffusion, on n'affiche rien plutôt que tout TMDB.
  if (!providerIds.length && !(kind === 'tv' && service.networks)) return { metas: [] };
  const params = tmdb.discoverParams(kind, row, providerIds, { networks: service.networks });
  const page = Math.floor(skip / PAGE) + 1;
  const results = await tmdb.discover(keys.tmdb, kind, params, page);
  return { metas: await meta.previewsFromResults(keys, kind, results), cacheMaxAge: 6 * 3600 };
}

async function metaHandler(cfg, type, id) {
  const keys = effectiveKeys(cfg);
  if (!keys.tmdb) return { meta: null };
  const m = await meta.fullMeta(keys, type, id);
  return { meta: m, cacheMaxAge: 24 * 3600 };
}

module.exports = {
  ADDON_ID, ADDON_NAME, GLOBAL_TOP10_ID, REALITY_ID, SEARCH_ID, ROW_LABELS, FOLDER_GENRE,
  manifest, catalog, metaHandler, catalogList, rowsFor, typesFor, catalogId, genreCatalogId, sagaCatalogId, GENRE_ROW_LABEL,
  selectedServices, effectiveKeys,
};
