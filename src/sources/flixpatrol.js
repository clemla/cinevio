'use strict';

/**
 * Lecture des top 10 publics de FlixPatrol pour la France.
 *
 * ⚠️ Ces données sont le produit commercial de FlixPatrol (ils vendent une API).
 *    On reste sobre : une lecture par plateforme toutes les FLIXPATROL_REFRESH_HOURS,
 *    mise en cache sur disque, et repli sur TMDB si la page change ou bloque.
 *    Ce module est isolé pour pouvoir passer à leur API payante sans toucher au reste.
 */

const { request, stripTags, decodeEntities } = require('../http');
const cache = require('../cache');
const browser = require('./browser');

const fs = require('fs');
const path = require('path');

const BASE = process.env.FLIXPATROL_BASE || 'https://flixpatrol.com'; // modifiable pour les tests
const DEBUG_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'debug');
const statuses = {};

/**
 * Import manuel : pages FlixPatrol enregistrées depuis ton navigateur (Ctrl+S) dans data/import/.
 * Le nom du fichier doit contenir l'identifiant de la plateforme (ex. « amazon-prime.html »).
 */
const IMPORT_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'import');
const IMPORT_MAX_AGE_DAYS = Number(process.env.IMPORT_MAX_AGE_DAYS || 7);

function importFiles() {
  try {
    return fs.readdirSync(IMPORT_DIR)
      .filter((f) => /\.html?$/i.test(f))
      .map((f) => ({ name: f, full: path.join(IMPORT_DIR, f), mtime: fs.statSync(path.join(IMPORT_DIR, f)).mtimeMs }));
  } catch {
    return [];
  }
}

/** Signature des fichiers importés : change dès qu'un fichier est ajouté ou remplacé (invalide le cache). */
function importSignature() {
  return importFiles().map((f) => `${f.name}@${Math.round(f.mtime)}`).sort().join(',') || 'aucun';
}

/** Les « coming » (bientôt) se reconnaissent à « coming » dans le nom du fichier. */
function findImport(slug, coming = false) {
  const files = importFiles()
    .filter((f) => {
      const n = f.name.toLowerCase();
      const hasSlug = n.includes(slug) || n.replace(/[^a-z0-9]/g, '').includes(slug.replace(/[^a-z0-9]/g, ''));
      return hasSlug && /coming|bientot/.test(n) === coming;
    })
    .filter((f) => Date.now() - f.mtime < IMPORT_MAX_AGE_DAYS * 86400000)
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

/** Garde la page reçue quand la lecture échoue, pour pouvoir l'analyser. */
function dump(name, html) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, `${name}.html`), html || '');
  } catch { /* sans importance */ }
}
const REFRESH_H = Number(process.env.FLIXPATROL_REFRESH_HOURS || 12);
const DISABLED = process.env.FLIXPATROL_DISABLED === '1';

/**
 * Mode de lecture : auto (défaut) = lecture directe, puis vrai navigateur (Chrome/Edge) si la
 * protection Cloudflare bloque ; browser = toujours le navigateur ; direct = jamais le navigateur.
 */
const FETCH_MODE = String(process.env.FLIXPATROL_FETCH || 'auto').toLowerCase();
const BLOCKED_RE = /cf-chl|challenge-platform|Just a moment|Attention Required|cf_chl_opt/i;
/** Après un échec, on attend avant de réessayer (évite de relancer le navigateur à chaque requête). */
const RETRY_AFTER_MS = Number(process.env.FLIXPATROL_RETRY_MINUTES || 30) * 60000;
const failedUntil = {};
let directBlocked = FETCH_MODE === 'browser';

let directQueue = Promise.resolve();
function directTurn() {
  let release;
  const turn = new Promise((r) => { release = r; });
  const ready = directQueue.then(() => release);
  directQueue = directQueue.then(() => turn);
  return ready;
}

/**
 * Récupère une page FlixPatrol. Renvoie { html, via } si la page est lisible,
 * sinon { html, via, error, blocked }.
 */
async function getPage(url, { minLinks = 3 } = {}) {
  // Lectures directes une par une : dès la première bloquée, les suivantes passent au navigateur.
  if (FETCH_MODE !== 'browser' && !directBlocked) {
    const release = await directTurn();
    try {
      if (directBlocked) throw new Error('bloqué');
      const { status, body } = await request(url, { as: 'text', timeout: 15000, retries: 0, raw: true });
      const blocked = BLOCKED_RE.test(body || '') || status === 403 || status === 503;
      if (status === 200 && !blocked) return { html: body, via: 'direct' };
      if (!blocked) return { html: body, via: 'direct', error: `HTTP ${status}` };
      if (FETCH_MODE === 'direct') return { html: body, via: 'direct', blocked: true, error: `bloqué par la protection anti-robots (HTTP ${status})` };
      directBlocked = true; // plus la peine d'essayer en direct pendant cette session
      console.log('[flixpatrol] protection anti-robots : passage par le navigateur');
    } catch (err) {
      if (FETCH_MODE === 'direct') return { html: '', via: 'direct', error: err.message };
    } finally {
      release();
    }
  }
  if (FETCH_MODE === 'direct') return { html: '', via: 'direct', blocked: true, error: 'bloqué par la protection anti-robots' };

  try {
    const r = await browser.fetchHtml(url, {
      // Page chargée = titre FlixPatrol (la vérification s'appelle « Just a moment » / « Un instant »).
      ready: (st) => st.links >= minLinks || /FlixPatrol|not found|404|error/i.test(st.title || ''),
    });
    if (r.challenge) return { html: r.html, via: r.via, blocked: true, error: `${r.via} : vérification anti-robots non résolue` };
    return { html: r.html, via: r.via };
  } catch (err) {
    return { html: '', via: 'navigateur', fatal: true, error: `navigateur : ${err.message}` };
  }
}

const SECTION_RE = /TOP 10 (Movies|TV Shows|Overall|Kids Movies|Kids TV Shows)/g;
// Liens relatifs (/title/…) ou absolus (page enregistrée depuis le navigateur).
// Accepte aussi les sous-pages (/title/<id>/streaming/ sur les pages « Bientôt »).
const TITLE_LINK_RE = /<a[^>]+href="(?:https?:\/\/(?:www\.)?flixpatrol\.com)?\/title\/([^"/]+)(?:\/[^"]*)?"[^>]*>([\s\S]*?)<\/a>/g;

function extractTitles(chunk, max = 10) {
  const hits = [];
  let m;
  TITLE_LINK_RE.lastIndex = 0;
  while ((m = TITLE_LINK_RE.exec(chunk))) hits.push({ slug: m[1], html: m[2], start: m.index, end: m.index + m[0].length });

  const out = [];
  const seen = new Set();
  hits.forEach((h, i) => {
    if (out.length >= max) return;
    const title = stripTags(h.html);
    if (!title || seen.has(h.slug)) return;
    seen.add(h.slug);
    // Après le titre, FlixPatrol affiche depuis combien de jours il est dans le top (« 3 d »).
    const tail = stripTags(chunk.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : h.end + 400));
    const days = /(\d+)\s*d\b/.exec(tail);
    out.push({ rank: out.length + 1, title: decodeEntities(title), slug: h.slug, days: days ? Number(days[1]) : null });
  });
  return out;
}

/** Découpe la page par sections « TOP 10 Movies / TV Shows / Overall ». */
function parseTop10Page(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const marks = [];
  let m;
  SECTION_RE.lastIndex = 0;
  while ((m = SECTION_RE.exec(body))) marks.push({ label: m[1], index: m.index });

  const result = { movies: [], shows: [], overall: [] };
  // On garde la première occurrence de chaque section (le tableau du jour).
  const used = new Set();
  marks.forEach((mark, i) => {
    if (used.has(mark.label)) return;
    const end = i + 1 < marks.length ? marks[i + 1].index : body.length;
    const list = extractTitles(body.slice(mark.index, end));
    if (!list.length) return;
    used.add(mark.label);
    if (mark.label === 'Movies') result.movies = list;
    else if (mark.label === 'TV Shows') result.shows = list;
    else if (mark.label === 'Overall') result.overall = list;
  });
  return result;
}

function dateStr(offsetDays) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Dernier bon classement gardé ce nombre d'heures, pour remplacer un classement périmé ou en échec. */
const KEEP_LAST_H = Number(process.env.FLIXPATROL_KEEP_LAST_HOURS || 72);
/** Attente max d'une lecture quand on n'a encore rien à afficher (les rangées de Nuvio n'attendent pas longtemps). */
const WAIT_MS = Number(process.env.FLIXPATROL_WAIT_SECONDS || 8) * 1000;
const refreshing = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref());

/** Lance (une seule fois à la fois) la lecture d'une page et range le résultat. */
function refreshRead(key, lastKey, ttlH, fetcher) {
  if (refreshing.has(key)) return refreshing.get(key);
  if (failedUntil[key] > Date.now()) return Promise.resolve(null);
  const job = (async () => {
    try {
      const value = await fetcher();
      if (value) {
        cache.set(key, value, ttlH * 3600, true);
        cache.set(lastKey, value, Math.max(KEEP_LAST_H, ttlH) * 3600, true);
        cache.save(); // écrit tout de suite : rien à relire si l'appli est fermée puis rouverte
        return value;
      }
    } catch (err) {
      console.warn(`[flixpatrol] ${key} : ${err.message}`);
    } finally {
      refreshing.delete(key);
    }
    failedUntil[key] = Date.now() + RETRY_AFTER_MS;
    return null;
  })();
  refreshing.set(key, job);
  return job;
}

/**
 * Lecture qui ne fait jamais attendre pour rien :
 *  - résultat frais en cache → renvoyé tel quel ;
 *  - sinon le dernier bon résultat (≤ KEEP_LAST_H) est renvoyé tout de suite (stale: true)
 *    et la mise à jour se fait en arrière-plan ;
 *  - rien du tout → on attend la lecture au plus `wait` ms (Infinity = jusqu'au bout).
 */
async function cachedRead(type, slug, ttlH, fetcher, wait) {
  const key = `fp2:${type}:${slug}`;
  const lastKey = `fp2:last:${type}:${slug}`;
  const fresh = cache.get(key);
  if (fresh !== undefined) {
    if (cache.get(lastKey) === undefined) cache.set(lastKey, fresh, Math.max(KEEP_LAST_H, ttlH) * 3600, true);
    return fresh;
  }
  const last = cache.get(lastKey);
  const job = refreshRead(key, lastKey, ttlH, fetcher);
  if (wait === Infinity) return (await job) || (last ? { ...last, stale: true } : null);
  if (last !== undefined) return { ...last, stale: true };
  return Promise.race([job, sleep(wait).then(() => null)]);
}

/**
 * Top 10 d'une plateforme en France : { movies, shows, overall, fetchedAt }. Aujourd'hui, sinon la veille.
 * options.wait : attente max si rien n'est encore en cache (défaut FLIXPATROL_WAIT_SECONDS, Infinity = tout attendre).
 */
async function top10(slug, { wait = WAIT_MS } = {}) {
  if (!slug) return null;
  const imported = findImport(slug);
  if (imported) {
    const parsed = parseTop10Page(fs.readFileSync(imported.full, 'utf8'));
    const count = parsed.movies.length + parsed.shows.length + parsed.overall.length;
    statuses[slug] = count >= 3
      ? { ok: true, detail: `fichier importé ${imported.name} : ${parsed.movies.length} films, ${parsed.shows.length} séries, ${parsed.overall.length} général` }
      : { ok: false, detail: `fichier importé ${imported.name} illisible (aucun classement reconnu)` };
    if (count >= 3) return { ...parsed, fetchedAt: new Date(imported.mtime).toISOString(), url: imported.name };
  }
  if (DISABLED) return null;
  return cachedRead('top10', slug, REFRESH_H, () => fetchTop10(slug), wait);
}

async function fetchTop10(slug) {
  const urls = [`${BASE}/top10/${slug}/france/`, `${BASE}/top10/${slug}/france/${dateStr(1)}/`];
  for (const url of urls) {
    const page = await getPage(url);
    if (!page.error) {
      const parsed = parseTop10Page(page.html);
      const count = parsed.movies.length + parsed.shows.length + parsed.overall.length;
      if (count >= 3) {
        statuses[slug] = { ok: true, detail: `${parsed.movies.length} films, ${parsed.shows.length} séries, ${parsed.overall.length} général (via ${page.via})` };
        return { ...parsed, fetchedAt: new Date().toISOString(), url };
      }
      statuses[slug] = { ok: false, detail: `page reçue via ${page.via} (${page.html.length} caractères) mais aucun classement reconnu` };
    } else {
      statuses[slug] = { ok: false, detail: page.error };
      console.warn(`[flixpatrol] ${slug} : ${page.error}`);
    }
    if (page.html) dump(`flixpatrol-${slug}`, page.html);
    if (page.fatal || page.blocked) break; // inutile d'essayer la veille
  }
  return null;
}

/**
 * « Bientôt sur … » : page /streaming/<slug>/france/coming/.
 * Chaque fiche : affiche (lien), « 11/20/2026 | season 3 », titre (lien), « TV Show | United States | … ».
 * Entrée renvoyée : { title, slug, kind: 'movie' | 'tv' | null, date: 'AAAA-MM-JJ' | null, year, season }.
 */
function parseComingPage(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '');
  const re = new RegExp(TITLE_LINK_RE.source, 'g');
  const hits = [];
  let m;
  while ((m = re.exec(body))) hits.push({ slug: m[1], title: decodeEntities(stripTags(m[2])), start: m.index, end: m.index + m[0].length });

  const out = [];
  const seen = new Set();
  hits.forEach((h, i) => {
    if (!h.title || seen.has(h.slug) || out.length >= 40) return;
    seen.add(h.slug);
    const prevEnd = i > 0 ? hits[i - 1].end : Math.max(0, h.start - 300);
    const next = hits.slice(i + 1).find((x) => x.slug !== h.slug);
    const before = stripTags(body.slice(prevEnd, h.start));
    const after = stripTags(body.slice(h.end, Math.min(next ? next.start : body.length, h.end + 1500))).slice(0, 120);
    const kind = /^\W*TV Show\b/i.test(after) || /\bTV Show\b/i.test(after.slice(0, 40)) ? 'tv'
      : /^\W*Movie\b/i.test(after) || /\bMovie\b/i.test(after.slice(0, 40)) ? 'movie' : null;
    const d = /(\d{2})\/(\d{2})\/(\d{4})/.exec(before);
    const y = d ? Number(d[3]) : (/(\d{4})\+/.exec(before) || [])[1];
    const season = /season\s+(\d+)/i.exec(before);
    out.push({
      title: h.title,
      slug: h.slug,
      kind,
      date: d ? `${d[3]}-${d[1]}-${d[2]}` : null,
      year: y ? Number(y) : null,
      season: season ? Number(season[1]) : null,
    });
  });
  return out;
}

/** « Bientôt sur … » : { list, fetchedAt } ou null. Même mécanique que top10 (gardé 24 h). */
async function comingSoon(slug, { wait = WAIT_MS } = {}) {
  if (!slug) return null;
  const imported = findImport(slug, true);
  if (imported) {
    const list = parseComingPage(fs.readFileSync(imported.full, 'utf8'));
    if (list.length) return { list, fetchedAt: new Date(imported.mtime).toISOString() };
  }
  if (DISABLED) return null;
  return cachedRead('coming2', slug, 24, async () => {
    const page = await getPage(`${BASE}/streaming/${slug}/france/coming/`, { minLinks: 1 });
    if (page.error) {
      console.warn(`[flixpatrol] bientôt ${slug} : ${page.error}`);
      return null;
    }
    const list = parseComingPage(page.html);
    // Liste vide = réponse valable (Canal+, Crunchyroll n'ont rien d'annoncé) : gardée 24 h, pas relue toutes les heures.
    if (!list.length && !/Coming on/i.test(page.html)) return null;
    return { list, fetchedAt: new Date().toISOString() };
  }, wait);
}

/** Année indiquée dans l'identifiant FlixPatrol (« carrie-2026 », « youth-2026-2 »), sinon null. */
function slugYear(slug) {
  const m = /-((?:19|20)\d{2})(?:-\d+)?$/.exec(String(slug || ''));
  if (!m) return null;
  const y = Number(m[1]);
  return y <= new Date().getFullYear() + 2 ? y : null;
}

/** Oublie les échecs récents (pour le diagnostic, qui veut un vrai nouvel essai). */
function resetFailures() {
  for (const k of Object.keys(failedUntil)) delete failedUntil[k];
}

module.exports = {
  REFRESH_H, top10, fetchTop10, slugYear, comingSoon, parseTop10Page, parseComingPage, importSignature, resetFailures,
  statuses: () => statuses, browserStatus: () => ({ lecture: FETCH_MODE, directBloque: directBlocked, ...browser.status() }), IMPORT_DIR,
};
