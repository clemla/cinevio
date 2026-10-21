(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c) n.append(c);
    return n;
  };

  const TYPE_LABEL = { movie: 'Films', series: 'Séries' };
  const ROW_NAME = {
    top10: (s) => `Top 10 ${s.name}`,
    new: () => 'Nouveautés',
    popular: () => 'Populaires',
    toprated: () => 'Mieux notés',
    soon: (s) => `Bientôt sur ${s.name}`,
  };

  let info = null;
  let state = null;

  /* ---------- Cartes : adresse avec un tampon, pour voir tout de suite les cartes refaites ---------- */

  let coverStamp = Date.now();
  const coverUrl = (name, ext = 'jpg') => `/covers/${name}.${ext}?t=${coverStamp}`;
  function coverImg(name, attrs = {}) {
    const img = el('img', { src: coverUrl(name), alt: '', loading: 'lazy', ...attrs });
    img.dataset.cover = name;
    img.dataset.ext = 'jpg';
    return img;
  }
  function refreshCovers() {
    document.querySelectorAll('img[data-cover]').forEach((img) => { img.src = coverUrl(img.dataset.cover, img.dataset.ext); });
    const hero = $('#folder-hero');
    if (hero.dataset.cover) hero.style.backgroundImage = `url(${coverUrl(hero.dataset.cover)})`;
  }
  /** Pendant que le serveur refait les cartes : on l'indique, et on recharge les images au fur et à mesure. */
  /** Cartes en cours de création (ids), marquées sur l'aperçu et dans les choix de plateformes. */
  let building = { stage: '', pending: new Set() };
  function markCovers() {
    document.querySelectorAll('img[data-cover]').forEach((img) => {
      const host = img.closest('.tile, .pick');
      if (!host) return;
      const on = building.pending.has(img.dataset.cover);
      host.classList.toggle('creating', on && building.stage === 'images');
      host.classList.toggle('animating', on && building.stage === 'gif' && host.classList.contains('tile'));
    });
  }

  async function watchCovers(p) {
    const box = $('#build');
    // La préparation (affiches du moment) est souvent rapide : bandeau seulement si elle dure.
    const visible = p && p.running && (p.stage !== 'plan' || p.elapsed > 3000);
    if (!p || !p.running) {
      box.hidden = true;
      building = { stage: '', pending: new Set() };
      markCovers();
      if (watchCovers.was) { coverStamp = Date.now(); refreshCovers(); }
      watchCovers.was = false;
      return;
    }
    watchCovers.was = true;
    box.hidden = !visible;
    box.classList.toggle('plan', p.stage === 'plan');
    const titles = { plan: 'Préparation des cartes', images: 'Création des cartes', gif: 'Création des animations' };
    $('#build-title').textContent = titles[p.stage] || 'Création des cartes';
    $('#build-count').textContent = p.stage === 'plan' ? '' : `${p.done} sur ${p.total}`;
    $('#build-fill').style.width = p.total ? `${Math.round((p.done / p.total) * 100)}%` : '0';
    $('#build-note').textContent = p.stage === 'plan'
      ? 'Récupération des affiches du moment.'
      : 'Tu peux déjà installer : les cartes se mettent à jour toutes seules, ici et dans Nuvio.';
    building = { stage: p.stage, pending: new Set(p.pending || []) };
    if (p.stamp && p.stamp !== watchCovers.stamp) { watchCovers.stamp = p.stamp; coverStamp = p.stamp; refreshCovers(); }
    markCovers();
    setTimeout(async () => watchCovers(await fetch('/api/covers').then((r) => r.json()).catch(() => null)), 2000);
  }

  /* ---------- Config <-> URL ---------- */

  const b64url = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (str) => decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));

  function configFromPath() {
    const first = location.pathname.split('/').filter(Boolean)[0];
    if (!first || first === 'configure') return null;
    try { return JSON.parse(unb64url(first)); } catch { return null; }
  }

  function defaultState() {
    return {
      v: 1,
      keys: { tmdb: '', fanart: '', mdblist: '' },
      platforms: info.platforms.map((p) => p.id),
      channels: info.channels.map((c) => c.id),
      genres: true,
      sagas: true,
      anime: true,
      realityTv: true,
      rows: Object.fromEntries(info.rows.map((r) => [r.id, true])),
    };
  }

  const cfgString = () => b64url(JSON.stringify(state));
  const base = () => `${location.origin}/${cfgString()}`;

  /* ---------- Lien public Cloudflare ---------- */

  let tunnel = { mode: 'off' };
  let where = 'public';
  /** Page ouverte en local (pas déjà par le lien Cloudflare) avec un tunnel demandé. */
  const tunnelChoice = () => tunnel.mode !== 'off' && !(tunnel.url && tunnel.url === location.origin);
  const wantsPublic = () => tunnelChoice() && where === 'public';
  /** Adresse mise dans les liens d'installation : le lien Cloudflare si on veut l'utiliser partout. */
  const linkOrigin = () => (wantsPublic() && tunnel.state === 'ready' ? tunnel.url : location.origin);
  const linkBase = () => `${linkOrigin()}/${cfgString()}`;
  const isLocalPage = () => /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(location.hostname);

  function showTunnel() {
    $('#where').hidden = !tunnelChoice();
    $('#tunnel-off').hidden = tunnel.mode !== 'off' || !isLocalPage();
    const st = $('#tunnel-state');
    st.className = 'tunnel-state';
    if (!tunnelChoice()) return;
    if (where === 'local') {
      st.textContent = 'Liens en localhost : ils ne marchent que sur ce PC.';
    } else if (tunnel.state === 'ready') {
      st.classList.add('ready');
      st.textContent = tunnel.mode === 'quick'
        ? `Lien Cloudflare actif. Il change à chaque lancement du serveur : réinstalle alors l'addon dans Nuvio.`
        : 'Lien Cloudflare actif, à adresse fixe.';
    } else if (tunnel.state === 'error') {
      st.classList.add('error');
      st.textContent = `Lien Cloudflare indisponible : ${tunnel.error || 'erreur inconnue'}. Nouvel essai automatique.`;
    } else {
      st.textContent = tunnel.state === 'downloading'
        ? 'Téléchargement de cloudflared (une seule fois)…'
        : 'Création du lien Cloudflare…';
    }
  }

  async function watchTunnel(t) {
    if (t) tunnel = t;
    showTunnel();
    updateLinks();
    if (tunnel.mode !== 'off' && tunnel.state !== 'ready') {
      setTimeout(async () => watchTunnel(await fetch('/api/tunnel').then((r) => r.json()).catch(() => null)), 3000);
    } else if (tunnel.mode === 'quick') {
      // Le tunnel rapide peut redémarrer avec une autre adresse : on vérifie de temps en temps.
      setTimeout(async () => watchTunnel(await fetch('/api/tunnel').then((r) => r.json()).catch(() => null)), 30000);
    }
  }

  /* ---------- Formulaire ---------- */

  /** Choix d'une plateforme ou chaîne : sa carte, en couleur quand elle est choisie. */
  function chip(service, group) {
    const input = el('input', { type: 'checkbox', value: service.id, 'aria-label': service.name });
    input.checked = state[group].includes(service.id);
    input.addEventListener('change', () => {
      const set = new Set(state[group]);
      input.checked ? set.add(service.id) : set.delete(service.id);
      const order = (group === 'channels' ? info.channels : info.platforms).map((s) => s.id);
      state[group] = order.filter((id) => set.has(id));
      updateCounts();
      changed();
    });
    const img = coverImg(service.id);
    const label = el('label', { class: 'pick has-img', title: service.name, style: `background:${service.colors[1] || '#1a1430'}` },
      [img, input, el('span', { class: 'label', text: service.name }), el('span', { class: 'tick', 'aria-hidden': 'true' })]);
    img.addEventListener('error', () => { img.remove(); label.classList.remove('has-img'); });
    return label;
  }

  function updateCounts() {
    const txt = (n, total) => (n === total ? 'toutes' : `${n} sur ${total}`);
    $('#platform-count').textContent = txt(state.platforms.length, info.platforms.length);
    $('#channel-count').textContent = txt((state.channels || []).length, info.channels.length);
  }

  /** Clés facultatives : on dit clairement si elles servent, et d'où elles viennent. */
  function updateExtras() {
    const parts = [];
    for (const [k, name, on] of [['fanart', 'Fanart.tv', 'logos HD activés'], ['mdblist', 'MDBList', 'notes IMDb activées']]) {
      const tag = $(`#${k}-state`);
      const active = !!state.keys[k] || info.serverKeys[k];
      tag.textContent = state.keys[k] ? on : info.serverKeys[k] ? 'déjà fournie par ce serveur' : (k === 'fanart' ? 'logos en haute définition' : 'notes IMDb');
      tag.classList.toggle('done', active);
      if (active) parts.push(name);
    }
    $('#extras-note').textContent = parts.length ? `Actives : ${parts.join(' et ')}.` : 'Fanart.tv et MDBList. Tout marche sans.';
  }

  function buildForm() {
    $('#platform-chips').replaceChildren(...info.platforms.map((p) => chip(p, 'platforms')));
    $('#channel-chips').replaceChildren(...info.channels.map((c) => chip(c, 'channels')));
    for (const k of ['genres', 'sagas', 'anime']) {
      const box = $(`#${k}`);
      box.checked = state[k] !== false;
      box.addEventListener('change', () => { state[k] = box.checked; changed(); });
    }

    const rowHelp = {
      top10: 'Classement du jour en France, films et séries',
      new: 'Dernières sorties disponibles sur la plateforme',
      popular: 'Ce qui marche le mieux en ce moment',
      toprated: 'Les mieux notés du catalogue',
      soon: 'Ce qui arrive prochainement',
    };
    $('#row-checks').replaceChildren(...info.rows.map((r) => {
      const input = el('input', { type: 'checkbox', class: 'switch' });
      input.checked = !!state.rows[r.id];
      input.addEventListener('change', () => { state.rows[r.id] = input.checked; changed(); });
      return el('label', { class: 'check' }, [input, el('span', {}, [r.label, el('small', { text: rowHelp[r.id] || '' })])]);
    }));

    for (const k of ['tmdb', 'fanart', 'mdblist']) {
      const input = $(`#k-${k}`);
      input.value = state.keys[k] || '';
      input.addEventListener('input', () => { state.keys[k] = input.value.trim(); updateExtras(); changed(true); });
    }
    if (state.keys.fanart || state.keys.mdblist) $('#extras').open = true;
    updateExtras();
    updateCounts();
    markCovers();
    const reality = $('#reality-tv');
    reality.checked = state.realityTv !== false;
    reality.addEventListener('change', () => { state.realityTv = reality.checked; changed(); });

    document.querySelectorAll('.toggle-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.for);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Masquer' : 'Afficher';
      });
    });
    document.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => copy($(`#${btn.dataset.copy}`).value, 'Lien copié.'));
    });
    $('#copy-manifest').addEventListener('click', () => copy($('#manifest-url').value, "Lien de l'addon copié. Colle-le dans Nuvio."));
    $('#copy-json').addEventListener('click', async () => {
      const res = await fetch(`${linkBase()}/collection.json`);
      copy(JSON.stringify(await res.json(), null, 2), 'JSON des collections copié.');
    });
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.textContent = ''; }, 3000);
  }

  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Copie impossible : sélectionne le texte à la main.'); }
  }

  function hasTmdb() {
    return info.demo || info.serverKeys.tmdb || !!state.keys.tmdb;
  }

  function updateLinks() {
    const manifest = `${linkBase()}/manifest.json`;
    $('#manifest-url').value = manifest;
    $('#collection-url').value = `${linkBase()}/collection.json`;
    $('#install-link').href = manifest.replace(/^https?:\/\//, 'stremio://');
    $('#download-collection').href = `${linkBase()}/collection.json?download=1`;
    const waiting = wantsPublic() && tunnel.state !== 'ready';
    const ok = hasTmdb() && !waiting;
    for (const id of ['install-link', 'download-collection', 'copy-manifest', 'copy-json']) $(`#${id}`).setAttribute('aria-disabled', String(!ok));
    const dock = $('#dock-state');
    dock.textContent = !hasTmdb() ? 'Ajoute ta clé TMDB (étape 1) pour installer.'
      : waiting ? 'Lien Cloudflare en cours de création…'
      : wantsPublic() ? 'Prêt à installer, avec le lien Cloudflare : marche partout.'
      : 'Prêt à installer : ajoute l\'addon, puis importe les collections sur nuvio.tv.';
    dock.classList.toggle('ready', ok);
    const req = $('#tmdb-req');
    req.textContent = info.serverKeys.tmdb ? 'facultatif sur ce serveur' : state.keys.tmdb ? 'renseignée' : 'obligatoire';
    req.classList.toggle('done', !!state.keys.tmdb || info.serverKeys.tmdb);
    history.replaceState(null, '', `/${cfgString()}/configure`);
  }

  let timer = null;
  function changed(slow = false) {
    updateLinks();
    clearTimeout(timer);
    timer = setTimeout(renderPreview, slow ? 700 : 150);
  }

  /* ---------- Aperçu ---------- */

  const metaCache = new Map();
  async function fetchCatalog(type, id) {
    const key = `${cfgString()}|${type}|${id}`;
    if (!metaCache.has(key)) {
      metaCache.set(key, fetch(`${base()}/catalog/${type}/${id}.json`)
        .then((r) => (r.ok ? r.json() : { metas: [] }))
        .then((d) => d.metas || [])
        .catch(() => []));
    }
    return metaCache.get(key);
  }

  function imgNode(m) {
    const img = el('img', { src: m.poster || '', alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.remove());
    return el('div', { class: 'img' }, img);
  }

  function itemNode(m) {
    return el('div', { class: 'poster', title: m.name }, [imgNode(m), el('div', { class: 'name', text: m.name })]);
  }

  function skeletons(n) {
    return Array.from({ length: n }, () =>
      el('div', { class: 'poster skeleton' }, [el('div', { class: 'img' }), el('div', { class: 'name', text: ' ' })]));
  }

  /**
   * Rangée défilante : flèches ‹ › au survol (la molette d'une souris ne défile pas à l'horizontale).
   * Les flèches se cachent en début et en fin de rangée.
   */
  function scroller(inner, extraClass = '') {
    const step = (dir) => {
      const from = inner.scrollLeft;
      const delta = dir * Math.max(160, inner.clientWidth * 0.8);
      inner.scrollBy({ left: delta, behavior: 'smooth' });
      // Si le défilement fluide ne démarre pas (animations coupées), on saute directement.
      setTimeout(() => { if (Math.abs(inner.scrollLeft - from) < 1) inner.scrollLeft = from + delta; }, 350);
    };
    const prev = el('button', { type: 'button', class: 'nav prev', 'aria-label': 'Défiler vers la gauche', onclick: () => step(-1) }, '‹');
    const next = el('button', { type: 'button', class: 'nav next', 'aria-label': 'Défiler vers la droite', onclick: () => step(1) }, '›');
    const wrap = el('div', { class: `scroller ${extraClass}`.trim() });
    if (inner.parentNode) inner.parentNode.insertBefore(wrap, inner);
    wrap.append(inner, prev, next);
    const update = () => {
      const max = inner.scrollWidth - inner.clientWidth - 2;
      prev.hidden = inner.scrollLeft <= 2;
      next.hidden = inner.scrollLeft >= max;
    };
    inner.addEventListener('scroll', update, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(update).observe(inner);
    new MutationObserver(() => requestAnimationFrame(update)).observe(inner, { childList: true, subtree: true });
    inner.addEventListener('load', update, true); // affiches chargées : la largeur change
    requestAnimationFrame(update);
    return wrap;
  }

  /** Rangée de cartes ; chaque dossier : { key, name, cover, sources: [{ label, type, id }] }. */
  function tileRow(title, folders, note) {
    const strip = el('div', { class: 'strip' }, folders.map((f) => {
      const img = coverImg(f.cover);
      // Comme sur la télé : l'animation se lance quand la carte a le focus.
      const play = () => { img.dataset.ext = 'gif'; img.src = coverUrl(f.cover, 'gif'); };
      const stop = () => { img.dataset.ext = 'jpg'; img.src = coverUrl(f.cover); };
      return el('button', {
        type: 'button', class: 'tile', 'aria-label': `Ouvrir ${f.name}`, onclick: () => openFolder(f),
        onmouseenter: play, onmouseleave: stop, onfocus: play, onblur: stop,
      }, img);
    }));
    return el('div', { class: 'row' }, [el('h3', { class: 'row-title' }, [title, note ? el('small', { text: note }) : null]), scroller(strip)]);
  }

  function posterRow(title, type, id, note) {
    const strip = el('div', { class: 'strip' }, skeletons(8));
    const wrapped = scroller(strip);
    const row = el('div', { class: 'row' }, [el('h3', { class: 'row-title' }, [title, note ? el('small', { text: note }) : null]), wrapped]);
    fetchCatalog(type, id).then((metas) => {
      if (!metas.length) {
        wrapped.replaceWith(el('p', { class: 'empty', text: 'Rien pour le moment. Les classements se remplissent dans les minutes qui suivent le démarrage du serveur.' }));
        return;
      }
      strip.replaceChildren(...metas.map(itemNode));
    });
    return row;
  }

  function renderPreview() {
    closeFolder();
    const home = $('#home');
    if (!hasTmdb()) {
      home.replaceChildren(el('p', { class: 'empty', text: 'Ajoute ta clé TMDB (étape 1) pour voir ton accueil avec les vrais titres, affiches et résumés en français.' }));
      return;
    }
    const platforms = info.platforms.filter((p) => state.platforms.includes(p.id));
    const channels = info.channels.filter((c) => (state.channels || []).includes(c.id));
    const hero = el('div', { class: 'hero' });
    const nodes = [hero];
    fillHero(hero);
    if (platforms.length) nodes.push(tileRow('Plateformes', platforms.map(serviceFolder), 'collection'));
    nodes.push(posterRow('Top 10 du moment · Films', 'movie', 'nfr.top10', 'en tendance, streaming et cinéma'));
    nodes.push(posterRow('Top 10 du moment · Séries', 'series', 'nfr.top10', 'en tendance sur les plateformes'));
    if (state.realityTv !== false) nodes.push(posterRow('Télé-réalité FR', 'series', 'nfr.realitytv', 'en ce moment'));
    if (channels.length) nodes.push(tileRow('Chaînes', channels.map(serviceFolder), 'collection'));
    if (state.genres !== false) nodes.push(tileRow('Genres', info.genres.map(genreFolder), 'collection'));
    if (state.sagas !== false) nodes.push(tileRow('Sagas & univers', info.sagas.map(sagaFolder), 'collection'));
    if (state.anime !== false && info.anime) nodes.push(tileRow('Animés', info.anime.map(animeFolder), 'collection'));
    home.replaceChildren(...nodes);
    markCovers();
  }

  /** Grand bandeau de l'accueil : un titre du Top 10, avec son fond et son logo. */
  async function fillHero(hero) {
    const [movies, series] = await Promise.all([fetchCatalog('movie', 'nfr.top10'), fetchCatalog('series', 'nfr.top10')]);
    const pool = [...movies.slice(0, 5), ...series.slice(0, 5)].filter((m) => m.background || m.poster);
    if (!pool.length) { hero.remove(); return; }
    const m = pool[Math.floor(Math.random() * pool.length)];
    hero.style.backgroundImage = `url("${(m.background || m.poster).replace(/"/g, '%22')}")`;
    const title = el('h3', { class: 'hero-title', text: m.name });
    const text = el('div', { class: 'hero-text' }, [
      m.logo ? el('img', { class: 'hero-logo', src: m.logo, alt: m.name }) : null,
      m.logo ? null : title,
      el('p', { class: 'hero-meta', text: [m.type === 'movie' ? 'Film' : 'Série', m.releaseInfo, m.imdbRating ? `★ ${m.imdbRating}` : ''].filter(Boolean).join('   ') }),
      m.description ? el('p', { class: 'hero-desc', text: m.description }) : null,
    ]);
    const logo = text.querySelector('.hero-logo');
    if (logo) logo.addEventListener('error', () => { logo.replaceWith(title); });
    hero.append(text);
  }

  /* ---------- Dossier ---------- */

  /** Mêmes règles que le serveur : pas de Top 10 sans classement, pas de « Bientôt » pour les chaînes. */
  function serviceFolder(service) {
    const sources = [];
    for (const r of info.rows) {
      if (!state.rows[r.id]) continue;
      if (r.id === 'top10' && !service.top10) continue;
      if (r.id === 'soon' && !service.soon) continue;
      for (const type of service.types) {
        sources.push({ label: `${ROW_NAME[r.id](service)} · ${TYPE_LABEL[type]}`, type, id: `nfr.${service.id}.${r.id}` });
      }
    }
    return { key: service.id, name: service.name, cover: service.id, sources };
  }

  function genreFolder(genre) {
    const sources = [];
    for (const r of info.genreRows) {
      for (const type of genre.types) sources.push({ label: `${r.label} · ${TYPE_LABEL[type]}`, type, id: `nfr.g.${genre.id}.${r.id}` });
    }
    return { key: `genre-${genre.id}`, name: genre.name, cover: `genre-${genre.id}`, sources };
  }

  /** Dossier d'animés : les rangées « où les regarder » suivent les plateformes choisies. */
  function animeFolder(folder) {
    const rows = folder.rows.filter((r) => !r.platform || state.platforms.includes(r.platform));
    return {
      key: `anime-${folder.id}`, name: folder.name, cover: `anime-${folder.id}`,
      sources: rows.map((r) => ({ label: r.label, type: r.type, id: `nfr.a.${folder.id}.${r.id}` })),
    };
  }

  function sagaFolder(saga) {
    return {
      key: `saga-${saga.id}`, name: saga.name, cover: `saga-${saga.id}`,
      sources: saga.types.map((type) => ({ label: saga.ordered ? "Dans l'ordre de l'histoire" : TYPE_LABEL[type], type, id: `nfr.s.${saga.id}` })),
    };
  }

  function openFolder(folderInfo) {
    const folder = $('#folder');
    const tabsEl = $('#folder-tabs');
    if (!tabsEl.parentNode.classList.contains('scroller')) scroller(tabsEl, 'tabs-wrap');
    $('#folder-hero').dataset.cover = folderInfo.cover;
    $('#folder-hero').style.backgroundImage = `url(${coverUrl(folderInfo.cover)})`;
    const sources = folderInfo.sources;
    const service = { id: folderInfo.key };
    const tabs = $('#folder-tabs');
    const grid = $('#folder-grid');
    if (!sources.length) {
      tabs.replaceChildren();
      grid.replaceChildren(el('p', { class: 'empty', text: 'Aucune rangée cochée à l\'étape 3.' }));
    } else {
      const select = async (i) => {
        tabs.querySelectorAll('.tab').forEach((t, j) => t.setAttribute('aria-selected', String(i === j)));
        const s = sources[i];
        grid.replaceChildren(...skeletons(12));
        const metas = await fetchCatalog(s.type, s.id);
        if (tabs.dataset.current !== `${service.id}:${i}`) return;
        grid.replaceChildren(...(metas.length ? metas.map(itemNode)
          : [el('p', { class: 'empty', text: 'Rien à afficher pour l\'instant dans cette rangée.' })]));
      };
      tabs.replaceChildren(...sources.map((s, i) => el('button', {
        type: 'button', class: 'tab', role: 'tab',
        onclick: () => { tabs.dataset.current = `${service.id}:${i}`; select(i); },
      }, s.label)));
      tabs.dataset.current = `${service.id}:0`;
      select(0);
    }
    $('#home').hidden = true;
    folder.hidden = false;
    folder.scrollTop = 0;
    $('#folder-back').focus();
  }

  function closeFolder() {
    $('#folder').hidden = true;
    $('#home').hidden = false;
  }

  /* ---------- Démarrage ---------- */

  async function init() {
    info = await fetch('/api/info').then((r) => r.json());
    document.querySelectorAll('[data-addon-name]').forEach((n) => { n.textContent = info.addonName; });
    document.title = `${info.addonName} – configuration`;
    $('#demo-badge').hidden = !info.demo;

    state = defaultState();
    const fromUrl = configFromPath();
    if (fromUrl) {
      state = {
        ...state,
        ...fromUrl,
        keys: { ...state.keys, ...(fromUrl.keys || {}) },
        rows: { ...state.rows, ...(fromUrl.rows || {}) },
      };
    }
    buildForm();
    $('#folder-back').addEventListener('click', closeFolder);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#folder').hidden) closeFolder(); });
    updateLinks();
    renderPreview();
    watchCovers(info.covers);
    document.querySelectorAll('input[name="where"]').forEach((r) => r.addEventListener('change', () => {
      where = r.value; showTunnel(); updateLinks();
    }));
    watchTunnel(info.tunnel || { mode: 'off' });
  }

  init().catch((err) => {
    $('#home').replaceChildren(el('p', { class: 'empty', text: `Le serveur ne répond pas (${err.message}).` }));
  });
})();
