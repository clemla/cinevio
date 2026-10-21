'use strict';

/**
 * Box-office France de la semaine (les films sortent le mercredi).
 * Source principale : la page box-office d'Allociné (chiffres CBO).
 * Repli : TMDB « actuellement en salles en France », trié par popularité.
 */

const { request, stripTags } = require('../http');
const cache = require('../cache');

const URL = 'https://www.allocine.fr/boxoffice/france/';
const DISABLED = process.env.BOXOFFICE_DISABLED === '1';

function parseAllocine(html) {
  const out = [];
  const seen = new Set();
  // Les titres sont des liens vers /film/fichefilm_gen_cfilm=<id>.html
  const re = /<a[^>]+href="\/film\/fichefilm_gen_cfilm=(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 10) {
    const title = stripTags(m[2]);
    if (!title || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ rank: out.length + 1, title, allocineId: m[1] });
  }
  return out;
}

async function weekly() {
  if (DISABLED) return null;
  return cache.wrap('boxoffice:fr', 12 * 3600, async () => {
    try {
      const html = await request(URL, { as: 'text', timeout: 15000 });
      const list = html ? parseAllocine(html) : [];
      return list.length >= 5 ? { list, fetchedAt: new Date().toISOString() } : null;
    } catch (err) {
      console.warn(`[box-office] ${err.message}`);
      return null;
    }
  }, true);
}

module.exports = { weekly, parseAllocine };
