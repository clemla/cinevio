'use strict';

/**
 * Génère le fichier de collections Nuvio (format d'import nuvio.tv / app) :
 *   - « Plateformes » (épinglée en haut) : un dossier par plateforme
 *   - « Chaînes » : TF1+, M6+, france.tv, Arte
 *   - « Genres » : un dossier par genre (limité aux plateformes et chaînes choisies)
 *   - « Sagas & univers » : un dossier par saga, films dans l'ordre de sortie
 * Les « Top 10 du moment » et « Télé-réalité FR » ne sont pas des collections : ce sont des
 * catalogues de l'addon, qui apparaissent comme des rangées classiques sur l'accueil.
 *
 * Chaque source pointe vers un catalogue de l'addon (provider "addon"). Sur Nuvio mobile,
 * le catalogue doit être déclaré dans le manifest : c'est le cas, via catalogList().
 * Les cartes (couvertures) sont servies par l'addon : /covers/<id>.jpg (voir covers.js).
 */

const { PLATFORMS, CHANNELS } = require('./platforms');
const { GENRES, GENRE_ROWS, genreTypes } = require('./genres');
const { SAGAS, sagaTypes } = require('./sagas');
const anime = require('./anime'); // collection « Animés » : animation japonaise
const { ADDON_ID, FOLDER_GENRE, rowsFor, typesFor, catalogId, genreCatalogId, sagaCatalogId } = require('./catalogs');
const { coverId, DESIGN_VERSION } = require('./covers');
/** Numéro de version dans l'adresse des cartes : une réimportation suffit pour que Nuvio oublie les anciennes. */
const coverUrl = (baseUrl, id, ext) => `${baseUrl}/covers/${id}.${ext}?v=${DESIGN_VERSION}`;

const GIF_ENABLED = process.env.COVERS_GIF !== '0';

function source(cfg, type, id) {
  // Le genre obligatoire des catalogues de dossiers (ils restent ainsi hors de l'accueil sur PC et mobile).
  return { type, genre: FOLDER_GENRE, addonId: ADDON_ID, provider: 'addon', catalogId: id };
}

function folder(id, title, sources, baseUrl, coverName) {
  const cover = coverUrl(baseUrl, coverName, 'jpg');
  const animated = coverUrl(baseUrl, coverName, 'gif'); // joué quand la carte a le focus
  return {
    id,
    title,
    sources,
    hideTitle: true, // le nom est dessiné sur la carte
    tileShape: 'LANDSCAPE',
    coverEmoji: '🎬',
    focusGifUrl: GIF_ENABLED ? animated : null,
    coverImageUrl: cover,
    catalogSources: sources.map(({ provider, ...rest }) => rest),
    focusGifEnabled: GIF_ENABLED,
    heroBackdropUrl: cover,
  };
}

function collection(id, title, folders, pinToTop = false) {
  return {
    id,
    title,
    folders,
    pinToTop,
    viewMode: 'TABBED_GRID',
    showAllTab: false,
    backdropImageUrl: null,
    focusGlowEnabled: true,
  };
}

function serviceFolder(service, cfg, baseUrl) {
  const sources = [];
  for (const row of rowsFor(service, cfg)) {
    for (const type of typesFor(service)) sources.push(source(cfg, type, catalogId(service, row)));
  }
  return folder(`nfr-${service.id}`, service.name, sources, baseUrl, coverId('service', service.id));
}

function buildCollections(cfg, baseUrl) {
  const out = [];
  const platforms = PLATFORMS.filter((p) => cfg.platforms.includes(p.id));
  if (platforms.length) {
    out.push(collection('nfr-plateformes', 'Plateformes', platforms.map((p) => serviceFolder(p, cfg, baseUrl)), true));
  }

  const channels = CHANNELS.filter((c) => (cfg.channels || []).includes(c.id));
  if (channels.length) {
    out.push(collection('nfr-chaines', 'Chaînes', channels.map((c) => serviceFolder(c, cfg, baseUrl))));
  }

  if (cfg.genres) {
    out.push(collection('nfr-genres', 'Genres', GENRES.map((g) => {
      const sources = [];
      for (const r of GENRE_ROWS) for (const type of genreTypes(g)) sources.push(source(cfg, type, genreCatalogId(g, r.id)));
      return folder(`nfr-genre-${g.id}`, g.name, sources, baseUrl, coverId('genre', g.id));
    })));
  }

  if (cfg.sagas) {
    out.push(collection('nfr-sagas', 'Sagas & univers', SAGAS.map((s) => folder(
      `nfr-saga-${s.id}`, s.name,
      sagaTypes(s).map((type) => source(cfg, type, sagaCatalogId(s))),
      baseUrl, coverId('saga', s.id),
    ))));
  }
  if (cfg.anime) {
    out.push(collection('nfr-anime', 'Animés', anime.ANIME_FOLDERS.map((f) => folder(
      `nfr-anime-${f.id}`, f.name,
      anime.animeRows(f, cfg).map((row) => source(cfg, anime.animeType(row), anime.animeCatalogId(f, row))),
      baseUrl, coverId('anime', f.id),
    ))));
  }
  return out;
}

module.exports = { buildCollections };
