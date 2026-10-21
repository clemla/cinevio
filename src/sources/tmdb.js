'use strict';

const { request, limiter, mapLimit, normTitle } = require('../http');
const cache = require('../cache');

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const limit = limiter(Number(process.env.TMDB_CONCURRENCY || 12));

const DAY = 86400;

function authParams(key) {
  // Clé v3 (32 caractères) en paramètre, jeton v4 (JWT) en en-tête.
  if (!key) throw new Error('Clé TMDB manquante');
  if (key.length > 40) return { qs: '', headers: { Authorization: `Bearer ${key}` } };
  return { qs: `api_key=${encodeURIComponent(key)}`, headers: {} };
}

/** Appel TMDB brut, mis en cache. */
function get(key, path, params = {}, ttl = DAY) {
  const search = new URLSearchParams(params).toString();
  const cacheKey = `tmdb:${path}?${search}`;
  return cache.wrap(cacheKey, ttl, () => limit(async () => {
    const { qs, headers } = authParams(key);
    const url = `${BASE}${path}?${[qs, search].filter(Boolean).join('&')}`;
    return request(url, { headers, timeout: 12000, retries: 2 });
  }), ttl >= DAY);
}

const img = (p, size = 'w500') => (p ? `${IMG}/${size}${p}` : null);

/** Résout les IDs des plateformes françaises par leur nom (la liste TMDB évolue). */
async function providerIdsFor(key, service) {
  const lists = await Promise.all([
    get(key, '/watch/providers/movie', { watch_region: 'FR', language: 'fr-FR' }, 7 * DAY).catch(() => null),
    get(key, '/watch/providers/tv', { watch_region: 'FR', language: 'fr-FR' }, 7 * DAY).catch(() => null),
  ]);
  const wanted = service.tmdbNames.map(normTitle);
  const ids = new Set();
  for (const list of lists) {
    for (const p of (list && list.results) || []) {
      if (wanted.includes(normTitle(p.provider_name))) ids.add(p.provider_id);
    }
  }
  if (!ids.size) service.tmdbIds.forEach((id) => ids.add(id));
  return [...ids];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Paramètres « discover » pour une rangée de plateforme, de chaîne ou de genre.
 * options.networks : chaînes de diffusion (séries) quand la plateforme n'a pas de données de disponibilité.
 * options.genres / options.excludeGenres : genres TMDB (l'un ou l'autre) / à écarter.
 */
function discoverParams(kind, row, providerIds, options = {}) {
  const isMovie = kind === 'movie';
  const base = { language: 'fr-FR', include_adult: 'false' };
  if (providerIds && providerIds.length) {
    Object.assign(base, {
      watch_region: 'FR',
      with_watch_providers: providerIds.join('|'),
      with_watch_monetization_types: 'flatrate|free|ads',
    });
  } else if (!isMovie && options.networks && options.networks.length) {
    base.with_networks = options.networks.join('|');
  }
  if (options.genres && options.genres.length) base.with_genres = options.genres.join('|');
  if (options.excludeGenres && options.excludeGenres.length) base.without_genres = options.excludeGenres.join(',');
  const dateField = isMovie ? 'primary_release_date' : 'first_air_date';
  switch (row) {
    case 'new':
      return { ...base, sort_by: `${dateField}.desc`, [`${dateField}.lte`]: today(), 'vote_count.gte': isMovie ? 10 : 3 };
    case 'toprated':
      return { ...base, sort_by: 'vote_average.desc', 'vote_count.gte': isMovie ? 500 : 200 };
    case 'now': {
      // Ce qui vit en ce moment sur la plateforme : sorti dans l'année (film) ou épisode diffusé ce mois-ci (série).
      const since = new Date(Date.now() - (isMovie ? 365 : 45) * 86400000).toISOString().slice(0, 10);
      return isMovie
        ? { ...base, sort_by: 'popularity.desc', 'primary_release_date.gte': since, 'vote_count.gte': 5 }
        : { ...base, sort_by: 'popularity.desc', 'air_date.gte': since, 'vote_count.gte': 1 };
    }
    case 'popular':
    default:
      return { ...base, sort_by: 'popularity.desc', 'vote_count.gte': isMovie ? 30 : 10 };
  }
}

async function discover(key, kind, params, page = 1) {
  const data = await get(key, `/discover/${kind}`, { ...params, page }, 6 * 3600);
  return (data && data.results) || [];
}

/** Une saga TMDB : { name, backdrop_path, poster_path, parts: [...] } en français. */
function collection(key, id) {
  return get(key, `/collection/${id}`, { language: 'fr-FR' }, 3 * DAY);
}

/** Titres d'un ou plusieurs studios, par ordre de sortie (jusqu'à 5 pages). */
async function byCompanies(key, kind, companies, minVotes = 50) {
  const isMovie = kind === 'movie';
  const params = {
    language: 'fr-FR', include_adult: 'false', with_companies: companies.join('|'),
    sort_by: isMovie ? 'primary_release_date.asc' : 'first_air_date.asc',
    'vote_count.gte': minVotes,
    [isMovie ? 'primary_release_date.lte' : 'first_air_date.lte']: today(),
  };
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const data = await get(key, `/discover/${kind}`, { ...params, page }, 3 * DAY);
    out.push(...((data && data.results) || []));
    if (!data || page >= (data.total_pages || 1)) break;
  }
  return out;
}

/** Tendances TMDB du jour (mondiales) : sert de signal d'élan, pas de source. */
async function trending(key, kind) {
  const pages = await Promise.all([1, 2].map((page) =>
    get(key, `/trending/${kind}/day`, { language: 'fr-FR', page }, 3 * 3600).catch(() => null)));
  return pages.flatMap((d) => (d && d.results) || []).map((r) => r.id);
}

/**
 * Télé-réalité française : genre « Réalité », origine France, triée par popularité,
 * en gardant d'abord les émissions qui ont diffusé un épisode ces 90 derniers jours.
 */
async function realityTvFR(key, page = 1) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const base = {
    language: 'fr-FR', with_genres: '10764', with_origin_country: 'FR',
    with_original_language: 'fr', sort_by: 'popularity.desc', include_adult: 'false',
  };
  const recent = await discover(key, 'tv', { ...base, 'air_date.gte': since }, page);
  if (page > 1 || recent.length >= 8) return recent;
  const all = await discover(key, 'tv', base, page);
  const seen = new Set(recent.map((r) => r.id));
  return [...recent, ...all.filter((r) => !seen.has(r.id))].slice(0, 20);
}

async function nowPlayingFR(key) {
  const data = await get(key, '/movie/now_playing', { language: 'fr-FR', region: 'FR', page: 1 }, 6 * 3600);
  return ((data && data.results) || []).sort((a, b) => b.popularity - a.popularity);
}

/** IMDb id d'un titre TMDB (mis en cache longtemps : ça ne change pas). */
async function imdbId(key, kind, tmdbId) {
  const cacheKey = `imdb:${kind}:${tmdbId}`;
  return cache.wrap(cacheKey, 90 * DAY, async () => {
    const ext = await get(key, `/${kind}/${tmdbId}/external_ids`, {}, 90 * DAY);
    return (ext && ext.imdb_id) || '';
  }, true);
}

async function findByImdb(key, imdb) {
  const data = await get(key, `/find/${imdb}`, { external_source: 'imdb_id', language: 'fr-FR' }, 30 * DAY);
  if (!data) return null;
  if (data.movie_results && data.movie_results.length) return { kind: 'movie', id: data.movie_results[0].id };
  if (data.tv_results && data.tv_results.length) return { kind: 'tv', id: data.tv_results[0].id };
  return null;
}

async function watchProviderIdsFR(key, kind, tmdbId) {
  const data = await get(key, `/${kind}/${tmdbId}/watch/providers`, {}, DAY);
  const fr = data && data.results && data.results.FR;
  if (!fr) return [];
  return [...(fr.flatrate || []), ...(fr.free || []), ...(fr.ads || [])].map((p) => p.provider_id);
}

/** Comme normTitle, mais en gardant les articles. */
function normStrict(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Retrouve un titre TMDB à partir d'un nom (Netflix/FlixPatrol = anglais, Allociné = français).
 * kind : 'movie' | 'tv' | 'any'.
 * providerIds : gros bonus si le titre est bien sur cette plateforme en France.
 * recent : contexte « top du moment » → on favorise les sorties récentes.
 */
async function matchTitle(key, { title, kind = 'any', lang = 'en-US', providerIds = null, year = null, recent = false }) {
  const clean = String(title).replace(/:\s*(Season|Saison|Part|Partie|Volume|Limited Series|Mini-?series)\b.*$/i, '').trim();
  const cacheKey = `match3:${kind}:${(providerIds || []).join('|')}:${recent ? 'r' : ''}:${normStrict(clean)}:${year || ''}`;
  return cache.wrap(cacheKey, 14 * DAY, async () => {
    const kinds = kind === 'any' ? ['movie', 'tv'] : [kind];
    const langs = [...new Set([lang, lang === 'fr-FR' ? 'en-US' : 'fr-FR'])];
    const byId = new Map();
    for (const k of kinds) {
      for (const l of langs) {
        const data = await get(key, `/search/${k}`, { query: clean, language: l, include_adult: 'false' }, 7 * DAY).catch(() => null);
        for (const r of ((data && data.results) || []).slice(0, 10)) {
          const id = `${k}:${r.id}`;
          const prev = byId.get(id);
          byId.set(id, { ...(prev || {}), ...r, _kind: k, _names: [...((prev && prev._names) || []), r.title, r.name] });
        }
      }
    }
    const candidates = [...byId.values()];
    if (!candidates.length) return false; // false = « pas trouvé », mis en cache aussi

    const wanted = normTitle(clean);
    const wantedStrict = normStrict(clean);
    const now = Date.now();
    for (const c of candidates) {
      const rawNames = [...c._names, c.original_title, c.original_name].filter(Boolean);
      const names = rawNames.map(normTitle);
      const date = c.release_date || c.first_air_date || '';
      const ageDays = date ? (now - new Date(date).getTime()) / 86400000 : null;
      const y = Number(date.slice(0, 4)) || 0;
      let s = 0;
      if (names.includes(wanted)) s += 5;
      else if (names.some((n) => n && (n.startsWith(wanted) || wanted.startsWith(n)))) s += 2;
      // Articles compris : « The Final Destination » (2009) n'est pas « Final Destination » (2000).
      if (rawNames.some((n) => normStrict(n) === wantedStrict)) s += 1.5;
      s += Math.log10((c.popularity || 0) + 1);
      if (year && y && Math.abs(y - year) <= 1) s += 2;
      if (recent && ageDays != null) {
        if (ageDays <= 180) s += 2.5;
        else if (ageDays <= 730) s += 1;
        else if (ageDays > 1825) s -= 1;
      }
      c._score = s;
    }
    candidates.sort((a, b) => b._score - a._score);

    if (providerIds && providerIds.length) {
      // On vérifie la disponibilité pour tous les candidats plausibles (pas seulement les 3 premiers).
      const plausible = candidates.filter((c) => c._score >= 2).slice(0, 8);
      await mapLimit(plausible, 4, async (c) => {
        const ids = await watchProviderIdsFR(key, c._kind, c.id).catch(() => []);
        if (ids.some((id) => providerIds.includes(id))) c._score += 6;
      });
      candidates.sort((a, b) => b._score - a._score);
    }

    const best = candidates[0];
    if (best._score < 3) return false;
    return { kind: best._kind, id: best.id };
  }, true);
}

module.exports = {
  get, img, providerIdsFor, discoverParams, discover, collection, byCompanies, nowPlayingFR, trending, realityTvFR,
  imdbId, findByImdb, matchTitle, watchProviderIdsFR, DAY,
};
