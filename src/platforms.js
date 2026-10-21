'use strict';

/**
 * Plateformes disponibles en France.
 *
 * - fp        : identifiant FlixPatrol (https://flixpatrol.com/top10/<fp>/france/)
 * - tmdbNames : noms possibles côté TMDB (liste des providers FR), résolus au démarrage
 * - tmdbIds   : IDs de secours si la résolution par nom échoue
 * - weight    : poids dans le « Top 10 du moment » fusionné (0 = non compté)
 * - colors    : dégradé utilisé pour les couvertures générées
 * - logo      : logo officiel sur les cartes (réseau TMDB, themoviedb.org/network/<id>) ;
 *               white = affiché en blanc (logos noirs ou sombres, illisibles sur fond sombre)
 */

const PLATFORMS = [
  {
    id: 'netflix', name: 'Netflix', fp: 'netflix',
    logo: { network: 213, white: false },
    tmdbNames: ['Netflix'], tmdbIds: [8],
    weight: 1.0, colors: ['#e50914', '#3b0306'],
  },
  {
    id: 'prime', name: 'Prime Video', fp: 'amazon-prime',
    logo: { network: 1024, white: false },
    tmdbNames: ['Amazon Prime Video', 'Prime Video'], tmdbIds: [119],
    weight: 0.7, colors: ['#1a98ff', '#04213d'],
  },
  {
    id: 'disney', name: 'Disney+', fp: 'disney',
    logo: { network: 2739, white: true },
    tmdbNames: ['Disney Plus', 'Disney+'], tmdbIds: [337],
    weight: 0.55, colors: ['#1c3fa8', '#060d2e'],
  },
  {
    id: 'canal', name: 'Canal+', fp: 'canal',
    logo: { network: 285, white: false },
    tmdbNames: ['Canal+', 'Canal Plus', 'Canal+ Séries'], tmdbIds: [381],
    weight: 0.55, colors: ['#3a3a3a', '#050505'],
  },
  {
    id: 'hbomax', name: 'HBO Max', fp: 'hbo-max',
    logo: { network: 8304, white: true },
    tmdbNames: ['HBO Max', 'Max'], tmdbIds: [1899],
    weight: 0.4, colors: ['#5b2be0', '#0d0631'],
  },
  {
    id: 'appletv', name: 'Apple TV', fp: 'apple-tv',
    logo: { network: 2552, white: true },
    tmdbNames: ['Apple TV', 'Apple TV Plus', 'Apple TV+'], tmdbIds: [350],
    weight: 0.3, colors: ['#8a8a8f', '#141416'],
  },
  {
    id: 'paramount', name: 'Paramount+', fp: 'paramount-plus',
    logo: { network: 4330, white: true },
    tmdbNames: ['Paramount Plus', 'Paramount+'], tmdbIds: [531],
    weight: 0.25, colors: ['#0064ff', '#001a45'],
  },
  {
    id: 'crunchyroll', name: 'Crunchyroll', fp: 'crunchyroll',
    logo: { network: 1112, white: false },
    tmdbNames: ['Crunchyroll'], tmdbIds: [283],
    weight: 0, colors: ['#f47521', '#3d1600'],
    types: ['series', 'movie'],
  },
];

/**
 * Chaînes françaises (offres gratuites en ligne). weight 0 : elles ne comptent pas dans le
 * Top 10 du moment. networks : chaînes de diffusion TMDB, utilisées pour les séries quand TMDB
 * n'a pas de données de disponibilité (france.tv). Identifiants vérifiés sur themoviedb.org.
 */
const CHANNELS = [
  {
    id: 'tf1', name: 'TF1+', fp: 'tf1', group: 'channel',
    logo: { network: 7395, white: true },
    tmdbNames: ['TF1+', 'TF1'], tmdbIds: [1754], networks: [290, 2448, 7395],
    weight: 0, colors: ['#1f6bff', '#061433'], noSoon: true,
  },
  {
    id: 'm6', name: 'M6+', fp: 'm6plus', group: 'channel',
    logo: { network: 7702, white: true },
    tmdbNames: ['M6+', '6play', 'M6 Plus'], tmdbIds: [147], networks: [712],
    weight: 0, colors: ['#ff2d55', '#2a0410'], noSoon: true,
  },
  {
    id: 'francetv', name: 'france.tv', fp: 'france-tv', group: 'channel',
    logo: { network: 3856, white: true },
    tmdbNames: ['France TV', 'france.tv'], tmdbIds: [], networks: [361, 249, 255],
    weight: 0, colors: ['#3d4bff', '#0a0c3a'], noSoon: true,
    types: ['series'], // pas de données de disponibilité TMDB : séries et émissions via les chaînes France 2, 3, 5
  },
  {
    id: 'arte', name: 'Arte', fp: null, group: 'channel',
    logo: { network: 1628, white: false },
    tmdbNames: ['Arte', 'ARTE'], tmdbIds: [234], networks: [1628],
    weight: 0, colors: ['#ff6a2b', '#2b0d02'], noSoon: true,
  },
];

/** Classements FlixPatrol utilisés uniquement pour repérer la télé-réalité du moment. */
const REALITY_EXTRA_FP = ['tf1', 'm6plus', 'france-tv'];

/** Poids du box-office dans le Top 10 Films fusionné. */
const CINEMA_WEIGHT = 1.0;

/** Rangées proposées dans chaque dossier, dans l'ordre d'affichage. */
const ROWS = [
  { id: 'top10', label: 'Top 10' },
  { id: 'new', label: 'Nouveautés' },
  { id: 'popular', label: 'Populaires' },
  { id: 'toprated', label: 'Mieux notés' },
  { id: 'soon', label: 'Bientôt' },
];

PLATFORMS.forEach((p) => { p.group = 'platform'; });
const ALL = [...PLATFORMS, ...CHANNELS];

function findService(id) {
  return ALL.find((s) => s.id === id) || null;
}

module.exports = { PLATFORMS, CHANNELS, ALL, ROWS, CINEMA_WEIGHT, REALITY_EXTRA_FP, findService };
