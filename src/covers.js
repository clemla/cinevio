'use strict';

/**
 * Cartes des collections (1280×720), dessinées en HTML/CSS par Chrome puis enregistrées en JPEG.
 *
 *  - Plateformes et chaînes : les affiches du Top du moment en éventail, éclairées par la couleur
 *    de la marque, sur le fond flouté du n°1.
 *  - Genres : un mur d'affiches incliné, en bichromie dans la couleur du genre.
 *  - Sagas : l'image de la saga en plein cadre.
 *  - Sans images (pas de clé TMDB, hors ligne) : le nom en très grand, en contour, comme texture.
 *
 * Les cartes avec images sont refaites quand leurs images changent (au plus une fois par jour et par carte)
 * et rangées dans data/covers/. Les cartes sans images sont dans public/covers/ (scripts/render-covers.js).
 * Le serveur sert data/covers/ en priorité.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tmdb = require('./sources/tmdb');
const browser = require('./sources/browser');
const gif = require('./gif');
const { ALL } = require('./platforms');
const { GENRES } = require('./genres');
const { SAGAS } = require('./sagas');
const anime = require('./anime');
const { FX_IDS, FX_SCRIPT } = require('./cover-fx');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DYN_DIR = path.join(DATA_DIR, 'covers');
const STATIC_DIR = path.join(__dirname, '..', 'public', 'covers');
const FONT_DIR = path.join(__dirname, '..', 'public', 'assets', 'fonts');
const IMG = process.env.COVERS_IMG_BASE || 'https://image.tmdb.org/t/p'; // modifiable pour les tests
const DISABLED = process.env.COVERS_DYNAMIC === '0';

/** Nom de fichier d'une carte. Les plateformes gardent leur nom historique (netflix.jpg…). */
function coverId(type, id) {
  return type === 'service' ? id : `${type}-${id}`;
}

let fontCss = null;
function fonts() {
  if (fontCss) return fontCss;
  const face = (file, weight) => {
    try {
      const b64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
      return `@font-face{font-family:'Inter Display';font-weight:${weight};src:url(data:font/woff;base64,${b64}) format('woff');}`;
    } catch { return ''; }
  };
  fontCss = face('InterDisplay-Black.woff', 900) + face('InterDisplay-ExtraBold.woff', 800)
    + face('InterDisplay-SemiBold.woff', 600) + face('InterDisplay-Medium.woff', 500);
  return fontCss;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const img = (p, size) => (p ? (/^https?:|^data:/.test(p) ? p : `${IMG}/${size}${p}`) : null);

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const rgba = (hex, a) => `rgba(${hexRgb(hex).join(',')},${a})`;

const GRAIN = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/**
 * HTML d'une carte.
 * spec : { layout: 'fan' | 'wall' | 'cinema', title, subtitle, note, colors: [clair, sombre],
 *          backdrop, posters: [chemins TMDB] }
 */
function coverHtml(spec) {
  const [light, dark] = spec.colors;
  const posters = (spec.posters || []).map((p) => img(p, 'w342')).filter(Boolean);
  const backdrop = img(spec.backdrop, 'w1280');
  // Logo officiel (TMDB) à la place du nom écrit : SVG en taille d'origine, PNG en w500.
  const logo = spec.logo ? img(spec.logo, /\.svg$/i.test(spec.logo) ? 'original' : 'w500') : null;
  const hasArt = !!(backdrop || posters.length);
  const layout = hasArt ? spec.layout : 'type';
  const wide = layout === 'cinema' || layout === 'type' || layout === 'reel';
  const fx = FX_IDS.includes(spec.fx) ? spec.fx : null; // décor animé propre au genre (cover-fx.js)

  let art = '';
  if (layout === 'fan') {
    const order = [posters[1], posters[0], posters[2]].filter(Boolean);
    art = `
      ${backdrop ? `<img class="ambience" data-img src="${esc(backdrop)}">` : ''}
      <div class="halo"></div>
      <div class="fan n${order.length}">${order.map((p, i) => `<figure class="p p${i}"><img data-img src="${esc(p)}">${i === 1 || order.length === 1 ? '<i class="shine"></i>' : ''}</figure>`).join('')}</div>`;
  } else if (layout === 'wall') {
    const wall = [];
    for (let i = 0; i < 15; i++) wall.push(posters[i % posters.length]);
    art = `
      <div class="wall-wrap"><div class="wall">${wall.map((p) => `<img data-img src="${esc(p)}">`).join('')}</div></div>
      <div class="duo"></div><div class="halo"></div>`;
  } else if (layout === 'reel') {
    // Diaporama : les scènes s'enchaînent en fondu (le GIF), la première sert d'image fixe.
    const slides = (spec.backdrops && spec.backdrops.length ? spec.backdrops : [spec.backdrop]).map((p) => img(p, 'w1280')).filter(Boolean);
    art = `<div class="reel">${slides.map((s) => `<img class="slide" data-img src="${esc(s)}">`).join('')}</div><div class="halo soft"></div>`;
  } else if (layout === 'cinema') {
    art = `<img class="still" data-img src="${esc(backdrop || posters[0])}"><div class="halo soft"></div><div class="beam"></div>`;
  } else {
    art = `<div class="halo big"></div><div class="echo" aria-hidden="true">${esc(spec.title)}</div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:720px;overflow:hidden}
body{position:relative;background:${dark};font-family:'Inter Display','Segoe UI',Arial,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
.ambience{position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);object-fit:cover;filter:blur(14px) saturate(1.25) brightness(.42);opacity:.9}
.still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(1.08) contrast(1.04)}
.halo{position:absolute;inset:0;background:radial-gradient(60% 75% at 76% 46%, ${rgba(light, 0.55)} 0%, ${rgba(light, 0.12)} 45%, transparent 70%);mix-blend-mode:screen}
.halo.soft{background:radial-gradient(55% 70% at 20% 85%, ${rgba(light, 0.35)} 0%, transparent 70%)}
.halo.big{background:radial-gradient(70% 90% at 85% 20%, ${rgba(light, 0.75)} 0%, ${rgba(light, 0.18)} 40%, transparent 72%)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg, ${rgba(dark, 0.96)} 0%, ${rgba(dark, 0.82)} ${wide ? 30 : 34}%, ${rgba(dark, 0.15)} ${wide ? 62 : 58}%, transparent 80%),linear-gradient(0deg, ${rgba(dark, 0.9)} 0%, transparent 45%)}
.reel{position:absolute;inset:0;overflow:hidden;z-index:0}
.slide{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.06);filter:saturate(1.1) contrast(1.04)}
.slide:first-child{opacity:1}
.l-reel .shade{background:linear-gradient(90deg, ${rgba(dark, 0.9)} 0%, ${rgba(dark, 0.5)} 36%, transparent 64%),linear-gradient(0deg, ${rgba(dark, 0.95)} 0%, ${rgba(dark, 0.3)} 40%, transparent 65%)}
.l-cinema .shade{background:linear-gradient(90deg, ${rgba(dark, 0.92)} 0%, ${rgba(dark, 0.55)} 38%, transparent 66%),linear-gradient(0deg, ${rgba(dark, 0.95)} 0%, ${rgba(dark, 0.35)} 40%, transparent 65%)}
.l-type .shade{background:linear-gradient(0deg, ${rgba(dark, 0.7)} 0%, transparent 60%)}

/* Éventail d'affiches */
.fan{position:absolute;right:60px;top:47%;width:600px;height:500px;transform:translateY(-50%)}
.p{position:absolute;top:50%;left:50%;width:276px;aspect-ratio:2/3;border-radius:14px;overflow:hidden;background:${rgba(light, 0.2)};
  box-shadow:0 40px 70px -20px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.14),0 0 60px -10px ${rgba(light, 0.45)}}
.p img{width:100%;height:100%;object-fit:cover;display:block}
.p{will-change:transform}
.shine{position:absolute;inset:-30%;background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.55) 50%,transparent 62%);transform:translateX(-120%);mix-blend-mode:soft-light;pointer-events:none}
.beam{position:absolute;top:-20%;bottom:-20%;left:0;width:30%;background:linear-gradient(100deg,transparent 0%,${rgba(light, 0.25)} 32%,rgba(255,255,255,.55) 50%,${rgba(light, 0.25)} 68%,transparent 100%);
  transform:translateX(-140%) skewX(-14deg);mix-blend-mode:screen;opacity:0;pointer-events:none}
.p0{transform:translate(-50%,-50%) translateX(-185px) translateY(26px) rotate(-9deg) scale(.86);filter:brightness(.78)}
.p1{transform:translate(-50%,-50%) scale(1.08);z-index:2}
.p2{transform:translate(-50%,-50%) translateX(185px) translateY(26px) rotate(9deg) scale(.86);filter:brightness(.78)}
.n1 .p0{transform:translate(-50%,-50%) scale(1.08)}
.n2 .p0{transform:translate(-50%,-50%) translateX(-90px) rotate(-6deg) scale(.95)}
.n2 .p1{transform:translate(-50%,-50%) translateX(90px) rotate(5deg) scale(1.02)}

/* Mur d'affiches en bichromie */
.wall-wrap{position:absolute;inset:0;perspective:1400px;overflow:hidden}
.wall{position:absolute;left:470px;top:-170px;width:1000px;display:grid;grid-template-columns:repeat(5,1fr);gap:18px;
  transform:rotateX(18deg) rotateY(-24deg) rotateZ(-8deg);transform-origin:30% 50%}
.wall img{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:10px;filter:grayscale(1) contrast(1.25) brightness(.95)}
.duo{position:absolute;inset:0;background:linear-gradient(120deg, ${dark} 0%, ${light} 100%);mix-blend-mode:color;opacity:.92}

/* Sans images : le nom en écho */
.echo{position:absolute;right:-60px;top:-30px;max-width:1500px;font-weight:900;font-size:330px;line-height:.82;letter-spacing:-.06em;
  color:transparent;-webkit-text-stroke:3px ${rgba(light, 0.5)};text-align:right;transform:rotate(-4deg);white-space:normal;word-break:break-word}

.grain{position:absolute;inset:0;background-image:${GRAIN};opacity:.09;mix-blend-mode:overlay;pointer-events:none}
.vignette{position:absolute;inset:0;background:radial-gradient(120% 120% at 50% 45%, transparent 55%, rgba(0,0,0,.55) 100%);pointer-events:none}
.frame{position:absolute;inset:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);pointer-events:none}
.fx{position:absolute;inset:0;width:1280px;height:720px;pointer-events:none}
.fx.light{mix-blend-mode:screen}

.text{position:absolute;left:68px;bottom:62px;width:${layout === 'type' ? 1144 : wide ? 1000 : 600}px;z-index:5}
.logo{display:block;width:${wide ? 760 : 600}px;max-width:100%;height:${wide ? 230 : 190}px;object-fit:contain;object-position:left bottom;
  filter:drop-shadow(0 6px 26px rgba(0,0,0,.55))}
.logo.white{filter:brightness(0) invert(1) drop-shadow(0 6px 26px rgba(0,0,0,.55))}
.title[hidden]{display:none}
.title{font-weight:900;font-size:150px;line-height:.9;letter-spacing:-.045em;text-wrap:balance;
  background:linear-gradient(180deg,#fff 0%,#fff 55%,${rgba(light, 0.9)} 140%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 6px 30px rgba(0,0,0,.45));padding-bottom:.06em}
.subtitle{margin-top:16px;font-weight:600;font-size:46px;line-height:1.15;letter-spacing:-.01em;color:rgba(255,255,255,.86)}
.note{margin-top:18px;display:inline-flex;align-items:center;gap:16px;font-weight:600;font-size:40px;color:rgba(255,255,255,.85)}
.note::before{content:'';width:44px;height:7px;border-radius:3px;background:${light}}
</style></head>
<body class="l-${layout}"${fx ? ` data-fx="${fx}"` : ''}>
${art}
${fx ? '<canvas id="fx-back" class="fx" width="1280" height="720"></canvas><canvas id="fx-back-light" class="fx light" width="1280" height="720"></canvas>' : ''}
<div class="shade"></div>
${fx ? '<canvas id="fx-light" class="fx light" width="1280" height="720"></canvas><canvas id="fx-front" class="fx" width="1280" height="720"></canvas>' : ''}
<div class="text">
  ${logo ? `<img class="logo${spec.logoWhite ? ' white' : ''}" data-logo src="${esc(logo)}" alt="${esc(spec.title)}">` : ''}
  <h1 class="title"${logo ? ' hidden' : ''}>${esc(spec.title)}</h1>
  ${spec.subtitle ? `<p class="subtitle">${esc(spec.subtitle)}</p>` : ''}
  ${spec.note ? `<p class="note">${esc(spec.note)}</p>` : ''}
</div>
<div class="grain"></div><div class="vignette"></div><div class="frame"></div>
${fx ? `<script>${FX_SCRIPT}</script>` : ''}
<script>
window.__ready = (async () => {
  try { await document.fonts.ready; } catch (e) {}
  const imgs = [...document.querySelectorAll('img[data-img]')];
  await Promise.all(imgs.map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 12000); })));
  // Images introuvables : on les retire (le reste de la carte tient sans elles).
  imgs.forEach((i) => { if (!i.naturalWidth) (i.closest('figure') || i).remove(); });
  // Le titre prend la plus grande taille qui tient en ${wide ? 2 : 3} lignes dans sa zone.
  // Logo introuvable : on remet le nom écrit.
  const logo = document.querySelector('.logo');
  if (logo) {
    if (!logo.complete) await new Promise((r) => { logo.onload = logo.onerror = r; setTimeout(r, 12000); });
    if (!logo.naturalWidth) { logo.remove(); document.querySelector('.title').hidden = false; }
  }
  const t = document.querySelector('.title');
  const box = document.querySelector('.text');
  const maxH = ${layout === 'cinema' ? 330 : wide ? 400 : 380} - (document.querySelector('.subtitle') ? 70 : 0) - (document.querySelector('.note') ? 64 : 0);
  let size = ${layout === 'type' ? 210 : wide ? 176 : 164};
  t.style.fontSize = size + 'px';
  while (!t.hidden && size > 44 && (t.scrollWidth > box.clientWidth + 2 || t.offsetHeight > maxH)) { size -= 3; t.style.fontSize = size + 'px'; }
  const echo = document.querySelector('.echo');
  if (echo && echo.textContent.length > 12) echo.style.fontSize = '230px';
  // Carte fixe : le décor du genre à mi-boucle (le GIF le redessine à chaque image).
  if (window.__fx) window.__fx(0.5);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
})();

/* Animation (GIF joué quand la carte a le focus) : t de 0 à 1, boucle sans saut. */
window.__setFrame = (t) => {
  if (window.__fx) window.__fx(t);
  const s = Math.sin(2 * Math.PI * t);
  const c = Math.cos(2 * Math.PI * t);
  const fan = document.querySelector('.fan');
  if (fan) {
    const base = {
      p0: 'translate(-50%,-50%) translateX(-185px) translateY(26px) rotate(-9deg) scale(.86)',
      p1: 'translate(-50%,-50%) scale(1.08)',
      p2: 'translate(-50%,-50%) translateX(185px) translateY(26px) rotate(9deg) scale(.86)',
    };
    const n = fan.querySelectorAll('.p').length;
    const p0 = fan.querySelector('.p0'); const p1 = fan.querySelector('.p1'); const p2 = fan.querySelector('.p2');
    // L'éventail s'ouvre et se referme ; l'affiche de devant se soulève.
    const open = (1 - c) / 2; // 0 → 1 → 0
    if (n === 3) {
      p0.style.transform = base.p0 + ' translate(' + (-46 * open) + 'px,' + (14 * open) + 'px) rotate(' + (-7 * open) + 'deg)';
      p1.style.transform = base.p1 + ' translateY(' + (-24 * open) + 'px) scale(' + (1 + 0.05 * open) + ')';
      p2.style.transform = base.p2 + ' translate(' + (46 * open) + 'px,' + (14 * open) + 'px) rotate(' + (7 * open) + 'deg)';
    } else if (p1 || p0) {
      (p1 || p0).style.transform = (p1 ? base.p1 : 'translate(-50%,-50%) scale(1.08)') + ' translateY(' + (-24 * open) + 'px) rotate(' + (3 * s) + 'deg)';
    }
    // Reflet qui traverse l'affiche de devant pendant la première moitié de la boucle.
    const shine = fan.querySelector('.shine');
    if (shine) shine.style.transform = 'translateX(' + (t < 0.5 ? -120 + 240 * (t / 0.5) : 120) + '%)';
  }
  const wall = document.querySelector('.wall');
  if (wall) wall.style.transform = 'rotateX(18deg) rotateY(-24deg) rotateZ(-8deg) translate(' + (-110 * s) + 'px,' + (70 * s) + 'px)';
  // Diaporama : chaque scène tient, puis la suivante arrive en fondu en reculant doucement.
  const slides = [...document.querySelectorAll('.slide')];
  if (slides.length > 1) {
    const n = slides.length;
    const seg = t * n;
    const i = Math.floor(seg) % n;
    const local = seg - Math.floor(seg);
    const k = local < 0.72 ? 0 : (local - 0.72) / 0.28;
    const e = k * k * (3 - 2 * k);
    slides.forEach((s, j) => {
      const next = (i + 1) % n;
      if (j === i) { s.style.opacity = '1'; s.style.zIndex = '1'; s.style.transform = 'scale(' + (1.06 - 0.02 * e) + ')'; }
      else if (j === next && k > 0) { s.style.opacity = String(e); s.style.zIndex = '2'; s.style.transform = 'scale(' + (1.14 - 0.08 * e) + ')'; }
      else { s.style.opacity = '0'; s.style.zIndex = '0'; }
    });
  }
  const still = document.querySelector('.still');
  if (still) still.style.transform = 'scale(' + (1 + 0.06 * (1 - c) / 2) + ')';
  const beam = document.querySelector('.beam');
  if (beam) {
    const k = t < 0.6 ? t / 0.6 : 1;
    beam.style.opacity = t < 0.6 ? String(Math.sin(Math.PI * k)) : '0';
    beam.style.transform = 'translateX(' + (-140 + 480 * k) + '%) skewX(-14deg)';
  }
  const echo = document.querySelector('.echo');
  if (echo) echo.style.transform = 'rotate(-4deg) translateX(' + (-140 * s) + 'px)';
};
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Contenu des cartes                                                  */
/* ------------------------------------------------------------------ */

function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

/** Spécifications de toutes les cartes, sans images (version de secours). */
function baseSpecs() {
  const specs = [];
  for (const s of ALL) {
    specs.push({ id: coverId('service', s.id), kind: 'service', ref: s, layout: 'fan', title: s.name, colors: s.colors });
  }
  for (const g of GENRES) {
    specs.push({ id: coverId('genre', g.id), kind: 'genre', ref: g, layout: 'wall', title: g.name, colors: g.colors, fx: g.id });
  }
  for (const f of anime.ANIME_FOLDERS) {
    // Animés : diaporama de vraies scènes (fonds TMDB sans texte), pas d'effets de lumière.
    specs.push({ id: coverId('anime', f.id), kind: 'anime', ref: f, layout: 'reel', title: f.name, subtitle: f.subtitle, colors: f.colors });
  }
  for (const x of SAGAS) {
    specs.push({ id: coverId('saga', x.id), kind: 'saga', ref: x, layout: 'cinema', title: x.name, subtitle: x.subtitle, colors: x.colors });
  }
  return specs;
}

/** Ajoute les images TMDB du moment à une carte. */
async function withArt(key, spec, deps) {
  const out = { ...spec };
  if (spec.kind === 'service') {
    const s = spec.ref;
    const kinds = (s.types || ['movie', 'series']).map((t) => (t === 'series' ? 'tv' : 'movie'));
    let refs = [];
    if (s.fp || s.id === 'netflix') {
      const lists = await Promise.all(kinds.map((k) => deps.serviceTop10(key, s, k).then((r) => r.refs).catch(() => [])));
      // Alterne séries et films : la carte montre les deux.
      const [a = [], b = []] = kinds.includes('tv') ? [lists[kinds.indexOf('tv')], lists[kinds.indexOf('movie')] || []] : lists;
      for (let i = 0; i < 6; i++) { if (a[i]) refs.push(a[i]); if (b[i]) refs.push(b[i]); }
    }
    if (refs.length < 3) {
      const providerIds = await tmdb.providerIdsFor(key, s).catch(() => []);
      for (const k of kinds) {
        if (!providerIds.length && !(k === 'tv' && s.networks)) continue;
        const res = await tmdb.discover(key, k, tmdb.discoverParams(k, 'popular', providerIds, { networks: s.networks })).catch(() => []);
        refs.push(...res.slice(0, 4).map((r) => ({ kind: k, id: r.id })));
      }
    }
    const details = (await Promise.all(refs.slice(0, 8).map((r) => tmdb.get(key, `/${r.kind}/${r.id}`, { language: 'fr-FR' }).catch(() => null)))).filter(Boolean);
    out.posters = details.filter((d) => d.poster_path).slice(0, 3).map((d) => d.poster_path);
    out.backdrop = (details.find((d) => d.backdrop_path) || {}).backdrop_path || null;
    if (s.logo) {
      const net = await tmdb.get(key, `/network/${s.logo.network}`, {}, 30 * 86400).catch(() => null);
      if (net && net.logo_path) { out.logo = net.logo_path; out.logoWhite = !!s.logo.white; }
    }
  } else if (spec.kind === 'genre') {
    const g = spec.ref;
    const params = tmdb.discoverParams('movie', 'popular', [], { genres: g.movie, excludeGenres: g.exclude });
    const res = (await tmdb.discover(key, 'movie', params).catch(() => [])).filter((r) => r.poster_path);
    out.posters = res.slice(0, 10).map((r) => r.poster_path);
  } else if (spec.kind === 'anime') {
    out.backdrops = await anime.animeBackdrops(key, spec.ref, require('./meta').artFor).catch(() => []);
    out.backdrop = out.backdrops[0] || null;
  } else if (spec.kind === 'saga') {
    const art = await deps.sagaArt(key, spec.ref).catch(() => null);
    if (art) {
      out.backdrop = art.backdrop;
      out.posters = art.posters;
      const films = art.movies;
      const series = art.series;
      const parts = [films ? plural(films, 'film', 'films') : '', series ? plural(series, 'série', 'séries') : ''].filter(Boolean);
      if (parts.length) out.note = parts.join(' et ');
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Rendu et rafraîchissement                                           */
/* ------------------------------------------------------------------ */

const INDEX_FILE = path.join(DYN_DIR, 'index.json');
function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return {}; }
}

/** Version du dessin des cartes : à augmenter quand le modèle change (toutes les cartes sont refaites). */
const DESIGN_VERSION = 7;
const hash = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
/** Ce qui change souvent (affiches du moment) : limité à une nouvelle carte par jour. */
const artSignature = (spec) => hash([spec.backdrop, spec.posters]
  .concat(spec.backdrops ? [spec.backdrops] : []));
/** Ce qui change rarement (logo, titre, mise en page) : carte refaite tout de suite. */
const designSignature = (spec) => hash([DESIGN_VERSION, spec.layout, spec.title, spec.subtitle, spec.note, spec.colors, spec.logo, spec.logoWhite, spec.fx || '']);

const signature = (spec) => crypto.createHash('sha1')
  .update(JSON.stringify([spec.layout, spec.title, spec.subtitle, spec.note, spec.colors, spec.backdrop, spec.posters, spec.logo, spec.logoWhite, 4]
    .concat(spec.backdrops ? [spec.backdrops] : [])))
  .digest('hex').slice(0, 12);

let running = null;
/** Avancement de la mise à jour des cartes, affiché sur la page de configuration. */
const progress = { running: false, stage: '', done: 0, total: 0, pending: [], startedAt: 0, stamp: Date.now() };

const GIF_ENABLED = process.env.COVERS_GIF !== '0';
const GIF = { frames: 36, delayMs: 80, scale: 0.375 }; // 480×270, boucle de 2,9 s
const GIF_WORKERS = Math.max(1, Number(process.env.RENDER_CONCURRENCY || 3));

/** GIF animé d'une carte (joué par Nuvio quand la carte a le focus). */
async function renderGif(spec) {
  // Diaporama : plus long (environ 1,4 s par scène) ; les images tenues sont presque gratuites dans le GIF.
  const reel = spec.layout === 'reel' && (spec.backdrops || []).length > 1;
  const frames = reel ? spec.backdrops.length * 16 : GIF.frames;
  const pngs = await browser.renderFramesHtml(coverHtml(spec), { frames, scale: GIF.scale });
  return gif.encodeGif(pngs.map(gif.decodePng), { delayMs: reel ? 90 : GIF.delayMs });
}

function writeAtomic(file, buf) {
  fs.writeFileSync(file + '.tmp', buf);
  fs.renameSync(file + '.tmp', file);
}

/**
 * Refait les cartes dont les images ont changé (au plus une fois par jour et par carte) :
 * d'abord toutes les images fixes (rapides), puis les GIF animés.
 * deps : { serviceTop10, sagaArt } (injectés pour éviter les dépendances circulaires).
 */
/**
 * Les cartes des plateformes montrent les affiches de leur Top 10 : elles attendent les classements.
 * Les autres (chaînes, genres, sagas, animés) peuvent se faire pendant la lecture des classements.
 */
const needsTop10 = (spec) => spec.kind === 'service' && !!(spec.ref.fp || spec.ref.id === 'netflix');

function refresh(key, deps, { force = false, only = null } = {}) {
  if (DISABLED || !key) return Promise.resolve({ rendered: 0, skipped: 0 });
  // Une mise à jour à la fois : la suivante attend la fin de celle en cours.
  if (running) return running.catch(() => {}).then(() => refresh(key, deps, { force, only }));
  running = (async () => {
    fs.mkdirSync(DYN_DIR, { recursive: true });
    const index = readIndex();
    const saveIndex = () => fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
    let rendered = 0;
    let skipped = 0;
    let failed = 0;
    let gifs = 0;
    let stop = false;
    const specs = baseSpecs().filter((spec) => !only || only(spec));
    const fail = (id, err) => {
      failed++;
      if (failed <= 3) console.warn(`[cartes] ${id} : ${err.message}`);
      if (/aucun navigateur/.test(err.message)) stop = true;
    };
    Object.assign(progress, { running: true, stage: 'plan', done: 0, total: specs.length, pending: [], startedAt: Date.now() });

    // 1. Préparation : images TMDB du moment et liste de ce qui est à refaire (la page de
    //    configuration montre alors précisément les cartes en création).
    const jpgJobs = [];
    const gifJobs = [];
    for (const base of specs) {
      if (stop) break;
      progress.done++;
      try {
        let spec = await withArt(key, base, deps);
        const hasArt = !!(spec.backdrop || (spec.posters || []).length);
        if (!hasArt) spec = { ...base, layout: 'type' }; // la carte de base de public/covers reste servie
        const sig = signature(spec);
        const prev = index[spec.id] || {};
        const jpgFile = path.join(DYN_DIR, `${spec.id}.jpg`);
        const gifFile = path.join(DYN_DIR, `${spec.id}.gif`);
        const recent = prev.at && Date.now() - prev.at < 20 * 3600 * 1000;
        const design = designSignature(spec);
        const art = artSignature(spec);
        let jpgSig = prev.sig || sig;
        if (hasArt) {
          if (force || !fs.existsSync(jpgFile) || prev.design !== design || (prev.art !== art && !recent)) {
            jpgJobs.push({ spec, sig, design, art });
            jpgSig = sig;
          } else skipped++;
        }
        // Le GIF suit la carte fixe : refait quand ses images ou son design changent.
        const gifStale = prev.gifSig !== (hasArt ? jpgSig : sig) || prev.gifDesign !== design;
        if (GIF_ENABLED && !bundledGif(spec.id) && (force || !fs.existsSync(gifFile) || gifStale)) {
          // Carte fixe gardée (récente) mais images changées : le GIF suivra au prochain passage.
          const wait = hasArt && jpgSig !== sig && fs.existsSync(gifFile) && prev.gifDesign === design;
          if (!wait) gifJobs.push({ spec, sig: hasArt ? jpgSig : sig, design });
        }
      } catch (err) {
        fail(base.id, err);
      }
    }

    // Plusieurs cartes à la fois (un onglet chacune, voir browser.js).
    const runAll = async (jobs, stage, work) => {
      Object.assign(progress, { stage, done: 0, total: jobs.length, pending: jobs.map((j) => j.spec.id) });
      let next = 0;
      const worker = async () => {
        while (!stop && next < jobs.length) {
          const job = jobs[next++];
          try {
            await work(job);
            progress.stamp = Date.now();
          } catch (err) {
            fail(job.spec.id, err);
          }
          progress.done++;
          progress.pending = progress.pending.filter((id) => id !== job.spec.id);
        }
      };
      await Promise.all(Array.from({ length: GIF_WORKERS }, worker));
    };

    // 2. Cartes fixes.
    await runAll(jpgJobs, 'images', async (job) => {
      writeAtomic(path.join(DYN_DIR, `${job.spec.id}.jpg`), await browser.renderHtml(coverHtml(job.spec)));
      index[job.spec.id] = { ...(index[job.spec.id] || {}), sig: job.sig, design: job.design, art: job.art, at: Date.now() };
      saveIndex();
      rendered++;
    });
    // 3. Animations (même contenu que la carte fixe en place).
    await runAll(gifJobs, 'gif', async (job) => {
      writeAtomic(path.join(DYN_DIR, `${job.spec.id}.gif`), await renderGif(job.spec));
      index[job.spec.id] = { ...(index[job.spec.id] || { at: 0 }), gifSig: job.sig, gifDesign: job.design };
      saveIndex();
      gifs++;
    });
    if (rendered || gifs || failed) {
      console.log(`[cartes] ${rendered} carte(s) et ${gifs} GIF refait(s), ${skipped} à jour${failed ? `, ${failed} en échec` : ''}`);
    }
    return { rendered, gifs, skipped, failed };
  })().finally(() => {
    running = null;
    Object.assign(progress, { running: false, stage: '', done: 0, total: 0, pending: [] });
  });
  return running;
}

/** GIF tout faits livrés dans public/covers/ (animés : extraits de scènes cultes, montés une fois pour toutes). */
function bundledGif(id) {
  return /^anime-[a-z0-9]+$/.test(id) && fs.existsSync(path.join(STATIC_DIR, `${id}.gif`));
}

/**
 * Cartes de base livrées avec l'addon (public/covers/) à partir des cartes du moment de ce serveur
 * (data/covers/) : un nouvel utilisateur voit tout de suite de vraies cartes, puis les siennes les
 * remplacent. 1152×648 en JPEG 82 : indiscernable sur une télé, et le zip reste partageable.
 */
async function bundleCurrent() {
  const done = [];
  for (const spec of baseSpecs()) {
    const src = path.join(DYN_DIR, `${spec.id}.jpg`);
    if (!fs.existsSync(src)) continue;
    const b64 = fs.readFileSync(src).toString('base64');
    const html = `<!doctype html><html><body style="margin:0;background:#000"><img src="data:image/jpeg;base64,${b64}" style="display:block;width:1152px;height:648px"></body></html>`;
    fs.writeFileSync(path.join(STATIC_DIR, `${spec.id}.jpg`), await browser.renderHtml(html, { width: 1152, height: 648, quality: 82 }));
    done.push(spec.id);
  }
  return done;
}

/** Cartes de secours, sans images, dans public/covers/ (scripts/render-covers.js secours). */
async function renderStatic({ only = null } = {}) {
  fs.mkdirSync(STATIC_DIR, { recursive: true });
  const done = [];
  for (const spec of baseSpecs()) {
    if (only && !only.includes(spec.id)) continue;
    const jpg = await browser.renderHtml(coverHtml(spec));
    fs.writeFileSync(path.join(STATIC_DIR, `${spec.id}.jpg`), jpg);
    done.push(spec.id);
  }
  return done;
}

/**
 * Fichier à servir pour /covers/<nom> : carte du moment, sinon carte de secours.
 * Un GIF pas encore fabriqué est remplacé par la carte fixe (Nuvio affiche alors l'image sans animation).
 */
function resolveFile(name) {
  if (!/^[a-z0-9._-]+$/i.test(name)) return null;
  // GIF fournis avec l'addon (scènes cultes des animés) : toujours ceux-là.
  if (name.endsWith('.gif') && bundledGif(name.slice(0, -4))) {
    return { file: path.join(STATIC_DIR, name), maxAge: 24 * 3600, type: 'image/gif' };
  }
  const find = (n) => {
    const dyn = path.join(DYN_DIR, n);
    if (!DISABLED && fs.existsSync(dyn)) return { file: dyn, maxAge: 6 * 3600 };
    const st = path.join(STATIC_DIR, n);
    if (fs.existsSync(st)) return { file: st, maxAge: 24 * 3600 };
    return null;
  };
  const found = find(name);
  if (found) return { ...found, type: name.endsWith('.gif') ? 'image/gif' : 'image/jpeg' };
  if (name.endsWith('.gif')) {
    const still = find(name.replace(/\.gif$/, '.jpg'));
    if (still) return { ...still, maxAge: 3600, type: 'image/jpeg' };
  }
  return null;
}

module.exports = { coverId, coverHtml, baseSpecs, withArt, refresh, needsTop10, renderGif, renderStatic, bundleCurrent, resolveFile, progress, GIF, DESIGN_VERSION };
