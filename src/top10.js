'use strict';

/**
 * Top 10 par plateforme, box-office, et « Top 10 du moment ».
 *
 * Le Top 10 du moment cherche ce qui est EN TENDANCE, pas ce qui est installé depuis des mois :
 *
 *   score = présence × fraîcheur × élan × buzz
 *
 *   présence  : classements où le titre apparaît en France (poids de la plateforme × place)
 *   fraîcheur : film sorti il y a moins d'un an, série avec un épisode diffusé il y a moins
 *               de 5 mois ; au-delà le titre est écarté, et le score baisse avec l'âge
 *   élan      : titre entré récemment dans un top 10 (bonus) ; là depuis des mois (malus)
 *   buzz      : bonus si le titre figure aussi dans les tendances TMDB du jour
 */

const tmdb = require('./sources/tmdb');
const flixpatrol = require('./sources/flixpatrol');
const netflix = require('./sources/netflix');
const boxoffice = require('./sources/boxoffice');
const cache = require('./cache');
const fs = require('fs');
const path = require('path');
const { mapLimit, normTitle } = require('./http');
const { PLATFORMS, CHANNELS, CINEMA_WEIGHT, REALITY_EXTRA_FP } = require('./platforms');

const REFRESH = Number(process.env.FLIXPATROL_REFRESH_HOURS || 12) * 3600;
const MAX_AGE = {
  movie: Number(process.env.TREND_MAX_AGE_MOVIE_DAYS || 365),
  tv: Number(process.env.TREND_MAX_AGE_TV_DAYS || 150),
};
const FULL_FRESH = { movie: 60, tv: 30 };

const refKey = (r) => `${r.kind}:${r.id}`;
/** Durée de cache d'un résultat de repli (FlixPatrol indisponible) : on retente plus tôt. */
const FALLBACK_TTL = 30 * 60;
const isFallback = (source) => !['flixpatrol', 'netflix', 'allocine'].includes(source);

/** Comme cache.wrap, mais un résultat de repli n'est gardé que FALLBACK_TTL. */
async function wrapShort(key, ttl, fn, fallbackOf) {
  const value = await cache.wrap(key, ttl, fn, true);
  if (value && fallbackOf(value) && cache.get(key) !== undefined && !value._short) {
    cache.set(key, { ...value, _short: true }, FALLBACK_TTL, true);
  }
  return value;
}

/**
 * Corrections manuelles : data/corrections.json
 *   { "the-final-destination": "movie:19912", "Paris Has Fallen": "tv:123456", "marrakech-comedy-festival": null }
 * Clé = identifiant FlixPatrol (visible dans /api/top10?service=…) ou titre ; null = ignorer ce titre.
 */
const CORRECTIONS_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'corrections.json');
let corrections = { mtime: -1, map: new Map() };
function loadCorrections() {
  let mtime = 0;
  try { mtime = fs.statSync(CORRECTIONS_FILE).mtimeMs; } catch { /* pas de fichier */ }
  if (mtime === corrections.mtime) return corrections;
  const map = new Map();
  if (mtime) {
    try {
      const raw = JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8'));
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith('_')) continue; // commentaires
        const m = /^(movie|tv|film|serie|series):(\d+)$/i.exec(String(v || ''));
        const ref = m ? { kind: /^(movie|film)$/i.test(m[1]) ? 'movie' : 'tv', id: Number(m[2]) } : false;
        if (v !== null && !m) { console.warn(`[corrections] valeur ignorée pour « ${k} » : ${v} (attendu movie:123 ou tv:456)`); continue; }
        map.set(k.toLowerCase(), ref);
        map.set(normTitle(k), ref);
      }
    } catch (err) {
      console.warn('[corrections] data/corrections.json illisible :', err.message);
    }
  }
  corrections = { mtime, map };
  return corrections;
}
const correctionsSignature = () => String(Math.round(loadCorrections().mtime));

/** Titre FlixPatrol/Netflix → { kind, id } TMDB, en passant d'abord par les corrections manuelles. */
async function matchItem(key, item, opts) {
  const { map } = loadCorrections();
  for (const k of [item.slug && item.slug.toLowerCase(), item.title && item.title.toLowerCase(), normTitle(item.title)]) {
    if (k && map.has(k)) return map.get(k) || null;
  }
  const year = flixpatrol.slugYear(item.slug) || opts.year || null;
  return tmdb.matchTitle(key, { title: item.title, ...opts, year });
}

/** Repère de version d'un classement : change dès qu'il est relu. */
const chartStamp = (chart) => (chart ? `${chart.source || ''}${chart.fetchedAt || chart.week || ''}` : 'none');
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function dedupe(refs) {
  const seen = new Set();
  return refs.filter((r) => r && !seen.has(refKey(r)) && seen.add(refKey(r)));
}

/** Classement brut d'un service : Netflix officiel pour Netflix, sinon FlixPatrol. */
async function rawChart(service, options) {
  if (service.id === 'netflix') {
    const official = await netflix.franceTop10();
    if (official) return { movies: official.movies, shows: official.shows, overall: [], source: 'netflix', fetchedAt: official.fetchedAt };
  }
  const fp = await flixpatrol.top10(service.fp, options);
  return fp ? { ...fp, source: 'flixpatrol' } : null;
}

/** Top 10 d'un service. kind = 'movie' | 'tv'. Renvoie { refs, source } ; chaque ref peut porter `days`. */
async function serviceTop10(key, service, kind) {
  // Le classement est lu d'abord : la clé change dès qu'il est relu, le résultat suit tout seul.
  const chart = await rawChart(service).catch(() => null);
  const stamp = `${chartStamp(chart)}:${flixpatrol.importSignature()}:${correctionsSignature()}`;
  return wrapShort(`top10v4:${service.id}:${kind}:${shortHash(stamp)}`, REFRESH, async () => {
    const providerIds = await tmdb.providerIdsFor(key, service);

    let refs = [];
    if (chart) {
      const direct = kind === 'movie' ? chart.movies : chart.shows;
      const useOverall = !direct.length && chart.overall.length;
      const list = useOverall ? chart.overall : direct;
      const matched = await mapLimit(list, 4, (item) =>
        matchItem(key, item, { kind: useOverall ? 'any' : kind, providerIds, recent: true }));
      refs = dedupe(matched.map((r, i) => (r && r.kind === kind ? { ...r, days: list[i].days } : null)));
    }
    if (refs.length >= 5) return { refs: refs.slice(0, 10), source: chart.source, stale: !!chart.stale };

    // Repli : ce qui vit en ce moment sur la plateforme en France (TMDB), jamais les vieux classiques.
    if (!providerIds.length && !(kind === 'tv' && service.networks)) return { refs, source: refs.length ? 'mixte' : 'aucune' };
    const results = await tmdb.discover(key, kind, tmdb.discoverParams(kind, 'now', providerIds, { networks: service.networks }));
    const fallback = results.slice(0, 10).map((r) => ({ kind, id: r.id }));
    return { refs: dedupe([...refs, ...fallback]).slice(0, 10), source: refs.length ? 'mixte' : 'tmdb' };
  }, (v) => isFallback(v.source));
}

/** Box-office France de la semaine. */
async function cinemaTop10(key) {
  return cache.wrap('top10v2:cinema', REFRESH, async () => {
    const bo = await boxoffice.weekly();
    if (bo) {
      const year = new Date().getFullYear();
      const matched = await mapLimit(bo.list, 4, (item) =>
        tmdb.matchTitle(key, { title: item.title, kind: 'movie', lang: 'fr-FR', year, recent: true }));
      const refs = dedupe(matched.filter(Boolean));
      if (refs.length >= 5) return { refs: refs.slice(0, 10), source: 'allocine' };
    }
    const playing = await tmdb.nowPlayingFR(key);
    return { refs: playing.slice(0, 10).map((r) => ({ kind: 'movie', id: r.id })), source: 'tmdb' };
  }, true);
}

/** Âge en jours de la sortie la plus récente : date de sortie (film) ou dernier épisode diffusé (série). */
function ageInDays(details, kind, now = Date.now()) {
  if (!details) return null;
  let date;
  if (kind === 'movie') date = details.release_date;
  else {
    const next = details.next_episode_to_air && details.next_episode_to_air.air_date;
    const last = (details.last_episode_to_air && details.last_episode_to_air.air_date) || details.last_air_date;
    // Série dont un épisode sort cette semaine : considérée comme en cours.
    if (next && new Date(next).getTime() - now < 7 * 86400000) date = next;
    else date = last;
  }
  if (!date) return null;
  return Math.max(0, Math.round((now - new Date(date).getTime()) / 86400000));
}

/** 1 tant que c'est récent, puis décroît jusqu'à 0,4 à l'âge limite ; null = trop vieux. */
function freshness(age, kind) {
  if (age == null) return 0.5;
  const max = MAX_AGE[kind];
  const full = FULL_FRESH[kind];
  if (age > max) return null;
  if (age <= full) return 1;
  return 1 - 0.6 * ((age - full) / (max - full));
}

/** Nouveau dans le top 10 = bonus, installé depuis longtemps = malus. */
function momentum(days) {
  if (days == null) return 1;
  if (days <= 7) return 1.35;
  if (days <= 21) return 1.1;
  if (days > 60) return 0.7;
  return 1;
}

/**
 * Calcule le classement de tendance.
 * inputs : [{ weight, refs }] ; details : Map refKey → détails TMDB ; trendingIds : ids TMDB du jour.
 */
function rankTrending(inputs, kind, details, trendingIds = [], now = Date.now()) {
  const pool = new Map();
  for (const { weight, refs } of inputs) {
    refs.slice(0, 10).forEach((ref, i) => {
      const k = refKey(ref);
      const cur = pool.get(k) || { ref, presence: 0, days: null, best: 99 };
      cur.presence += weight * ((10 - i) / 10);
      cur.best = Math.min(cur.best, i + 1);
      if (ref.days != null) cur.days = cur.days == null ? ref.days : Math.min(cur.days, ref.days);
      pool.set(k, cur);
    });
  }

  const trendPos = new Map(trendingIds.slice(0, 40).map((id, i) => [id, i]));
  const scored = [];
  for (const entry of pool.values()) {
    const age = ageInDays(details.get(refKey(entry.ref)), kind, now);
    const fresh = freshness(age, kind);
    if (fresh == null) continue; // trop vieux : écarté
    const pos = trendPos.get(entry.ref.id);
    const buzz = pos == null ? 1 : 1 + 0.5 * ((40 - pos) / 40);
    entry.age = age;
    entry.score = entry.presence * fresh * momentum(entry.days) * buzz;
    scored.push(entry);
  }
  return scored.sort((a, b) => b.score - a.score || a.best - b.best);
}

/** « Top 10 du moment ». kind = 'movie' (plateformes + cinéma) | 'tv'. */
async function mergedTop10(key, kind) {
  const weighted = PLATFORMS.filter((p) => p.weight > 0);
  const charts = await Promise.all(weighted.map((p) => rawChart(p).catch(() => null)));
  const stamp = `${charts.map(chartStamp).join('|')}:${flixpatrol.importSignature()}:${correctionsSignature()}`;
  return wrapShort(`top10v4:trend:${kind}:${shortHash(stamp)}`, REFRESH, async () => {
    const inputs = [];
    const lists = await Promise.all(weighted.map((p) => serviceTop10(key, p, kind).catch(() => null)));
    weighted.forEach((p, i) => lists[i] && inputs.push({ weight: p.weight, refs: lists[i].refs, name: p.name, source: lists[i].source }));
    if (kind === 'movie') {
      const cine = await cinemaTop10(key).catch(() => null);
      if (cine) inputs.push({ weight: CINEMA_WEIGHT, refs: cine.refs, name: 'Cinéma' });
    }

    const all = dedupe(inputs.flatMap((i) => i.refs));
    const details = new Map();
    await mapLimit(all, 8, async (ref) => {
      const d = await tmdb.get(key, `/${ref.kind}/${ref.id}`, { language: 'fr-FR' }).catch(() => null);
      details.set(refKey(ref), d);
    });
    const trendingIds = await tmdb.trending(key, kind).catch(() => []);
    const ranked = rankTrending(inputs, kind, details, trendingIds);

    return {
      refs: ranked.slice(0, 10).map((e) => ({ kind: e.ref.kind, id: e.ref.id })),
      sources: inputs.map((i) => `${i.name} (${i.source || 'cinéma'})`),
      partial: inputs.some((i) => i.source && isFallback(i.source)),
      debug: ranked.slice(0, 15).map((e) => ({
        id: e.ref.id, title: details.get(refKey(e.ref))?.title || details.get(refKey(e.ref))?.name,
        score: Number(e.score.toFixed(3)), age: e.age, days: e.days,
      })),
    };
  }, (v) => v.partial);
}

/**
 * Télé-réalité en tendance : émissions de télé-réalité françaises présentes dans les
 * classements du moment (Netflix, Prime, Disney+, Canal+, HBO Max, TF1+, M6+, france.tv).
 */
async function realityTrending(key) {
  const platforms = PLATFORMS.filter((x) => x.id !== 'crunchyroll');
  const raws = await Promise.all(platforms.map((p) => rawChart(p).catch(() => null)));
  const extras = await Promise.all(REALITY_EXTRA_FP.map((slug) => flixpatrol.top10(slug).catch(() => null)));
  const stamp = `${[...raws, ...extras].map(chartStamp).join('|')}:${flixpatrol.importSignature()}:${correctionsSignature()}`;
  return cache.wrap(`reality3:trending:${shortHash(stamp)}`, REFRESH, async () => {
    const charts = [];
    for (let i = 0; i < platforms.length; i++) {
      const chart = raws[i];
      if (chart) charts.push({ list: [...chart.shows, ...chart.overall], providerIds: await tmdb.providerIdsFor(key, platforms[i]), kind: chart.overall.length && !chart.shows.length ? 'any' : 'tv' });
    }
    for (const fp of extras) {
      if (fp) charts.push({ list: [...fp.shows, ...fp.overall], providerIds: null, kind: 'any' });
    }

    const scores = new Map();
    for (const chart of charts) {
      const matched = await mapLimit(chart.list.slice(0, 10), 4, (item) =>
        matchItem(key, item, { kind: chart.kind, providerIds: chart.providerIds, recent: true, lang: 'fr-FR' }));
      matched.forEach((ref, i) => {
        if (!ref || ref.kind !== 'tv') return;
        const cur = scores.get(ref.id) || { ref, score: 0 };
        cur.score += 10 - i;
        scores.set(ref.id, cur);
      });
    }
    const ranked = [...scores.values()].sort((a, b) => b.score - a.score);
    const keep = [];
    await mapLimit(ranked, 6, async (e) => {
      const d = await tmdb.get(key, `/tv/${e.ref.id}`, { language: 'fr-FR' }).catch(() => null);
      if (!d) return;
      const reality = d.type === 'Reality' || (d.genres || []).some((g) => g.id === 10764);
      const french = d.original_language === 'fr' || (d.origin_country || []).some((c) => ['FR', 'BE', 'CH'].includes(c));
      if (reality && french) keep.push(e);
    });
    keep.sort((a, b) => b.score - a.score);
    return { refs: keep.map((e) => e.ref) };
  }, true);
}

/** « Bientôt sur … » : titres annoncés par FlixPatrol, retrouvés dans TMDB. */
async function comingSoon(key, service, kind) {
  const coming = await flixpatrol.comingSoon(service.fp).catch(() => null);
  const stamp = `${coming ? coming.fetchedAt : 'none'}:${flixpatrol.importSignature()}:${correctionsSignature()}`;
  const soonKey = `soon3:${service.id}:${kind}:${shortHash(stamp)}`;
  return wrapShort(soonKey, 24 * 3600, async () => {
    if (!coming) return { refs: [], source: 'aucune' };
    const year = new Date().getFullYear();
    const items = coming.list.filter((x) => !x.kind || x.kind === kind);
    // Film : année de sortie annoncée. Série : la saison qui arrive ne dit rien de l'année de la série.
    const matched = await mapLimit(items, 4, (item) =>
      matchItem(key, item, { kind, year: kind === 'movie' ? item.year || year : null }));
    return { refs: dedupe(matched.filter(Boolean)).slice(0, 20), source: 'flixpatrol' };
  }, (v) => v.source !== 'flixpatrol');
}

/**
 * Précharge tout en tâche de fond, au démarrage puis toutes les heures (quasi gratuit quand tout est frais) :
 * pages FlixPatrol (top 10 puis « Bientôt »), classements fusionnés, télé-réalité, rangées « Bientôt ».
 * Les rangées de Nuvio n'ont ainsi jamais à attendre le navigateur.
 */
function schedule(getKey) {
  let running = false;
  const run = async () => {
    const key = getKey();
    if (!key || running) return;
    running = true;
    // Cartes qui n'ont pas besoin des Top 10 (chaînes, genres, sagas, animés) : tout de suite, en même
    // temps que la lecture des classements (les cartes ont leur propre navigateur).
    const covers = require('./covers');
    const browse = require('./browse');
    const deps = { serviceTop10, sagaArt: browse.sagaArt };
    const early = covers.refresh(key, deps, { only: (spec) => !covers.needsTop10(spec) })
      .catch((err) => console.warn('[cartes]', err.message));
    try {
      const all = { wait: Infinity };
      for (const p of PLATFORMS.filter((x) => x.fp && x.id !== 'netflix')) await flixpatrol.top10(p.fp, all).catch(() => null);
      for (const slug of REALITY_EXTRA_FP) await flixpatrol.top10(slug, all).catch(() => null);
      await Promise.all([mergedTop10(key, 'movie'), mergedTop10(key, 'tv')]);
      await realityTrending(key);
      // Top 10 des chaînes (pages déjà lues pour la télé-réalité) : correspondances TMDB prêtes d'avance.
      for (const c of CHANNELS.filter((x) => x.fp)) {
        for (const kind of (c.types || ['movie', 'series']).map((t) => (t === 'series' ? 'tv' : 'movie'))) {
          await serviceTop10(key, c, kind).catch(() => null);
        }
      }
      for (const p of PLATFORMS.filter((x) => x.fp)) {
        await flixpatrol.comingSoon(p.fp, all).catch(() => null);
        for (const kind of (p.types || ['movie', 'series']).map((t) => (t === 'series' ? 'tv' : 'movie'))) {
          await comingSoon(key, p, kind).catch(() => null);
        }
      }
      console.log('[top10] classements à jour');
      // Puis les cartes des plateformes, avec les affiches de leur Top 10 (les autres sont déjà à jour).
      await early;
      await covers.refresh(key, deps, { only: covers.needsTop10 }).catch((err) => console.warn('[cartes]', err.message));
    } catch (err) {
      console.warn('[top10] échec du rafraîchissement :', err.message);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 3000).unref();
  setInterval(run, 3600 * 1000).unref();
  return run; // pour relancer tout de suite (clé TMDB arrivée par la page de configuration)
}

module.exports = {
  serviceTop10, cinemaTop10, mergedTop10, comingSoon, schedule, realityTrending, rawChart,
  rankTrending, ageInDays, freshness, momentum, matchItem, loadCorrections, CORRECTIONS_FILE,
};
