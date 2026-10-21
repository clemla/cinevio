'use strict';

/**
 * Collection « Animés » : l'animation japonaise (TMDB : genre Animation + langue d'origine japonais).
 *
 * Chaque dossier a des rangées ; chaque rangée est un catalogue nfr.a.<dossier>.<rangée>.
 *   kind 'tv' | 'movie' : un seul type ;
 *   kind 'mix'          : séries et films mélangés par popularité (catalogue de type movie,
 *                         chaque fiche garde son propre type, comme la saga Marvel).
 * Les studios sont donnés par leur nom : l'identifiant TMDB est cherché par l'API (studio japonais
 * au nom exact), puis gardé 30 jours. Rien à vérifier à la main quand un studio change d'id.
 */

const tmdb = require('./sources/tmdb');
const { PLATFORMS } = require('./platforms');

const DAY = 86400;
const ANIME = { with_genres: '16', with_original_language: 'ja' };

/**
 * Rangée : r(id, libellé, kind, rangée discover, genres TMDB, mots-clés TMDB par leur nom).
 * Mots-clés introuvables sur TMDB : la rangée se contente des genres.
 */
const r = (id, label, kind, row, genres, keywords) => ({ id, label, kind, row, genres, keywords });

const ANIME_FOLDERS = [
  { id: 'moment', name: 'Du moment', subtitle: 'La saison en cours', colors: ['#ff5c8a', '#1c0611'], fx: 'comedie',
    rows: [r('saison', 'Saison en cours', 'tv', 'now'), r('nouveautes', 'Nouvelles séries', 'tv', 'new'), r('films', 'Films récents', 'movie', 'now')] },
  { id: 'cultes', name: 'Incontournables', subtitle: 'Les mieux notés', colors: ['#ffc65c', '#1c1204'], fx: 'fantastique',
    rows: [r('series', 'Séries cultes', 'tv', 'toprated'), r('films', 'Films cultes', 'movie', 'toprated'), r('populaires', 'Les plus populaires', 'tv', 'popular')] },
  { id: 'films', name: "Films d'animation", subtitle: 'Japonais', colors: ['#7fd6ff', '#04121c'], fx: 'famille',
    rows: [r('populaires', 'Populaires', 'movie', 'popular'), r('mieuxnotes', 'Mieux notés', 'movie', 'toprated'), r('nouveautes', 'Nouveautés', 'movie', 'new')] },
  { id: 'action', name: 'Action & shōnen', colors: ['#ff6a2b', '#1f0700'], fx: 'action',
    rows: [r('shonen', 'Shōnen', 'tv', 'popular', [10759], ['shounen', 'shonen']), r('series', 'Action', 'tv', 'popular', [10759]), r('mieuxnotes', 'Mieux notées', 'tv', 'toprated', [10759]), r('films', 'Films', 'movie', 'popular', [28])] },
  { id: 'fantasy', name: 'Fantasy & isekai', colors: ['#b98bff', '#120626'], fx: 'fantastique',
    rows: [r('isekai', 'Isekai', 'tv', 'popular', [10765], ['isekai']), r('series', 'Fantasy', 'tv', 'popular', [10765]), r('mieuxnotes', 'Mieux notées', 'tv', 'toprated', [10765]), r('films', 'Films', 'movie', 'popular', [14])] },
  { id: 'comedie', name: 'Comédie & tranche de vie', colors: ['#ffd84a', '#1c1500'], fx: 'comedie',
    rows: [r('series', 'Séries', 'tv', 'popular', [35]), r('mieuxnotes', 'Mieux notées', 'tv', 'toprated', [35]), r('films', 'Films', 'movie', 'popular', [35])] },
  { id: 'drame', name: 'Drame & romance', colors: ['#ff8fb8', '#1f0712'], fx: 'romance',
    rows: [r('series', 'Séries', 'tv', 'popular', [18]), r('mieuxnotes', 'Mieux notées', 'tv', 'toprated', [18]), r('films', 'Films romantiques', 'movie', 'popular', [10749])] },
  { id: 'mystere', name: 'Mystère & horreur', colors: ['#ff3d5a', '#16030a'], fx: 'horreur',
    rows: [r('series', 'Séries', 'tv', 'popular', [9648]), r('mieuxnotes', 'Mieux notées', 'tv', 'toprated', [9648]), r('films', "Films d'horreur", 'movie', 'popular', [27])] },
  { id: 'scifi', name: 'Science-fiction & mecha', colors: ['#3df0d6', '#011a17'], fx: 'sf',
    rows: [r('mecha', 'Mecha', 'tv', 'popular', [10765], ['mecha', 'giant robot']), r('cyberpunk', 'Cyberpunk & futur', 'tv', 'popular', [10765], ['cyberpunk', 'dystopia', 'space']), r('films', 'Films', 'movie', 'popular', [878]), r('mieuxnotes', 'Films mieux notés', 'movie', 'toprated', [878])] },
  { id: 'studios', name: 'Grands studios', subtitle: 'MAPPA, ufotable, Kyoto Animation…', colors: ['#9b7bff', '#0d0720'], fx: 'thriller',
    studios: ['MAPPA', 'ufotable', 'Kyoto Animation', 'Wit Studio', 'Bones', 'Madhouse', 'Production I.G', 'CloverWorks', 'Trigger', 'Toei Animation', 'Sunrise', 'A-1 Pictures'] },
  { id: 'ouregarder', name: 'Où les regarder', subtitle: 'Crunchyroll, ADN, Netflix…', colors: ['#f47521', '#1e0b00'], fx: 'policier',
    providers: true },
];

/** ADN (Anime Digital Network) : plateforme française d'animés, en plus des plateformes de l'addon. */
const ADN = { id: 'adn', name: 'ADN', tmdbNames: ['ADN', 'Anime Digital Network'], tmdbIds: [] };

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/** Plateformes proposées dans « Où les regarder » : Crunchyroll et ADN, puis les plateformes choisies. */
function animeProviders(cfg) {
  const chosen = new Set(cfg && Array.isArray(cfg.platforms) ? cfg.platforms : PLATFORMS.map((p) => p.id));
  const crunchy = PLATFORMS.find((p) => p.id === 'crunchyroll');
  const others = PLATFORMS.filter((p) => p.id !== 'crunchyroll' && chosen.has(p.id) && ['netflix', 'prime', 'disney', 'canal'].includes(p.id));
  return [crunchy, ADN, ...others].filter(Boolean);
}

/** Rangées d'un dossier (celles des plateformes dépendent des réglages). */
function animeRows(folder, cfg) {
  if (folder.studios) return folder.studios.map((name) => ({ id: slug(name), label: name, kind: 'mix', studio: name }));
  if (folder.providers) return animeProviders(cfg).map((p) => ({ id: p.id, label: p.name, kind: 'mix', provider: p }));
  return folder.rows;
}

const findAnimeFolder = (id) => ANIME_FOLDERS.find((f) => f.id === id) || null;
const animeCatalogId = (folder, row) => `nfr.a.${folder.id}.${row.id}`;
const animeType = (row) => (row.kind === 'tv' ? 'series' : 'movie');

/** Identifiants TMDB d'un studio japonais d'après son nom (gardés 30 jours). */
async function studioIds(key, name) {
  const data = await tmdb.get(key, '/search/company', { query: name }, 30 * DAY).catch(() => null);
  const results = (data && data.results) || [];
  const exact = results.filter((c) => slug(c.name) === slug(name));
  const jp = exact.filter((c) => c.origin_country === 'JP');
  const pick = jp.length ? jp : exact;
  return pick.map((c) => c.id);
}

/** Identifiants TMDB de mots-clés d'après leur nom exact (gardés 30 jours). */
async function keywordIds(key, names) {
  const lists = await Promise.all(names.map((name) =>
    tmdb.get(key, '/search/keyword', { query: name }, 30 * DAY).catch(() => null)
      .then((d) => ((d && d.results) || []).filter((k) => slug(k.name) === slug(name)).map((k) => k.id))));
  return [...new Set(lists.flat())];
}

function animeParams(kind, row, extra = {}) {
  const params = { ...tmdb.discoverParams(kind, row.row || 'popular', extra.providerIds || []), ...ANIME };
  if (extra.keywords && extra.keywords.length) {
    params.with_keywords = extra.keywords.join('|'); // l'un ou l'autre ; le mot-clé suffit, sans genre en plus
  } else if (row.genres && row.genres.length) {
    params.with_genres = ['16', ...row.genres].join(','); // animation ET ce genre
  }
  if (extra.companies) params.with_companies = extra.companies.join('|');
  // Les séries japonaises ont moins de votes : seuils plus bas que pour le reste du catalogue.
  if (row.row === 'toprated') params['vote_count.gte'] = kind === 'movie' ? 150 : 80;
  return params;
}

/** Une page de résultats TMDB { kind, result } pour une rangée. page commence à 1. */
async function animePage(key, folder, row, cfg, page = 1) {
  if (row.kind !== 'mix') {
    const kind = row.kind;
    const keywords = row.keywords ? await keywordIds(key, row.keywords) : [];
    const results = await tmdb.discover(key, kind, animeParams(kind, row, { keywords }), page);
    return results.map((res) => ({ kind, res }));
  }
  const extra = {};
  if (row.studio) {
    extra.companies = await studioIds(key, row.studio);
    if (!extra.companies.length) return [];
  }
  if (row.provider) {
    extra.providerIds = await tmdb.providerIdsFor(key, row.provider).catch(() => []);
    if (!extra.providerIds.length) return [];
  }
  const popular = { ...row, row: 'popular' };
  const [tv, movie] = await Promise.all(['tv', 'movie'].map((kind) =>
    tmdb.discover(key, kind, animeParams(kind, popular, extra), page).catch(() => [])));
  return [...tv.map((res) => ({ kind: 'tv', res })), ...movie.map((res) => ({ kind: 'movie', res }))]
    .sort((a, b) => (b.res.popularity || 0) - (a.res.popularity || 0));
}

/**
 * Images de scènes pour la carte animée d'un dossier : le plus beau fond sans texte (artFor)
 * des titres les plus populaires de sa première rangée. Quatre images différentes au plus.
 */
async function animeBackdrops(key, folder, artFor) {
  const row = animeRows(folder, null)[0];
  const items = (await animePage(key, folder, { ...row, row: 'popular' }, null, 1).catch(() => [])).slice(0, 10);
  const out = [];
  for (const { kind, res } of items) {
    const art = await artFor({ tmdb: key }, kind, res.id).catch(() => ({}));
    const path = art.backdrop || res.backdrop_path;
    if (path && !out.includes(path)) out.push(path);
    if (out.length >= 4) break;
  }
  return out;
}

/** Affiches pour la carte d'un dossier. */
async function animePosters(key, folder) {
  const row = animeRows(folder, null)[0];
  const items = await animePage(key, folder, row, null, 1).catch(() => []);
  return items.map((i) => i.res.poster_path).filter(Boolean).slice(0, 10);
}

module.exports = { animeBackdrops, ANIME_FOLDERS, ADN, findAnimeFolder, animeRows, animeCatalogId, animeType, animePage, animePosters, studioIds, keywordIds, animeProviders, slug };
