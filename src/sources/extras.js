'use strict';

/** Fanart.tv (logos en français) et MDBList (note IMDb). Tous deux optionnels. */

const { request } = require('../http');
const cache = require('../cache');

const DAY = 86400;

function pickLogo(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const byLang = (lang) => list.filter((l) => l.lang === lang).sort((a, b) => Number(b.likes) - Number(a.likes))[0];
  const pick = byLang('fr') || byLang('en') || byLang('00') || list[0];
  return pick ? pick.url : null;
}

/** kind 'movie' → id TMDB ; kind 'tv' → id TVDB (Fanart indexe les séries par TVDB). */
async function fanartLogo(key, kind, id) {
  if (!key || !id) return null;
  return cache.wrap(`fanart:${kind}:${id}`, 7 * DAY, async () => {
    const path = kind === 'movie' ? `movies/${id}` : `tv/${id}`;
    try {
      const data = await request(`https://webservice.fanart.tv/v3/${path}?api_key=${encodeURIComponent(key)}`, { timeout: 8000 });
      if (!data) return '';
      return pickLogo(kind === 'movie' ? data.hdmovielogo || data.movielogo : data.hdtvlogo || data.clearlogo) || '';
    } catch {
      return '';
    }
  }, true);
}

/** Note IMDb via MDBList. Renvoie une chaîne « 7.8 » ou null. */
async function mdblistRating(key, kind, imdb) {
  if (!key || !imdb) return null;
  return cache.wrap(`mdblist:${imdb}`, 3 * DAY, async () => {
    const type = kind === 'movie' ? 'movie' : 'show';
    try {
      const data = await request(`https://api.mdblist.com/imdb/${type}/${imdb}?apikey=${encodeURIComponent(key)}`, { timeout: 8000 });
      const r = data && Array.isArray(data.ratings) ? data.ratings.find((x) => x.source === 'imdb') : null;
      return r && r.value ? Number(r.value).toFixed(1) : '';
    } catch {
      return '';
    }
  }, true);
}

module.exports = { fanartLogo, mdblistRating, pickLogo };
