'use strict';

/** Construction des métadonnées Stremio/Nuvio, en français. */

const tmdb = require('./sources/tmdb');
const { fanartLogo, mdblistRating } = require('./sources/extras');
const { mapLimit } = require('./http');
const cache = require('./cache');

const DAY = 86400;
const stremioType = (kind) => (kind === 'movie' ? 'movie' : 'series');
const tmdbKind = (type) => (type === 'movie' ? 'movie' : 'tv');

function year(date) {
  return date ? String(date).slice(0, 4) : '';
}

/**
 * Meilleur fond : sans texte (iso_639_1 vide), en 16:9, grande taille, et le mieux noté — la note
 * est pondérée par le nombre de votes, sinon une image à 1 vote à 10 passe devant tout le monde.
 * TMDB donne par défaut un fond « au hasard » (souvent une capture terne, ou avec du texte).
 */
function bestBackdrop(list) {
  const textless = (list || []).filter((i) => !i.iso_639_1 && i.file_path);
  const score = (i) => {
    const n = i.vote_count || 0;
    const bayes = ((i.vote_average || 0) * n + 5.2 * 5) / (n + 5);
    const ratio = i.width && i.height ? i.width / i.height : 1.78;
    return bayes + (i.width >= 1920 ? 0.6 : i.width >= 1280 ? 0.2 : -1) + (Math.abs(ratio - 1.778) > 0.08 ? -2 : 0);
  };
  const best = textless.sort((a, b) => score(b) - score(a))[0];
  return best ? best.file_path : null;
}

/** Logo du titre : français, sinon anglais ; PNG d'abord (les SVG ne s'affichent pas partout). */
function bestLogo(list) {
  for (const lang of ['fr', 'en']) {
    const hits = (list || []).filter((i) => i.iso_639_1 === lang && i.file_path)
      .sort((a, b) => (/\.png$/i.test(b.file_path) - /\.png$/i.test(a.file_path)) || (b.vote_average || 0) - (a.vote_average || 0));
    if (hits.length) return hits[0].file_path;
  }
  return null;
}

/** Fond et logo d'un titre (bandeau d'accueil), gardés 7 jours. */
async function artFor(keys, kind, id) {
  const data = await tmdb.get(keys.tmdb, `/${kind}/${id}/images`, { include_image_language: 'fr,en,null' }, 7 * DAY).catch(() => null);
  return { backdrop: data && bestBackdrop(data.backdrops), logo: data && bestLogo(data.logos) };
}

/** Méta « aperçu » à partir d'un résultat TMDB (discover/search/détails). */
async function previewFromResult(keys, kind, r) {
  const [imdb, art] = await Promise.all([
    tmdb.imdbId(keys.tmdb, kind, r.id).catch(() => ''),
    artFor(keys, kind, r.id),
  ]);
  const date = r.release_date || r.first_air_date || '';
  return {
    id: imdb || `tmdb:${r.id}`,
    type: stremioType(kind),
    name: r.title || r.name,
    poster: tmdb.img(r.poster_path, 'w342'),
    background: tmdb.img(art.backdrop || r.backdrop_path, 'original'),
    logo: tmdb.img(art.logo, 'w500') || undefined,
    description: r.overview || '',
    releaseInfo: year(date),
    imdbRating: r.vote_average ? r.vote_average.toFixed(1) : undefined,
    tmdbId: r.id,
  };
}

/** Méta « aperçu » à partir d'une référence { kind, id }. */
async function previewFromRef(keys, ref) {
  const details = await tmdb.get(keys.tmdb, `/${ref.kind}/${ref.id}`, { language: 'fr-FR' }, DAY);
  if (!details) return null;
  return previewFromResult(keys, ref.kind, details);
}

async function previewsFromRefs(keys, refs) {
  const metas = await mapLimit(refs, 8, (ref) => previewFromRef(keys, ref));
  return metas.filter(Boolean);
}

/** Résultats de types mélangés : [{ kind, res }] (chaque fiche garde son type). */
async function previewsFromMixed(keys, items) {
  const metas = await mapLimit(items, 8, (i) => previewFromResult(keys, i.kind, i.res));
  return metas.filter(Boolean);
}

async function previewsFromResults(keys, kind, results) {
  const metas = await mapLimit(results, 8, (r) => previewFromResult(keys, kind, r));
  return metas.filter(Boolean);
}

function frCertification(details, kind) {
  if (kind === 'movie') {
    const fr = ((details.release_dates && details.release_dates.results) || []).find((x) => x.iso_3166_1 === 'FR');
    const c = fr && fr.release_dates.map((d) => d.certification).find(Boolean);
    return c || '';
  }
  const fr = ((details.content_ratings && details.content_ratings.results) || []).find((x) => x.iso_3166_1 === 'FR');
  return (fr && fr.rating) || '';
}

function frReleaseDate(details, kind) {
  if (kind !== 'movie') return details.first_air_date || '';
  const fr = ((details.release_dates && details.release_dates.results) || []).find((x) => x.iso_3166_1 === 'FR');
  const theatrical = fr && fr.release_dates.find((d) => d.type === 3) || (fr && fr.release_dates[0]);
  return (theatrical && theatrical.release_date) || details.release_date || '';
}

function formatRuntime(min) {
  if (!min) return undefined;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

function pickImage(list, langs) {
  if (!Array.isArray(list)) return null;
  for (const lang of langs) {
    const hit = list.filter((i) => (i.iso_639_1 || null) === lang).sort((a, b) => b.vote_average - a.vote_average)[0];
    if (hit) return hit.file_path;
  }
  return null;
}

/** Méta complète (fiche) pour un id tt… ou tmdb:… */
async function fullMeta(keys, type, id) {
  const kind = tmdbKind(type);
  let tmdbId = null;
  let imdb = null;

  if (id.startsWith('tt')) {
    imdb = id.split(':')[0];
    const found = await tmdb.findByImdb(keys.tmdb, imdb);
    if (!found) return null;
    tmdbId = found.id;
  } else if (id.startsWith('tmdb:')) {
    tmdbId = Number(id.split(':')[1]);
  }
  if (!tmdbId) return null;

  return cache.wrap(`meta3:${kind}:${tmdbId}:${keys.fanart ? 'f' : ''}${keys.mdblist ? 'm' : ''}`, DAY, async () => {
    const append = kind === 'movie'
      ? 'credits,videos,images,release_dates,external_ids'
      : 'credits,videos,images,content_ratings,external_ids';
    const d = await tmdb.get(keys.tmdb, `/${kind}/${tmdbId}`, {
      language: 'fr-FR',
      append_to_response: append,
      include_image_language: 'fr,null,en',
      include_video_language: 'fr,en',
    }, DAY);
    if (!d) return null;

    imdb = imdb || (d.external_ids && d.external_ids.imdb_id) || null;
    const metaId = imdb || `tmdb:${tmdbId}`;

    // Résumé : repli en anglais si TMDB n'a pas de traduction française.
    let description = d.overview;
    if (!description) {
      const en = await tmdb.get(keys.tmdb, `/${kind}/${tmdbId}`, { language: 'en-US' }, DAY).catch(() => null);
      description = (en && en.overview) || '';
    }

    const images = d.images || {};
    const posterPath = pickImage(images.posters, ['fr']) || d.poster_path;
    const backdropPath = bestBackdrop(images.backdrops) || d.backdrop_path;

    const fanartId = kind === 'movie' ? tmdbId : d.external_ids && d.external_ids.tvdb_id;
    const logo = (await fanartLogo(keys.fanart, kind, fanartId))
      || tmdb.img(bestLogo(images.logos) || pickImage(images.logos, [null]), 'w500');

    const rating = (await mdblistRating(keys.mdblist, kind, imdb)) || (d.vote_average ? d.vote_average.toFixed(1) : undefined);

    const crew = (d.credits && d.credits.crew) || [];
    const castFull = ((d.credits && d.credits.cast) || []).slice(0, 20);
    const cast = castFull.slice(0, 12).map((c) => c.name);
    const directorsFull = kind === 'movie' ? crew.filter((c) => c.job === 'Director') : (d.created_by || []);
    const directors = directorsFull.map((c) => c.name);
    const writersFull = crew.filter((c) => c.department === 'Writing' && /Screenplay|Writer|Story|Novel/i.test(c.job || ''));
    // Fiche enrichie lue par Nuvio (TV, PC, mobile) : acteurs avec photo et rôle, réalisation, scénario.
    const person = (c, role) => ({
      name: c.name,
      character: role || undefined,
      photo: tmdb.img(c.profile_path, 'w185') || undefined,
      tmdbId: c.id,
    });
    const uniq = (list) => list.filter((p, i, a) => a.findIndex((x) => x.tmdbId === p.tmdbId) === i);

    const vids = ((d.videos && d.videos.results) || []).filter((v) => v.site === 'YouTube' && /Trailer|Teaser/.test(v.type));
    vids.sort((a, b) => (a.iso_639_1 === 'fr' ? -1 : 0) - (b.iso_639_1 === 'fr' ? -1 : 0));
    const trailers = vids.slice(0, 2).map((v) => ({ source: v.key, type: 'Trailer' }));

    const released = frReleaseDate(d, kind);
    let releaseInfo = year(released);
    if (kind === 'tv') {
      const end = d.status === 'Ended' || d.status === 'Canceled' ? year(d.last_air_date) : '';
      releaseInfo = `${year(d.first_air_date)}–${end}`;
    }
    const certification = frCertification(d, kind);

    const meta = {
      id: metaId,
      type: stremioType(kind),
      name: d.title || d.name,
      poster: tmdb.img(posterPath, 'w500'),
      background: tmdb.img(backdropPath, 'original'),
      logo: logo || undefined,
      description,
      releaseInfo,
      released: released ? new Date(released).toISOString() : undefined,
      runtime: formatRuntime(d.runtime || (d.episode_run_time && d.episode_run_time[0])),
      genres: (d.genres || []).map((g) => g.name),
      imdbRating: rating,
      cast,
      director: kind === 'movie' ? directors : undefined,
      writer: kind === 'tv' ? directors : undefined,
      country: (d.production_countries || d.origin_country || []).map((c) => c.iso_3166_1 || c).join(', ') || undefined,
      language: d.original_language,
      certification: /^\d+$/.test(certification) ? `-${certification}` : undefined,
      trailers,
      trailerStreams: trailers.map((t) => ({ title: d.title || d.name, ytId: t.source })),
      links: [],
      behaviorHints: kind === 'movie' ? { defaultVideoId: metaId } : {},
    };
    if (certification === 'U' || certification === 'TP') meta.certification = 'Tous publics';
    if (meta.certification) meta.ageRating = meta.certification;
    meta.app_extras = {
      cast: castFull.map((c) => person(c, c.character)),
      directors: uniq(directorsFull.map((c) => person(c, kind === 'movie' ? 'Réalisation' : 'Création'))),
      writers: uniq(writersFull.map((c) => person(c, c.job === 'Screenplay' ? 'Scénario' : c.job === 'Novel' ? 'Roman' : 'Écriture'))).slice(0, 6),
      certificationLocal: meta.certification,
      certification: meta.certification,
    };

    if (kind === 'tv') meta.videos = await seriesVideos(keys, tmdbId, metaId, d.seasons || []);
    return meta;
  });
}

async function seriesVideos(keys, tmdbId, metaId, seasons) {
  const list = seasons.filter((s) => s.episode_count > 0);
  const data = await mapLimit(list, 4, (s) =>
    tmdb.get(keys.tmdb, `/tv/${tmdbId}/season/${s.season_number}`, { language: 'fr-FR' }, DAY));
  const videos = [];
  for (const season of data.filter(Boolean)) {
    for (const ep of season.episodes || []) {
      videos.push({
        id: `${metaId}:${ep.season_number}:${ep.episode_number}`,
        title: ep.name || `Épisode ${ep.episode_number}`,
        season: ep.season_number,
        episode: ep.episode_number,
        released: ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
        overview: ep.overview || '',
        thumbnail: tmdb.img(ep.still_path, 'w500'),
      });
    }
  }
  return videos;
}

module.exports = { artFor, bestBackdrop, bestLogo, previewsFromRefs, previewsFromResults, previewsFromMixed, fullMeta, stremioType, tmdbKind };
