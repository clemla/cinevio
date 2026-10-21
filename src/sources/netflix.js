'use strict';

/**
 * Top 10 officiel de Netflix pour la France (publié chaque mardi par Netflix).
 * Fichier : https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv
 * Colonnes utilisées (repérées par leur nom) : country_iso2, week, category,
 * weekly_rank, show_title, season_title, cumulative_weeks_in_top_10.
 *
 * Le fichier est gros (tout l'historique mondial) : on le lit en flux et on ne garde
 * que la dernière semaine française. Mis en cache 24 h.
 */

const cache = require('../cache');
const { UA } = require('../http');

const URL = process.env.NETFLIX_TOP10_URL || 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv';
const DISABLED = process.env.NETFLIX_TOP10_DISABLED === '1';

let lastStatus = { ok: null, detail: 'pas encore essayé' };

async function fetchFranceRows() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(URL, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let header = null;
    const rows = [];
    let maxWeek = '';
    const handle = (line) => {
      if (!line) return;
      const cells = line.split('\t');
      if (!header) { header = cells.map((h) => h.trim().toLowerCase()); return; }
      const get = (name) => cells[header.indexOf(name)];
      if (get('country_iso2') !== 'FR') return;
      const week = get('week');
      if (week > maxWeek) maxWeek = week;
      rows.push({
        week,
        category: get('category') || '',
        rank: Number(get('weekly_rank')),
        title: (get('show_title') || '').trim(),
        season: (get('season_title') || '').trim(),
        weeks: Number(get('cumulative_weeks_in_top_10')) || null,
      });
    };
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, idx).replace(/\r$/, ''));
        buffer = buffer.slice(idx + 1);
      }
    }
    handle(buffer.trim());
    if (!header || !header.includes('country_iso2')) throw new Error('colonnes inattendues : ' + (header || []).join(','));
    return { week: maxWeek, rows: rows.filter((r) => r.week === maxWeek) };
  } finally {
    clearTimeout(timer);
  }
}

/** { week, movies: [{rank,title,weeks}], shows: [...] } ou null. */
async function franceTop10() {
  if (DISABLED) return null;
  return cache.wrap('netflix:top10:fr', 24 * 3600, async () => {
    try {
      const { week, rows } = await fetchFranceRows();
      const pick = (isFilm) => rows
        .filter((r) => /film/i.test(r.category) === isFilm)
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({ rank: r.rank, title: r.title, season: r.season, days: r.weeks ? r.weeks * 7 : null }));
      const result = { week, movies: pick(true), shows: pick(false), fetchedAt: new Date().toISOString() };
      lastStatus = { ok: true, detail: `semaine du ${week} : ${result.movies.length} films, ${result.shows.length} séries` };
      return result.movies.length + result.shows.length ? result : null;
    } catch (err) {
      lastStatus = { ok: false, detail: err.message };
      console.warn('[netflix] top 10 officiel indisponible :', err.message);
      return null;
    }
  }, true);
}

module.exports = { franceTop10, status: () => lastStatus };
