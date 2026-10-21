'use strict';

/**
 * Serveur de l'addon (aucune dépendance npm : Node 20+ suffit).
 *
 *   /configure                         site de configuration + aperçu
 *   /<config>/manifest.json            manifest (config encodée dans l'URL)
 *   /<config>/catalog/<type>/<id>.json catalogues
 *   /<config>/meta/<type>/<id>.json    fiches en français
 *   /<config>/collection.json          collections Nuvio à importer
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Charge le fichier .env (s'il existe) avant tout le reste, sans écraser l'environnement.
(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch {
    /* pas de .env : on garde les valeurs par défaut */
  }
})();

const { decode } = require('./config');
const catalogs = require('./catalogs');
const { buildCollections } = require('./collection');
const { PLATFORMS, CHANNELS, ALL, ROWS, findService } = require('./platforms');
const { GENRES, GENRE_ROWS, genreTypes } = require('./genres');
const { SAGAS, SAGA_GROUPS, sagaTypes } = require('./sagas');
const covers = require('./covers');
const anime = require('./anime');
const tunnel = require('./tunnel');
const top10 = require('./top10');
const demo = require('./demo');
const tmdb = require('./sources/tmdb');
const netflixSource = require('./sources/netflix');
const flixpatrolSource = require('./sources/flixpatrol');
const boxofficeSource = require('./sources/boxoffice');

const PORT = Number(process.env.PORT || 7000);
const DEMO = process.env.DEMO === '1';
const PUBLIC = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon', '.gif': 'image/gif',
};

let lastUserKey = '';
let kickSchedule = null;
const { request } = require('./http');

function dumpDebug(name, content, ext = 'html') {
  try {
    const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'debug');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.${ext}`), content || '');
  } catch { /* sans importance */ }
}
const jobKey = () => process.env.TMDB_API_KEY || lastUserKey;

/** Avancement de la création des cartes (+ depuis combien de temps, sans dépendre de l'horloge du visiteur). */
const coversStatus = () => ({ ...covers.progress, elapsed: covers.progress.startedAt ? Date.now() - covers.progress.startedAt : 0 });

/** Ce que la page de configuration doit savoir d'un service pour construire ses dossiers. */
const serviceInfo = ({ id, name, colors, fp, types, noSoon }) => ({
  id, name, colors, top10: !!fp, soon: !!fp && !noSoon, types: types || ['movie', 'series'],
});

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  // Derrière Cloudflare, la requête arrive en http local mais le visiteur est en https.
  const viaCloudflare = /"scheme":"https"/.test(req.headers['cf-visitor'] || '') || /\.trycloudflare\.com$/i.test(host)
    || (tunnel.status.url && tunnel.status.url.endsWith(`//${host}`));
  const proto = viaCloudflare ? 'https' : (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${host}`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    ...headers,
  });
  res.end(body);
}

function json(res, data, maxAge = 0, extraHeaders = {}) {
  send(res, 200, JSON.stringify(data), {
    'Content-Type': MIME['.json'],
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-cache',
    ...extraHeaders,
  });
}

function serveFile(res, file, maxAge = 3600) {
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) return send(res, 403, 'Interdit');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'Introuvable');
    send(res, 200, buf, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-cache, no-store, must-revalidate',
    });
  });
}

const ROOTS = new Set(['manifest.json', 'catalog', 'meta', 'collection.json', 'configure']);

async function route(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  // Fichiers statiques et API du site.
  if (!parts.length) return send(res, 302, '', { Location: '/configure' });
  // Le site (script, styles) n'est jamais gardé en cache : chaque mise à jour est vue tout de suite.
  if (parts[0] === 'assets') return serveFile(res, parts.join('/'), 0);
  if (parts[0] === 'covers') {
    // Carte du moment (data/covers, refaite chaque jour avec les affiches) sinon carte de secours (public/covers).
    const found = parts.length === 2 ? covers.resolveFile(parts[1]) : null;
    if (!found) return serveFile(res, parts.join('/'), 86400);
    // Les applis redemandent la carte à chaque chargement (no-cache) ; si elle n'a pas changé,
    // on répond 304 (quelques octets) : une carte refaite est vue tout de suite, sans vider de cache.
    return fs.stat(found.file, (statErr, st) => {
      if (statErr) return send(res, 404, 'Introuvable');
      const etag = `"${Math.round(st.mtimeMs).toString(36)}-${st.size.toString(36)}"`;
      const headers = { 'Content-Type': found.type, 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': st.mtime.toUTCString() };
      const since = Date.parse(req.headers['if-modified-since'] || '');
      if (req.headers['if-none-match'] === etag || (!req.headers['if-none-match'] && since && since >= Math.floor(st.mtimeMs / 1000) * 1000)) {
        return send(res, 304, '', headers);
      }
      fs.readFile(found.file, (err, buf) => (err ? send(res, 404, 'Introuvable') : send(res, 200, buf, headers)));
    });
  }
  if (parts[0] === 'favicon.ico') return serveFile(res, 'covers/logo.png', 86400);
  if (parts[0] === 'api' && parts[1] === 'info') {
    return json(res, {
      demo: DEMO,
      serverKeys: { tmdb: !!process.env.TMDB_API_KEY, fanart: !!process.env.FANART_API_KEY, mdblist: !!process.env.MDBLIST_API_KEY },
      addonId: catalogs.ADDON_ID,
      addonName: catalogs.ADDON_NAME,
      version: require('../package.json').version,
      platforms: PLATFORMS.map(serviceInfo),
      channels: CHANNELS.map(serviceInfo),
      genres: GENRES.map((g) => ({ id: g.id, name: g.name, types: genreTypes(g) })),
      genreRows: GENRE_ROWS,
      sagas: SAGAS.map((x) => ({ id: x.id, name: x.name, group: x.group, types: sagaTypes(x), ordered: !!x.timeline })),
      sagaGroups: SAGA_GROUPS,
      // Rangées « où les regarder » pour toutes les plateformes : la page garde celles qui sont choisies.
      anime: anime.ANIME_FOLDERS.map((f) => ({
        id: f.id, name: f.name,
        rows: anime.animeRows(f, null).map((row) => ({
          id: row.id, label: row.label, type: anime.animeType(row),
          platform: row.provider && !['crunchyroll', 'adn'].includes(row.provider.id) ? row.provider.id : undefined,
        })),
      })),
      rows: ROWS,
      covers: coversStatus(),
      tunnel: tunnel.status,
    });
  }
  // État du lien Cloudflare (la page de configuration le suit pendant sa création).
  if (parts[0] === 'api' && parts[1] === 'tunnel') return json(res, tunnel.status);
  // Avancement de la mise à jour des cartes (la page de configuration le suit pendant qu'elle tourne).
  if (parts[0] === 'api' && parts[1] === 'covers') return json(res, coversStatus());
  // Explication des classements, pour vérifier et régler.
  //   /api/top10?type=movie|series                 → Top 10 du moment avec scores
  //   /api/top10?service=netflix&type=series       → classement brut d'une plateforme et sa correspondance TMDB
  if (parts[0] === 'api' && parts[1] === 'top10') {
    const key = jobKey();
    if (DEMO || !key) return json(res, { error: 'Disponible avec une clé TMDB, hors mode démo.' });
    const kind = url.searchParams.get('type') === 'series' ? 'tv' : 'movie';
    const serviceId = url.searchParams.get('service');
    if (serviceId) {
      const service = findService(serviceId);
      if (!service) return json(res, { error: 'Plateforme inconnue', plateformes: ALL.map((p) => p.id) });
      const chart = await top10.rawChart(service);
      const result = await top10.serviceTop10(key, service, kind);
      const names = await Promise.all(result.refs.map((r) =>
        tmdb.get(key, `/${r.kind}/${r.id}`, { language: 'fr-FR' }).then((d) => d && (d.title || d.name)).catch(() => null)));
      // Correspondance titre par titre, pour repérer une erreur et la corriger dans data/corrections.json.
      const list = chart ? (kind === 'movie' ? chart.movies : chart.shows) : [];
      const useOverall = chart && !list.length;
      const rawList = useOverall ? chart.overall : list;
      const providerIds = await tmdb.providerIdsFor(key, service);
      const detail = await Promise.all(rawList.map(async (item) => {
        const ref = await top10.matchItem(key, item, { kind: useOverall ? 'any' : kind, providerIds, recent: true }).catch(() => null);
        const d = ref ? await tmdb.get(key, `/${ref.kind}/${ref.id}`, { language: 'fr-FR' }).catch(() => null) : null;
        return {
          rang: item.rank, titreFlixPatrol: item.title, identifiant: item.slug || null,
          tmdb: ref ? `${ref.kind}:${ref.id}` : 'introuvable',
          titreTrouve: d ? `${d.title || d.name} (${(d.release_date || d.first_air_date || '').slice(0, 4)})` : null,
          gardeDans: ref && ref.kind !== kind ? `l'autre rangée (${ref.kind === 'movie' ? 'films' : 'séries'})` : undefined,
        };
      }));
      return json(res, {
        plateforme: service.name,
        source: result.source,
        classementDu: chart ? chart.fetchedAt || null : null,
        ancienClassement: !!(chart && chart.stale),
        corrections: `Pour corriger : ajoute "identifiant": "movie:ID" ou "tv:ID" (ou null pour ignorer) dans ${path.relative(process.cwd(), top10.CORRECTIONS_FILE)}`,
        correspondances: detail,
        resultat: result.refs.map((r, i) => ({ tmdb: r.id, titre: names[i], joursDansLeTop: r.days ?? null })),
      });
    }
    const data = await top10.mergedTop10(key, kind);
    return json(res, { type: kind, sources: data.sources, classement: data.debug });
  }

  // Diagnostic des sources : /api/diag
  if (parts[0] === 'api' && parts[1] === 'diag') {
    const key = jobKey();
    const out = { tmdb: null, netflixOfficiel: null, flixpatrol: {}, boxOffice: null };
    try {
      const conf = key ? await tmdb.get(key, '/configuration', {}, 60) : null;
      out.tmdb = conf ? 'OK' : 'clé absente';
    } catch (err) { out.tmdb = `erreur : ${err.message}`; }
    const nf = await netflixSource.franceTop10().catch(() => null);
    out.netflixOfficiel = { ...netflixSource.status(), exemple: nf ? nf.shows.slice(0, 3).map((x) => x.title) : null };
    // Netflix a sa source officielle : FlixPatrol n'y sert que de secours.
    flixpatrolSource.resetFailures();
    for (const p of ALL.filter((x) => x.id !== 'netflix' && x.fp)) {
      const r = await flixpatrolSource.top10(p.fp, { wait: Infinity }).catch((e) => ({ error: e.message }));
      out.flixpatrol[p.fp] = flixpatrolSource.statuses()[p.fp] || (r && r.error) || (r ? 'OK (cache)' : null);
    }
    out.flixpatrolNavigateur = flixpatrolSource.browserStatus();
    const bo = await boxofficeSource.weekly().catch(() => null);
    out.boxOffice = bo ? `OK : ${bo.list.slice(0, 3).map((x) => x.title).join(', ')}…` : 'indisponible (repli TMDB)';
    // Listes MDBList candidates pour remplacer FlixPatrol (top 10 France par plateforme).
    const mdbKey = process.env.MDBLIST_API_KEY;
    if (mdbKey) {
      out.mdblist = {};
      const queries = ['top 10 france', 'flixpatrol france', 'netflix france', 'prime video france', 'disney france',
        'canal france', 'hbo max france', 'apple tv france', 'paramount france', 'crunchyroll france'];
      for (const q of queries) {
        try {
          const r = await request(`https://api.mdblist.com/lists/search?query=${encodeURIComponent(q)}&apikey=${encodeURIComponent(mdbKey)}`, { timeout: 12000 });
          const list = Array.isArray(r) ? r : (r && (r.lists || r.results)) || [];
          out.mdblist[q] = list.slice(0, 15).map((l) => {
            const { description, ...rest } = l;
            return rest;
          });
        } catch (err) {
          out.mdblist[q] = `erreur : ${err.message}`;
        }
      }
    }

    // Page Netflix du top 10 France, plus à jour que le fichier de données.
    out.netflixPages = {};
    for (const cat of ['tv', 'films']) {
      try {
        const r = await request(`https://www.netflix.com/tudum/top10/france/${cat}`, { as: 'text', raw: true, timeout: 15000 });
        dumpDebug(`netflix-tudum-${cat}`, r.body);
        out.netflixPages[cat] = `HTTP ${r.status}, ${r.body.length} caractères (enregistrée)`;
      } catch (err) {
        out.netflixPages[cat] = `erreur : ${err.message}`;
      }
    }

    out.pagesGardees = 'Pages et diagnostic enregistrés dans data/debug/';
    dumpDebug('diag', JSON.stringify(out, null, 2), 'json');
    return json(res, out);
  }
  if (DEMO && parts[0] === 'demo') {
    const n = Number(String(parts[2] || '1').replace(/\D/g, '')) || 1;
    const svg = parts[1] === 'poster'
      ? demo.posterSvg(n, url.searchParams.get('t'), url.searchParams.get('k'))
      : demo.backdropSvg(n);
    return send(res, 200, svg, { 'Content-Type': MIME['.svg'], 'Cache-Control': 'public, max-age=86400' });
  }

  // Config éventuelle en premier segment.
  let cfgStr = '';
  if (!ROOTS.has(parts[0])) cfgStr = parts.shift();
  const cfg = decode(cfgStr);
  if (!cfg) return send(res, 400, 'Configuration invalide');
  if (cfg.keys.tmdb && !lastUserKey && !process.env.TMDB_API_KEY && !DEMO) {
    // Première clé reçue (pas de clé dans .env) : classements et cartes démarrent tout de suite.
    lastUserKey = cfg.keys.tmdb;
    if (kickSchedule) setTimeout(kickSchedule, 500).unref();
  }
  if (cfg.keys.tmdb) lastUserKey = cfg.keys.tmdb;

  const [head, type, rawId, rawExtra] = parts;
  if (!head || head === 'configure') return serveFile(res, 'configure.html', 0);

  if (head === 'manifest.json') return json(res, catalogs.manifest(cfg, baseUrl(req)), 3600);

  if (head === 'collection.json') {
    const data = buildCollections(cfg, baseUrl(req));
    const headers = url.searchParams.has('download')
      ? { 'Content-Disposition': 'attachment; filename="nuvio-fr-collections.json"' }
      : {};
    return json(res, data, 0, headers);
  }

  if (head === 'catalog' && type && rawId) {
    const id = rawId.replace(/\.json$/, '');
    const extra = rawExtra ? rawExtra.replace(/\.json$/, '') : '';
    try {
      const data = DEMO ? demo.catalog(type, id, extra) : await catalogs.catalog(cfg, type, id, extra);
      return json(res, data, data.cacheMaxAge || 0);
    } catch (err) {
      console.error(`[catalog] ${type}/${id} :`, err.message);
      return json(res, { metas: [] });
    }
  }

  if (head === 'meta' && type && rawId) {
    const id = rawId.replace(/\.json$/, '');
    try {
      const data = DEMO ? demo.meta(type, id) : await catalogs.metaHandler(cfg, type, id);
      return json(res, data, data.cacheMaxAge || 0);
    } catch (err) {
      console.error(`[meta] ${type}/${id} :`, err.message);
      return json(res, { meta: null });
    }
  }

  return send(res, 404, 'Introuvable');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'Erreur interne');
  });
});

server.listen(PORT, () => {
  console.log(`${catalogs.ADDON_NAME} prêt sur http://localhost:${PORT}/configure${DEMO ? '  (mode démo)' : ''}`);
  if (!DEMO) kickSchedule = top10.schedule(jobKey);
  tunnel.start(PORT);
});

module.exports = server;
