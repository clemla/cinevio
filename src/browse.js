'use strict';

/**
 * Contenu des dossiers « Genres » et « Sagas ».
 *  - Genres : TMDB discover par genre, limité aux plateformes et chaînes choisies (dispo en France).
 *  - Sagas  : sagas TMDB et films des studios, dans l'ordre de sortie ; séries liées.
 */

const tmdb = require('./sources/tmdb');
const cache = require('./cache');
const { mapLimit } = require('./http');
const { ALL } = require('./platforms');

/** IDs de fournisseurs TMDB des services choisis (France). Vide = pas de filtre. */
async function providerIdsForConfig(key, serviceIds) {
  const services = ALL.filter((s) => serviceIds.includes(s.id));
  const lists = await Promise.all(services.map((s) => tmdb.providerIdsFor(key, s).catch(() => [])));
  return [...new Set(lists.flat())].sort((a, b) => a - b);
}

/** Une page d'un dossier de genre. row = popular | new | toprated. */
async function genrePage(key, genre, kind, row, providerIds, page = 1) {
  const genres = kind === 'movie' ? genre.movie : genre.tv;
  if (!genres.length) return [];
  const params = tmdb.discoverParams(kind, row, providerIds, { genres, excludeGenres: genre.exclude });
  return tmdb.discover(key, kind, params, page);
}

const byDate = (a, b) => {
  const da = a.release_date || a.first_air_date || '9999';
  const db = b.release_date || b.first_air_date || '9999';
  return da.localeCompare(db);
};

/** Tous les titres d'une saga pour un type (movie | tv), triés par date de sortie. Gardé 12 h. */
function sagaItems(key, saga, kind) {
  const spec = kind === 'movie' ? saga.movie : saga.tv;
  if (!spec) return Promise.resolve([]);
  return cache.wrap(`saga2:${saga.id}:${kind}`, 12 * 3600, async () => {
    let items = [];
    if (spec.collections) {
      const cols = await Promise.all(spec.collections.map((id) => tmdb.collection(key, id).catch(() => null)));
      items = cols.flatMap((c) => (c && c.parts) || []);
    }
    if (spec.companies) items.push(...await tmdb.byCompanies(key, kind, spec.companies, spec.minVotes));
    if (spec.ids) {
      const details = await mapLimit(spec.ids, 4, (id) => tmdb.get(key, `/${kind}/${id}`, { language: 'fr-FR' }).catch(() => null));
      items.push(...details.filter(Boolean));
    }
    const names = (r) => [r.title, r.name, r.original_title, r.original_name].filter(Boolean).join(' ');
    if (spec.include) items = items.filter((r) => spec.include.some((re) => re.test(names(r))));
    if (spec.exclude) items = items.filter((r) => !spec.exclude.some((re) => re.test(r.title || r.name || '') || re.test(r.original_title || r.original_name || '')));
    const seen = new Set();
    items = items.filter((r) => r && r.id && !seen.has(r.id) && seen.add(r.id));
    // Les titres sans date (annoncés) passent à la fin.
    return items.sort(byDate);
  }, true);
}

/**
 * Saga à ordre imposé (MCU) : références { kind, id } dans l'ordre de la liste, puis les sorties
 * du studio après followSince, par date. Gardé 12 h (les correspondances TMDB, 14 jours).
 */
async function timelineRefs(key, saga) {
  // Liste vide (TMDB injoignable) : pas gardée en cache, on réessaie au prochain appel.
  const refs = await cache.wrap(`saga2:${saga.id}:timeline:${saga.timeline.length}`, 12 * 3600, async () => {
    const refs = await mapLimit(saga.timeline, 4, (e) =>
      tmdb.matchTitle(key, { title: e.t, kind: e.k, year: e.y, lang: 'en-US' }).catch(() => null));
    const out = [];
    const seen = new Set();
    refs.forEach((r, i) => {
      if (!r) { console.warn(`[sagas] ${saga.id} : « ${saga.timeline[i].t} » introuvable sur TMDB`); return; }
      const k = `${r.kind}:${r.id}`;
      if (!seen.has(k)) { seen.add(k); out.push({ kind: r.kind, id: r.id }); }
    });
    if (saga.followCompanies) {
      const later = [];
      for (const kind of ['movie', 'tv']) {
        const items = await tmdb.byCompanies(key, kind, saga.followCompanies, 20).catch(() => []);
        for (const r of items) {
          const date = r.release_date || r.first_air_date || '';
          if (date >= saga.followSince && !seen.has(`${kind}:${r.id}`)) later.push({ kind, id: r.id, date });
        }
      }
      later.sort((a, b) => a.date.localeCompare(b.date)).forEach(({ kind, id }) => out.push({ kind, id }));
    }
    return out.length ? out : null;
  }, true);
  return refs || [];
}

/** Images pour la carte d'une saga : fond de la saga (sinon du titre le plus populaire) + affiches. */
async function sagaArt(key, saga) {
  if (saga.timeline) {
    const refs = await timelineRefs(key, saga);
    const details = (await mapLimit(refs, 6, (r) => tmdb.get(key, `/${r.kind}/${r.id}`, { language: 'fr-FR' }).catch(() => null)))
      .map((d, i) => d && { ...d, _kind: refs[i].kind }).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const out = (d) => (d.release_date || d.first_air_date || '9999') <= today;
    const popular = [...details].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    // Fond : l'affiche de groupe la plus marquante (Avengers), sinon le titre le plus populaire.
    const hero = details.find((d) => /avengers: endgame|avengers: infinity war/i.test(d.original_title || '')) || popular[0] || {};
    return {
      backdrop: hero.backdrop_path || null,
      posters: popular.filter((d) => d.poster_path).slice(0, 3).map((d) => d.poster_path),
      movies: details.filter((d) => d._kind === 'movie' && out(d)).length,
      series: details.filter((d) => d._kind === 'tv' && out(d)).length,
    };
  }
  let backdrop = null;
  if (saga.movie && saga.movie.collections) {
    const c = await tmdb.collection(key, saga.movie.collections[0]).catch(() => null);
    backdrop = c && c.backdrop_path;
  }
  const movies = await sagaItems(key, saga, 'movie').catch(() => []);
  const series = await sagaItems(key, saga, 'tv').catch(() => []);
  const popular = [...movies, ...series].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  if (!backdrop) backdrop = (popular.find((r) => r.backdrop_path) || {}).backdrop_path || null;
  // On ne compte que ce qui est sorti.
  const today = new Date().toISOString().slice(0, 10);
  const released = (r) => (r.release_date || r.first_air_date || '9999') <= today;
  return {
    backdrop,
    posters: popular.filter((r) => r.poster_path).slice(0, 3).map((r) => r.poster_path),
    movies: movies.filter(released).length,
    series: series.filter(released).length,
  };
}

module.exports = { providerIdsForConfig, genrePage, sagaItems, sagaArt, timelineRefs };
