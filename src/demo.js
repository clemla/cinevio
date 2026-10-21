'use strict';

/**
 * Mode démo (DEMO=1) : données inventées, sans aucun appel externe.
 * Sert à tester l'addon, la collection et l'aperçu du site de config hors ligne.
 */

const { findService } = require('./platforms');

const A = ['Les Ombres', 'Le Dernier', 'Nuit', 'La Maison', 'Les Enfants', 'Le Silence', 'Rouge', 'Les Loups', 'La Frontière', 'Opération', 'Le Royaume', 'Les Héritiers', 'Code', 'Après', 'Le Pacte', 'Sous la', 'Les Anges', 'Point', 'L’Empire', 'La Traque'];
const B = ['de Lyon', 'Hiver', 'Blanche', 'du Lac', 'du Nord', 'des Mers', 'Écarlate', 'de Minuit', 'Perdue', 'Phénix', 'Oublié', 'de Verre', 'Zéro', 'la Chute', 'Secret', 'Surface', 'Déchus', 'de Rupture', 'des Sables', 'Finale'];
const GENRES = ['Thriller', 'Drame', 'Science-fiction', 'Comédie', 'Action', 'Animation', 'Crime', 'Fantastique'];
const HUES = [350, 12, 28, 200, 220, 262, 290, 160, 180, 40];

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function hash(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h);
}

function fakeMeta(n, type) {
  const r = rng(hash(`t${n}`));
  const name = `${A[Math.floor(r() * A.length)]} ${B[Math.floor(r() * B.length)]}`;
  const y = 2018 + Math.floor(r() * 9);
  return {
    id: `tmdb:${100000 + n}`,
    type,
    name,
    poster: `/demo/poster/${n}.svg?t=${encodeURIComponent(name)}&k=${type}`,
    background: `/demo/backdrop/${n}.svg`,
    description: 'Titre fictif généré par le mode démo. Avec tes clés API, ces cases affichent les vrais titres, affiches et résumés en français.',
    releaseInfo: type === 'series' ? `${y}–` : String(y),
    imdbRating: (5.5 + r() * 3.5).toFixed(1),
    genres: [GENRES[Math.floor(r() * GENRES.length)]],
  };
}

function catalog(type, id, extraStr) {
  const skip = Number((/skip=(\d+)/.exec(extraStr || '') || [])[1] || 0);
  const isRanked = id === 'nfr.top10' || id.endsWith('.top10');
  if (id === 'nfr.realitytv') type = 'series';
  const size = isRanked ? 10 : id.endsWith('.soon') ? 8 : 20;
  if ((isRanked || id.endsWith('.soon')) && skip) return { metas: [] };
  const base = hash(`${id}:${type}`) % 100000;
  const metas = Array.from({ length: size }, (_, i) => fakeMeta(base + skip + i + 1, type));
  return { metas };
}

function meta(type, id) {
  const n = Number(String(id).replace(/\D/g, '')) - 100000 || 1;
  const m = fakeMeta(n, type);
  if (type === 'series') {
    m.videos = Array.from({ length: 8 }, (_, i) => ({
      id: `${m.id}:1:${i + 1}`, title: `Épisode ${i + 1}`, season: 1, episode: i + 1,
    }));
  }
  return { meta: m };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Affiche SVG fictive (2:3). */
function posterSvg(n, title, kind) {
  const h = HUES[n % HUES.length];
  const words = String(title || 'Titre').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 11) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  const tspans = lines.slice(0, 4).map((l, i) => `<tspan x="24" dy="${i ? 34 : 0}">${esc(l)}</tspan>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${h} 70% 45%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 60% 12%)"/></linearGradient>
<radialGradient id="r" cx="0.8" cy="0.15" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="300" height="450" fill="url(#g)"/><rect width="300" height="450" fill="url(#r)"/>
<circle cx="${60 + (n * 37) % 180}" cy="${120 + (n * 53) % 120}" r="${40 + (n % 5) * 12}" fill="#000" opacity=".18"/>
<text x="24" y="${330 - (Math.min(lines.length, 4) - 1) * 34}" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="30" fill="#fff">${tspans}</text>
<text x="24" y="420" font-family="Inter, Arial, sans-serif" font-size="13" letter-spacing="2" fill="#fff" opacity=".7">${kind === 'series' ? 'SÉRIE' : 'FILM'} · DÉMO</text>
</svg>`;
}

function backdropSvg(n) {
  const h = HUES[n % HUES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 60% 30%)"/><stop offset="1" stop-color="#07070b"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/></svg>`;
}

module.exports = { catalog, meta, posterSvg, backdropSvg, findService };
