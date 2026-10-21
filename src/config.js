'use strict';

const { PLATFORMS, CHANNELS, ROWS } = require('./platforms');

/**
 * La config de chaque utilisateur est encodée (JSON → base64url) dans l'URL d'installation :
 *   https://mon-addon.fr/<config>/manifest.json
 * Elle contient ses clés API : l'URL ne doit donc pas être partagée.
 */

const DEFAULTS = Object.freeze({
  v: 1,
  keys: { tmdb: '', fanart: '', mdblist: '' },
  platforms: PLATFORMS.map((p) => p.id),
  channels: CHANNELS.map((c) => c.id),
  genres: true,
  sagas: true,
  anime: true,
  realityTv: true,
  rows: { top10: true, new: true, popular: true, toprated: true, soon: true },
  hideFromHome: false,
});

const KEY_RE = /^[A-Za-z0-9._\-]{0,400}$/;

function sanitize(raw) {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  if (!raw || typeof raw !== 'object') return cfg;

  if (raw.keys && typeof raw.keys === 'object') {
    for (const k of Object.keys(cfg.keys)) {
      const val = typeof raw.keys[k] === 'string' ? raw.keys[k].trim() : '';
      if (KEY_RE.test(val)) cfg.keys[k] = val;
    }
  }
  if (Array.isArray(raw.platforms)) {
    const known = new Set(PLATFORMS.map((p) => p.id));
    cfg.platforms = PLATFORMS.map((p) => p.id).filter((id) => raw.platforms.includes(id) && known.has(id));
  }
  if (Array.isArray(raw.channels)) {
    cfg.channels = CHANNELS.map((c) => c.id).filter((id) => raw.channels.includes(id));
  }
  if (typeof raw.genres === 'boolean') cfg.genres = raw.genres;
  if (typeof raw.sagas === 'boolean') cfg.sagas = raw.sagas;
  if (typeof raw.anime === 'boolean') cfg.anime = raw.anime;
  if (typeof raw.realityTv === 'boolean') cfg.realityTv = raw.realityTv;
  if (raw.rows && typeof raw.rows === 'object') {
    for (const r of ROWS) {
      if (typeof raw.rows[r.id] === 'boolean') cfg.rows[r.id] = raw.rows[r.id];
    }
  }
  if (typeof raw.hideFromHome === 'boolean') cfg.hideFromHome = raw.hideFromHome;
  return cfg;
}

function encode(cfg) {
  return Buffer.from(JSON.stringify(sanitize(cfg)), 'utf8').toString('base64url');
}

function decode(str) {
  if (!str) return sanitize(null);
  try {
    return sanitize(JSON.parse(Buffer.from(str, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

module.exports = { DEFAULTS, sanitize, encode, decode };
