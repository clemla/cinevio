'use strict';

/**
 * Collection « Genres » : un dossier par genre, limité à ce qui est disponible sur les
 * plateformes et chaînes choisies (en France).
 *
 * movie / tv : genres TMDB (https://developer.themoviedb.org/reference/genre-movie-list).
 *   Plusieurs ids = « l'un ou l'autre » (séparés par | dans la requête TMDB).
 *   tv vide = pas de genre équivalent côté séries (le dossier n'a que des films).
 * exclude : genres écartés (ex. animation hors du genre Action, pour ne pas mélanger).
 * colors : dégradé de la carte. motif : décor de la carte quand il n'y a pas d'images.
 */
const GENRES = [
  { id: 'action', name: 'Action', movie: [28], tv: [10759], exclude: [16], colors: ['#ff5a1f', '#2a0800'], motif: 'slash' },
  { id: 'comedie', name: 'Comédie', movie: [35], tv: [35], exclude: [16], colors: ['#ffc21a', '#3a2300'], motif: 'dots' },
  { id: 'thriller', name: 'Thriller', movie: [53], tv: [9648], exclude: [16], colors: ['#7a8cff', '#0a0d26'], motif: 'scan' },
  { id: 'policier', name: 'Policier', movie: [80], tv: [80], exclude: [16], colors: ['#3fd0ff', '#03161f'], motif: 'tape' },
  { id: 'sf', name: 'Science-fiction', movie: [878], tv: [10765], exclude: [16], colors: ['#21f0d0', '#011a1e'], motif: 'grid' },
  { id: 'fantastique', name: 'Fantastique', movie: [14], tv: [10765], exclude: [16], colors: ['#b56bff', '#140426'], motif: 'stars' },
  { id: 'horreur', name: 'Horreur', movie: [27], tv: [], exclude: [16], colors: ['#ff1f3d', '#1a0005'], motif: 'drip' },
  { id: 'drame', name: 'Drame', movie: [18], tv: [18], exclude: [16, 99], colors: ['#d9b48a', '#1c130b'], motif: 'rings' },
  { id: 'romance', name: 'Romance', movie: [10749], tv: [], exclude: [16], colors: ['#ff6fae', '#2a0617'], motif: 'hearts' },
  { id: 'animation', name: 'Animation', movie: [16], tv: [16], exclude: [], colors: ['#4be36b', '#04200b'], motif: 'bubbles' },
  { id: 'docu', name: 'Documentaires', movie: [99], tv: [99], exclude: [], colors: ['#c8d64a', '#171a03'], motif: 'lines' },
  { id: 'famille', name: 'En famille', movie: [10751], tv: [10751, 10762], exclude: [27], colors: ['#ffa64d', '#2b1400'], motif: 'bubbles' },
];

/** Rangées de chaque dossier de genre. */
const GENRE_ROWS = [
  { id: 'popular', label: 'Populaires' },
  { id: 'new', label: 'Nouveautés' },
  { id: 'toprated', label: 'Mieux notés' },
];

function findGenre(id) {
  return GENRES.find((g) => g.id === id) || null;
}

/** Types proposés pour un genre : séries seulement s'il existe un genre équivalent côté TMDB. */
function genreTypes(genre) {
  return genre.tv.length ? ['movie', 'series'] : ['movie'];
}

module.exports = { GENRES, GENRE_ROWS, findGenre, genreTypes };
