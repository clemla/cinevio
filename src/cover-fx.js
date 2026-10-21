'use strict';

/**
 * Ambiances animées des cartes de genre, façon bande-annonce : lumière et atmosphère
 * (reflets d'objectif, rayons, flou de profondeur, pellicule), jamais d'objets dessinés.
 * Quatre calques : back et bl (lumière, mélange « écran ») sous le voile sombre ;
 * lt (lumière, « écran ») et front au-dessus du voile, sous le nom.
 * Tout est fonction de t (0 → 1) avec des nombres de tours entiers : le GIF boucle sans saut.
 * Le code ci-dessous tourne dans la page (Chrome), pas dans Node : il est injecté tel quel.
 */

const FX_IDS = ['action', 'comedie', 'thriller', 'policier', 'sf', 'fantastique', 'horreur', 'drame', 'romance', 'animation', 'docu', 'famille'];

const FX_SCRIPT = String.raw`
(() => {
  const W = 1280, H = 720, TAU = Math.PI * 2;
  const frac = (x) => x - Math.floor(x);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (x) => x * x * (3 - 2 * x);
  const wave = (t, k, ph) => (1 - Math.cos(TAU * (t * k + (ph || 0)))) / 2; // 0 → 1 → 0, boucle
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const make = (n, seed, fn) => { const r = rng(seed); return Array.from({ length: n }, (_, i) => fn(r, i)); };

  /** Tache de lumière douce. c = 'r,g,b'. */
  function blob(ctx, x, y, r, c, a) {
    if (a <= 0.003 || r <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + c + ',' + a + ')');
    g.addColorStop(0.35, 'rgba(' + c + ',' + a * 0.55 + ')');
    g.addColorStop(1, 'rgba(' + c + ',0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  /** Bokeh : disque net au bord, plein clair, comme un point lumineux hors mise au point. */
  function bokeh(ctx, x, y, r, c, a) {
    if (a <= 0.003) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + c + ',' + a * 0.55 + ')');
    g.addColorStop(0.82, 'rgba(' + c + ',' + a * 0.75 + ')');
    g.addColorStop(0.94, 'rgba(' + c + ',' + a + ')');
    g.addColorStop(1, 'rgba(' + c + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  /** Reflet anamorphique : longue traînée horizontale + cœur lumineux. */
  function anamorphic(ctx, x, y, len, c, a) {
    if (a <= 0.003) return;
    const g = ctx.createLinearGradient(x - len, 0, x + len, 0);
    g.addColorStop(0, 'rgba(' + c + ',0)'); g.addColorStop(0.5, 'rgba(' + c + ',' + a + ')'); g.addColorStop(1, 'rgba(' + c + ',0)');
    ctx.fillStyle = g; ctx.fillRect(x - len, y - 3, len * 2, 6);
    ctx.globalAlpha = 0.5; ctx.fillRect(x - len * 0.6, y - 14, len * 1.2, 28); ctx.globalAlpha = 1;
    blob(ctx, x, y, 90, '255,255,255', a * 0.9);
    blob(ctx, x, y, 260, c, a * 0.45);
  }
  /** Reflets fantômes de l'objectif, alignés entre la source et le centre. */
  function ghosts(ctx, sx, sy, c, a) {
    const cx = W * 0.55, cy = H * 0.5;
    [[0.6, 34, 0.35], [1.25, 18, 0.5], [1.6, 60, 0.18], [2.1, 26, 0.3]].forEach(([k, r, w]) => {
      const x = sx + (cx - sx) * k, y = sy + (cy - sy) * k;
      bokeh(ctx, x, y, r, c, a * w);
    });
  }
  /** Rayons de lumière depuis une source (lumière volumétrique). */
  function rays(ctx, sx, sy, angle, spread, n, len, c, a, t, seed) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
      const base = angle + (r() - 0.5) * spread;
      const w = 0.02 + r() * 0.05;
      const k = 0.35 + 0.65 * wave(t, 1 + (i % 2), r());
      const g = ctx.createLinearGradient(sx, sy, sx + Math.cos(base) * len, sy + Math.sin(base) * len);
      g.addColorStop(0, 'rgba(' + c + ',' + a * k + ')'); g.addColorStop(1, 'rgba(' + c + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(base - w) * len, sy + Math.sin(base - w) * len);
      ctx.lineTo(sx + Math.cos(base + w) * len, sy + Math.sin(base + w) * len);
      ctx.closePath(); ctx.fill();
    }
  }
  /** Poussière en suspension, éclairée (profondeur : les proches sont flous et plus gros). */
  function motes(ctx, list, t, c, a, lit) {
    for (const m of list) {
      const x = m.x + 26 * Math.sin(TAU * (t * m.k + m.ph)), y = m.y - 40 * frac(m.b + t) + 20 * Math.cos(TAU * (t * m.k + m.ph));
      const l = lit ? lit(x, y) : 1;
      const tw = 0.55 + 0.45 * wave(t, m.k + 1, m.ph);
      if (m.z > 0.75) bokeh(ctx, x, y, 6 + m.z * 14, c, a * 0.35 * l * tw);
      else { ctx.fillStyle = 'rgba(' + c + ',' + a * l * tw + ')'; ctx.beginPath(); ctx.arc(x, y, 0.8 + m.z * 2.2, 0, TAU); ctx.fill(); }
    }
  }
  const moteList = (n, seed, x0 = 520) => make(n, seed, (r) => ({ x: x0 + r() * (W - x0 + 40), y: r() * H, b: r(), k: 1 + Math.floor(r() * 2), ph: r(), z: r() }));

  /* ---------- Action : reflet anamorphique, étincelles filées, chaleur ---------- */
  const sparks = make(95, 11, (r) => ({ x: 560 + r() * 760, b: r(), laps: 1 + Math.floor(r() * 2), v: 0.6 + r() * 0.6, l: 18 + r() * 40, ph: r(), z: r() }));
  function action(back, front, t, bl, lt) {
    back = bl; // lumière (mélange « écran »), sous le voile
    blob(back, 1050, 820, 760, '255,96,24', 0.5 + 0.12 * Math.sin(TAU * t * 3));
    blob(back, 1180, 120, 420, '255,170,80', 0.22);
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    // Étincelles filées (flou de mouvement), en remontant avec la chaleur.
    for (const s of sparks) {
      const p = frac(s.b + t * s.laps);
      const x = s.x - p * 260 + 30 * Math.sin(TAU * (p + s.ph)), y = 760 - p * 860;
      const a = clamp(Math.sin(Math.PI * p) * 1.4, 0, 1) * (0.45 + 0.55 * s.z);
      const g = front.createLinearGradient(x, y, x + s.l * 0.45, y + s.l);
      g.addColorStop(0, 'rgba(255,236,190,' + a + ')'); g.addColorStop(1, 'rgba(255,120,30,0)');
      front.strokeStyle = g; front.lineWidth = 1.2 + s.z * 2.2; front.lineCap = 'round';
      front.beginPath(); front.moveTo(x, y); front.lineTo(x + s.l * 0.45, y + s.l); front.stroke();
    }
    // Reflet anamorphique qui traverse l'image, puis éclair de lumière.
    const k = frac(t);
    anamorphic(front, 300 + 1100 * ease(k), 250, 900, '255,150,60', Math.sin(Math.PI * k));
    ghosts(front, 300 + 1100 * ease(k), 250, '255,180,110', 0.6 * Math.sin(Math.PI * k));
  }

  /* ---------- Comédie : soleil, voiles de lumière chauds, bokeh doré ---------- */
  const goldBokeh = make(22, 21, (r) => ({ x: 560 + r() * 760, y: r() * H, r: 18 + r() * 46, ph: r(), k: 1 + Math.floor(r() * 2), c: r() < 0.5 ? '255,214,120' : '255,170,120' }));
  function comedie(back, front, t, bl, lt) {
    back = bl; // lumière (mélange « écran »), sous le voile
    // Voiles de lumière (light leaks) qui glissent sur la pellicule.
    blob(back, 700 + 520 * wave(t, 1), 120, 520, '255,170,60', 0.55);
    blob(back, 1300 - 420 * wave(t, 1, 0.3), 560, 480, '255,90,120', 0.35);
    blob(back, 1150, -40, 420, '255,236,170', 0.5 + 0.2 * wave(t, 2));
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    for (const b of goldBokeh) bokeh(front, b.x + 30 * Math.sin(TAU * (t + b.ph)), b.y - 24 * Math.sin(TAU * (t * b.k + b.ph)), b.r, b.c, 0.14 + 0.26 * wave(t, b.k, b.ph));
    rays(front, 1240, -40, 2.2, 0.9, 7, 1100, '255,230,170', 0.24, t, 22);
  }

  /* ---------- Thriller : film noir, lumière à travers des stores ---------- */
  const noirDust = moteList(60, 31);
  function thriller(back, front, t, bl, lt) {
    back.fillStyle = 'rgba(1,2,10,0.66)'; back.fillRect(0, 0, W, H);
    // Bandes de lumière des stores, qui glissent lentement.
    back.save(); back.globalCompositeOperation = 'destination-out';
    back.translate(900, 360); back.rotate(-0.42);
    const shift = 140 * Math.sin(TAU * t);
    for (let i = -6; i <= 6; i++) {
      const y = i * 74 + shift;
      const g = back.createLinearGradient(0, y - 26, 0, y + 26);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, 'rgba(0,0,0,0.92)'); g.addColorStop(0.7, 'rgba(0,0,0,0.92)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      back.fillStyle = g; back.fillRect(-520, y - 26, 1040, 52);
    }
    back.restore();
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    blob(front, 1240, 60, 520, '150,170,255', 0.28);
    motes(front, noirDust, t, '210,220,255', 0.7);
  }

  /* ---------- Policier : gyrophares en reflet, nuit mouillée ---------- */
  const wet = moteList(40, 41);
  function policier(back, front, t, bl, lt) {
    const beam = (k, ph) => Math.pow(wave(t, k, ph), 3);
    const red = beam(4, 0), blue = beam(4, 0.5);
    back = bl; // lumière (mélange « écran »), sous le voile
    blob(back, 520, 120, 820, '255,30,60', 0.95 * red);
    blob(back, 1260, 160, 820, '30,90,255', blue);
    // Le faisceau tournant balaie le mur.
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    for (const [c, ph] of [['255,40,70', 0], ['50,110,255', 0.5]]) {
      const a = frac(t * 2 + ph);
      const x = -200 + a * 1800;
      const g = front.createLinearGradient(x - 260, 0, x + 260, 0);
      g.addColorStop(0, 'rgba(' + c + ',0)'); g.addColorStop(0.5, 'rgba(' + c + ',' + 0.45 * Math.sin(Math.PI * a) + ')'); g.addColorStop(1, 'rgba(' + c + ',0)');
      front.fillStyle = g; front.fillRect(x - 260, 0, 520, H);
    }
    anamorphic(front, 760, 110, 620, '255,60,90', 0.55 * red);
    anamorphic(front, 1180, 150, 620, '70,130,255', 0.6 * blue);
    motes(front, wet, t, '220,230,255', 0.45);
  }

  /* ---------- Science-fiction : rayons volumétriques, reflet bleu, poussière d'étoiles ---------- */
  const stars = make(90, 51, (r) => ({ x: 520 + r() * 800, y: r() * H, z: r(), ph: r() }));
  function sf(back, front, t, bl, lt) {
    back = bl; // lumière (mélange « écran »), sous le voile
    for (const s of stars) {
      const x = s.x - 90 * frac(s.ph + t) * (0.3 + s.z);
      back.fillStyle = 'rgba(200,255,250,' + (0.25 + 0.6 * s.z) * (0.5 + 0.5 * wave(t, 2, s.ph)) + ')';
      back.fillRect(x, s.y, 1 + s.z * 1.6, 1 + s.z * 1.6);
    }
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    rays(front, 1180, -60, 2.1, 0.7, 9, 1300, '60,240,220', 0.3, t, 52);
    const p = 0.55 + 0.45 * wave(t, 1);
    anamorphic(front, 1060, 120, 1000, '60,220,255', 0.95 * p);
    ghosts(front, 1060, 120, '90,255,230', 0.5 * p);
    // Ligne de balayage très fine.
    const y = frac(t) * H;
    const g = front.createLinearGradient(0, y - 60, 0, y);
    g.addColorStop(0, 'rgba(60,240,220,0)'); g.addColorStop(1, 'rgba(160,255,245,0.18)');
    front.fillStyle = g; front.fillRect(560, y - 60, W - 560, 60);
  }

  /* ---------- Fantastique : rayons divins, lucioles, scintillement ---------- */
  const fireflies = make(46, 61, (r) => ({ x: 560 + r() * 760, y: 80 + r() * 600, k: 1 + Math.floor(r() * 2), ph: r(), z: r(), c: r() < 0.6 ? '255,220,140' : '220,180,255' }));
  function fantastique(back, front, t, bl, lt) {
    back = bl; // lumière (mélange « écran »), sous le voile
    blob(back, 980, 300, 620, '170,100,255', 0.42 + 0.12 * wave(t, 1));
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    rays(front, 1020, -80, 1.75, 0.8, 11, 1100, '255,230,180', 0.28, t, 62);
    for (const f of fireflies) {
      const x = f.x + 40 * Math.sin(TAU * (t * f.k + f.ph)), y = f.y + 30 * Math.sin(TAU * (t * (f.k + 1) + f.ph * 2));
      const a = Math.pow(wave(t, f.k + 1, f.ph), 2);
      blob(front, x, y, 12 + f.z * 30, f.c, 0.8 * a);
      front.fillStyle = 'rgba(255,250,235,' + a + ')'; front.beginPath(); front.arc(x, y, 1 + f.z * 2, 0, TAU); front.fill();
    }
  }

  /* ---------- Horreur : ampoule qui grésille, brume, lueur rouge ---------- */
  const fog = make(10, 72, (r) => ({ b: r(), y: 430 + r() * 300, r: 260 + r() * 260, laps: r() < 0.5 ? 1 : -1 }));
  const flick = (() => { const r = rng(73); return Array.from({ length: 36 }, () => r()); })();
  function horreur(back, front, t, bl, lt) {
    for (const f of fog) blob(back, frac(f.b + t * f.laps) * (W + 800) - 400, f.y, f.r, '200,190,200', 0.13);
    back = bl; // lumière (mélange « écran »), sous le voile
    blob(back, 980, 360, 520, '255,20,40', 0.25 + 0.2 * wave(t, 2));
    // Lumière qui grésille : coupures franches, puis retour (même suite à chaque boucle).
    const i = Math.floor(t * 36) % 36;
    const off = (t > 0.46 && t < 0.52) || (t > 0.55 && t < 0.57) || flick[i] < 0.12;
    front.fillStyle = 'rgba(0,0,0,' + (off ? 0.62 : 0.06 * flick[i]) + ')'; front.fillRect(0, 0, W, H);
    // Ombre qui passe devant la lumière.
    const s = (t - 0.68) / 0.22;
    if (s > 0 && s < 1) {
      const x = 400 + s * 1100;
      const g = front.createLinearGradient(x - 220, 0, x + 220, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      front.fillStyle = g; front.fillRect(x - 220, 0, 440, H);
    }
    const v = front.createRadialGradient(W * 0.6, H / 2, 220, W * 0.6, H / 2, 860);
    v.addColorStop(0, 'rgba(60,0,6,0)'); v.addColorStop(1, 'rgba(60,0,6,0.65)');
    front.fillStyle = v; front.fillRect(0, 0, W, H);
  }

  /* ---------- Drame : pluie fine sur la vitre, lumières de ville floues ---------- */
  const rain = make(200, 81, (r) => ({ x: r() * (W + 200), b: r(), laps: 2 + Math.floor(r() * 2), l: 30 + r() * 70, z: r() }));
  const city = make(18, 82, (r) => ({ x: 560 + r() * 760, y: 120 + r() * 520, r: 30 + r() * 60, ph: r(), c: r() < 0.7 ? '255,190,120' : '150,190,255' }));
  function drame(back, front, t, bl, lt) {
    back = bl; // lumière (mélange « écran »), sous le voile
    for (const c of city) bokeh(back, c.x, c.y, c.r, c.c, 0.22 + 0.14 * wave(t, 1, c.ph));
    back.globalCompositeOperation = 'source-over';
    back.lineCap = 'round';
    for (const d of rain) {
      const p = frac(d.b + t * d.laps), y = -100 + p * 920, x = d.x - p * 120;
      const g = back.createLinearGradient(x, y, x - d.l * 0.14, y + d.l);
      g.addColorStop(0, 'rgba(210,222,240,0)'); g.addColorStop(1, 'rgba(210,222,240,' + (0.2 + 0.45 * d.z) + ')');
      back.strokeStyle = g; back.lineWidth = 0.8 + d.z * 1.4;
      back.beginPath(); back.moveTo(x, y); back.lineTo(x - d.l * 0.14, y + d.l); back.stroke();
    }
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    blob(front, 1100 - 200 * wave(t, 1), 200, 520, '255,200,150', 0.18);
  }

  /* ---------- Romance : heure dorée, bokeh rose, voile de lumière ---------- */
  const roseBokeh = make(26, 91, (r) => ({ x: 560 + r() * 760, y: r() * H, r: 20 + r() * 54, ph: r(), k: 1 + Math.floor(r() * 2), c: r() < 0.5 ? '255,150,190' : '255,210,170' }));
  function romance(back, front, t, bl, lt) {
    back = bl; // lumière (mélange « écran »), sous le voile
    blob(back, 1180, 140, 620, '255,150,120', 0.45 + 0.1 * wave(t, 1));
    blob(back, 760 + 300 * wave(t, 1, 0.25), 600, 460, '255,90,160', 0.3);
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    for (const b of roseBokeh) {
      const y = b.y - 60 * frac(t + b.ph);
      bokeh(front, b.x + 20 * Math.sin(TAU * (t + b.ph)), y, b.r, b.c, 0.12 + 0.26 * wave(t, b.k, b.ph));
    }
    const p = 0.6 + 0.4 * wave(t, 1);
    anamorphic(front, 1180, 150, 520, '255,180,150', 0.35 * p);
  }

  /* ---------- Animation : reflet irisé qui traverse, bulles de couleur ---------- */
  const orbs = make(20, 101, (r) => ({ x: 560 + r() * 760, y: r() * H, r: 22 + r() * 50, ph: r(), k: 1 + Math.floor(r() * 2), c: ['255,120,160', '120,210,255', '160,255,170', '255,220,120', '200,150,255'][Math.floor(r() * 5)] }));
  function animation(back, front, t, bl, lt) {
    back = bl; // lumière (mélange « écran »), sous le voile
    blob(back, 1000, 260, 600, '120,255,170', 0.3);
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    for (const o of orbs) bokeh(front, o.x + 30 * Math.sin(TAU * (t * o.k + o.ph)), o.y + 30 * Math.cos(TAU * (t + o.ph)), o.r, o.c, 0.14 + 0.24 * wave(t, o.k, o.ph));
    // Reflet irisé (comme sur une carte holographique).
    const k = frac(t * 1);
    const x = -300 + 1900 * ease(k);
    front.save(); front.translate(x, H / 2); front.rotate(0.35);
    const g = front.createLinearGradient(-200, 0, 200, 0);
    const a = 0.45 * Math.sin(Math.PI * k);
    ['255,90,150', '255,210,90', '120,255,170', '90,200,255', '190,120,255'].forEach((c, i) => g.addColorStop(i / 4, 'rgba(' + c + ',' + (i === 0 || i === 4 ? 0 : a) + ')'));
    front.fillStyle = g; front.fillRect(-200, -900, 400, 1800); front.restore();
  }

  /* ---------- Documentaires : pellicule 16 mm (scintillement, rayures, poussière) ---------- */
  const scratches = make(5, 111, (r) => ({ x: 560 + r() * 700, ph: r(), w: 1 + r() * 1.5 }));
  function docu(back, front, t, bl, lt) {
    const f = Math.floor(t * 36);
    const r = rng(1000 + (f % 36));
    back = bl; // lumière (mélange « écran »), sous le voile
    blob(back, 1100, 200, 600, '255,240,190', 0.3);
    // Scintillement de projection.
    front.fillStyle = r() < 0.5 ? 'rgba(255,245,220,' + r() * 0.06 + ')' : 'rgba(0,0,0,' + r() * 0.1 + ')';
    front.fillRect(0, 0, W, H);
    // Rayures verticales et poussière, différentes à chaque image (comme sur une vraie copie).
    for (const s of scratches) {
      if (wave(t, 3, s.ph) < 0.45) continue;
      front.fillStyle = 'rgba(255,250,235,' + (0.12 + r() * 0.2) + ')';
      front.fillRect(s.x + (r() - 0.5) * 6, 0, s.w, H);
    }
    for (let i = 0; i < 10; i++) {
      const x = 520 + r() * 760, y = r() * H;
      front.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.55)' : 'rgba(255,250,235,0.5)';
      front.beginPath(); front.ellipse(x, y, 1 + r() * 3, 1 + r() * 2, r() * 3, 0, TAU); front.fill();
    }
    if (r() < 0.25) {
      front.strokeStyle = 'rgba(0,0,0,0.5)'; front.lineWidth = 1.5; front.beginPath();
      const x = 600 + r() * 600, y = r() * H; front.moveTo(x, y);
      front.bezierCurveTo(x + 20, y + 10, x - 10, y + 30, x + 14, y + 46); front.stroke();
    }
    // Grain qui bouge.
    for (let i = 0; i < 900; i++) {
      front.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
      front.fillRect(r() * W, r() * H, 2, 2);
    }
  }

  /* ---------- En famille : soleil de fin de journée, reflets, poussière dorée ---------- */
  const golden = moteList(60, 121);
  function famille(back, front, t, bl, lt) {
    back = bl; // lumière (mélange « écran »), sous le voile
    blob(back, 1200, 80, 760, '255,170,70', 0.55);
    blob(back, 800, 650, 520, '255,120,60', 0.22 + 0.08 * wave(t, 1));
    front = lt; // lumière (mélange « écran »), au-dessus du voile
    const sx = 1180 + 30 * Math.sin(TAU * t), sy = 70 + 16 * Math.cos(TAU * t);
    rays(front, sx, sy, 2.3, 1.1, 10, 1300, '255,215,150', 0.18, t, 122);
    blob(front, sx, sy, 140, '255,250,230', 0.8);
    ghosts(front, sx, sy, '255,200,140', 0.55);
    motes(front, golden, t, '255,230,180', 0.75, (x, y) => clamp(1.3 - Math.hypot(x - sx, y - sy) / 900, 0.2, 1));
  }

  const FX = { action, comedie, thriller, policier, sf, fantastique, horreur, drame, romance, animation, docu, famille };
  const layers = ['fx-back', 'fx-back-light', 'fx-light', 'fx-front'].map((id) => document.getElementById(id));
  const id = document.body.dataset.fx;
  window.__fx = (t) => {
    if (layers.some((l) => !l) || !FX[id]) return;
    const [b, bl, lt, f] = layers.map((l) => l.getContext('2d'));
    for (const c of [b, bl, lt, f]) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0; }
    FX[id](b, f, t, bl, lt);
  };
})();
`;

module.exports = { FX_IDS, FX_SCRIPT };
