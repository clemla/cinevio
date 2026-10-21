'use strict';

const UA = process.env.HTTP_USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

/** Limiteur de concurrence simple. */
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

async function request(url, { headers = {}, timeout = 10000, retries = 1, as = 'json', raw = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6',
          Accept: as === 'text' ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' : 'application/json',
          ...headers,
        },
        signal: ctrl.signal,
      });
      if (res.status === 429 && attempt < retries) {
        const wait = Number(res.headers.get('retry-after') || 2) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (raw) return { status: res.status, body: await res.text() };
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url.replace(/(api_key|apikey)=[^&]+/g, '$1=***')}`);
      return as === 'text' ? await res.text() : await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Map asynchrone avec concurrence limitée, en conservant l'ordre. */
async function mapLimit(items, max, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Normalise un titre pour comparaison (accents, ponctuation, articles). */
function normTitle(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|le|la|les|l)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { request, limiter, mapLimit, decodeEntities, stripTags, normTitle, UA };
