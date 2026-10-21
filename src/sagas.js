'use strict';

/**
 * Collection « Sagas » : un dossier par saga ou univers, films dans l'ordre de sortie.
 *
 * movie.collections : sagas TMDB (themoviedb.org/collection/<id>), fusionnées et triées par date.
 * movie.companies   : studios TMDB (themoviedb.org/company/<id>) pour les univers entiers ;
 *                     minVotes écarte courts métrages, documentaires et bonus.
 * tv.companies / tv.ids : séries liées (studio, ou liste fixe).
 * tv.exclude        : titres à écarter (même studio, autre univers).
 * tv.include        : ne garder que les titres qui correspondent (studio qui fait plusieurs univers).
 * timeline : liste ordonnée { t, y, k } (titre original, année, movie|tv) → un seul catalogue mélangé ;
 *            followCompanies / followSince : les sorties suivantes du studio sont ajoutées à la fin.
 * Tous les identifiants ont été vérifiés sur themoviedb.org.
 */
const SAGAS = [
  // Univers
  // Un seul catalogue, films et séries mélangés dans l'ordre de l'histoire (src/mcu.js).
  { id: 'marvel', name: 'Marvel', subtitle: "Le MCU dans l'ordre de l'histoire", group: 'univers', colors: ['#ff2a2a', '#200000'],
    timeline: require('./mcu').MCU_TIMELINE, followCompanies: [420], followSince: '2026-08-01' },
  { id: 'starwars', name: 'Star Wars', group: 'univers', colors: ['#ffd23a', '#05060d'],
    movie: { collections: [10] },
    // Lucasfilm produit aussi d'autres séries (Willow, documentaires…) : on ne garde que Star Wars.
    tv: { companies: [1], minVotes: 5, include: [/star wars|mandalorian|andor|ahsoka|obi-wan|boba fett|clone wars|rebels|resistance|bad batch|acolyte|skeleton crew|jedi|ewoks|droids|maul/i] } },
  { id: 'wizarding', name: 'Harry Potter', subtitle: 'et Les Animaux fantastiques', group: 'univers', colors: ['#d8b25a', '#120d05'],
    movie: { collections: [1241, 435259] } },
  { id: 'middleearth', name: 'La Terre du Milieu', subtitle: 'Le Seigneur des anneaux · Le Hobbit', group: 'univers', colors: ['#e0b04a', '#0d1308'],
    movie: { collections: [119, 121938] }, tv: { ids: [84773] } },
  { id: 'westeros', name: 'Game of Thrones', subtitle: 'et House of the Dragon', group: 'univers', colors: ['#c9d3dc', '#0a0d10'],
    tv: { ids: [1399, 94997] } },
  { id: 'dc', name: 'DC', group: 'univers', colors: ['#2f7bff', '#020a1f'],
    movie: { companies: [128064, 9993], minVotes: 500 } },
  { id: 'pixar', name: 'Pixar', group: 'univers', colors: ['#5fd4ff', '#04141c'],
    movie: { companies: [3], minVotes: 300 } },
  { id: 'disney', name: 'Classiques Disney', group: 'univers', colors: ['#7ab8ff', '#050c26'],
    movie: { companies: [6125], minVotes: 300 } },
  { id: 'ghibli', name: 'Studio Ghibli', group: 'univers', colors: ['#7fd6a0', '#06170d'],
    movie: { companies: [10342], minVotes: 100 } },

  // Sagas
  { id: 'jamesbond', name: 'James Bond 007', group: 'saga', colors: ['#e8e8e8', '#0b0b0b'], movie: { collections: [645] } },
  { id: 'fastfurious', name: 'Fast & Furious', group: 'saga', colors: ['#ff8a1f', '#1a0900'], movie: { collections: [9485] } },
  { id: 'missionimpossible', name: 'Mission : Impossible', group: 'saga', colors: ['#ff3b30', '#140202'], movie: { collections: [87359] } },
  { id: 'jurassic', name: 'Jurassic Park', group: 'saga', colors: ['#ffcc2e', '#160f00'], movie: { collections: [328] } },
  { id: 'pirates', name: 'Pirates des Caraïbes', group: 'saga', colors: ['#c99a5b', '#0d0a06'], movie: { collections: [295] } },
  { id: 'hungergames', name: 'Hunger Games', group: 'saga', colors: ['#ff7a1a', '#150700'], movie: { collections: [131635] } },
  { id: 'matrix', name: 'Matrix', group: 'saga', colors: ['#3dff7a', '#000d04'], movie: { collections: [2344] } },
  { id: 'johnwick', name: 'John Wick', group: 'saga', colors: ['#a46bff', '#0c0518'], movie: { collections: [404609] } },
  { id: 'indianajones', name: 'Indiana Jones', group: 'saga', colors: ['#e3a04a', '#160c02'], movie: { collections: [84] } },
  { id: 'backtothefuture', name: 'Retour vers le futur', group: 'saga', colors: ['#ff9d2e', '#0a0612'], movie: { collections: [264] } },
  { id: 'alien', name: 'Alien', group: 'saga', colors: ['#7dffc4', '#010a07'], movie: { collections: [8091] } },
  { id: 'rocky', name: 'Rocky & Creed', group: 'saga', colors: ['#ff4747', '#150303'], movie: { collections: [1575, 553717] } },
  { id: 'conjuring', name: 'Conjuring', group: 'saga', colors: ['#9fb1c4', '#06080b'], movie: { collections: [313086] } },
  { id: 'despicableme', name: 'Moi, moche et méchant', group: 'saga', colors: ['#ffe14a', '#0a1730'], movie: { collections: [86066] } },
  { id: 'shrek', name: 'Shrek', group: 'saga', colors: ['#a8e04a', '#0c1404'], movie: { collections: [2150] } },

  // Sagas françaises
  { id: 'asterix', name: 'Astérix & Obélix', group: 'fr', colors: ['#ffd54a', '#0c1a3a'], movie: { collections: [2396] } },
  { id: 'kaamelott', name: 'Kaamelott', group: 'fr', colors: ['#e6b95a', '#170f05'], movie: { collections: [1076903] }, tv: { ids: [11466] } },
  { id: 'oss117', name: 'OSS 117', group: 'fr', colors: ['#f2c48d', '#0b1a2a'], movie: { collections: [1413999] } },
  { id: 'taxi', name: 'Taxi', group: 'fr', colors: ['#fff04a', '#0d0d0d'], movie: { collections: [211721] } },
  { id: 'visiteurs', name: 'Les Visiteurs', group: 'fr', colors: ['#c7a36b', '#120c05'], movie: { collections: [52888] } },
  { id: 'bronzes', name: 'Les Bronzés', group: 'fr', colors: ['#ffb03a', '#0a2233'], movie: { collections: [52835] } },
  { id: 'tuche', name: 'Les Tuche', group: 'fr', colors: ['#ff6fb5', '#1c0412'], movie: { collections: [389544] } },
  { id: 'bondieu', name: "Qu'est-ce qu'on a fait au Bon Dieu ?", group: 'fr', colors: ['#ffffff', '#0a1d4a'], movie: { collections: [579870] } },
];

const SAGA_GROUPS = { univers: 'Univers', saga: 'Sagas', fr: 'Sagas françaises' };

function findSaga(id) {
  return SAGAS.find((s) => s.id === id) || null;
}

function sagaTypes(saga) {
  if (saga.timeline) return ['movie']; // un seul catalogue : chaque élément garde son propre type
  return [saga.movie && 'movie', saga.tv && 'series'].filter(Boolean);
}

module.exports = { SAGAS, SAGA_GROUPS, findSaga, sagaTypes };
