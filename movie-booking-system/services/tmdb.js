/**
 * TMDB catalog fetcher.
 *
 * Pulls what is actually playing in Indian cinemas right now — real posters,
 * runtimes, certifications and official YouTube trailers — so the catalog is
 * current on every seed instead of frozen to a hardcoded list.
 *
 * Auth: set either TMDB_API_KEY (v3 key, sent as a query param) or
 * TMDB_ACCESS_TOKEN (v4 read token, sent as a Bearer header) in .env.
 * With neither set, `isConfigured()` returns false and callers fall back to
 * the static list in config/seedData.js.
 */

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const LANGUAGE_NAMES = {
  hi: 'Hindi', en: 'English', gu: 'Gujarati', mr: 'Marathi',
  pa: 'Punjabi', kn: 'Kannada', te: 'Telugu', ta: 'Tamil', ml: 'Malayalam',
};

// TMDB genre names we don't carry, mapped onto ours.
const GENRE_ALIASES = {
  Adventure: 'Action', Fantasy: 'Sci-Fi', Mystery: 'Thriller',
  Crime: 'Thriller', Family: 'Animation', History: 'Drama',
  War: 'Drama', Music: 'Drama', Documentary: 'Drama', Western: 'Action',
  'Science Fiction': 'Sci-Fi', 'TV Movie': 'Drama',
};

const { GENRES, CERTIFICATES } = require('../config/catalog');

function isConfigured() {
  return Boolean(process.env.TMDB_API_KEY || process.env.TMDB_ACCESS_TOKEN);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A catalog fetch makes 30+ calls, so a single dropped connection would
 * otherwise abort the whole seed. Transient network errors and TMDB's rate
 * limit (429) are retried with backoff; genuine failures like a bad key (401)
 * fail immediately rather than being retried pointlessly.
 */
async function tmdbGet(path, params = {}, attempt = 1) {
  const MAX_ATTEMPTS = 4;

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const headers = { accept: 'application/json' };
  if (process.env.TMDB_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.TMDB_ACCESS_TOKEN}`;
  } else {
    url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  }

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(400 * attempt);
      return tmdbGet(path, params, attempt + 1);
    }
    throw new Error(`TMDB ${path} unreachable after ${MAX_ATTEMPTS} attempts: ${err.message}`);
  }

  if (res.status === 429 || res.status >= 500) {
    if (attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get('retry-after')) || attempt;
      await sleep(retryAfter * 1000);
      return tmdbGet(path, params, attempt + 1);
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401 ? ' — check TMDB_API_KEY in .env' : '';
    throw new Error(`TMDB ${path} failed: HTTP ${res.status}${hint} ${body.slice(0, 160)}`);
  }
  return res.json();
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function minutesToDuration(mins) {
  if (!mins) return '2h 0m';
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function normalizeGenre(tmdbGenres = []) {
  for (const g of tmdbGenres) {
    const name = GENRE_ALIASES[g.name] || g.name;
    if (GENRES.includes(name)) return name;
  }
  return 'Drama';
}

/** Indian certification (U / UA / A) from the release_dates block. */
function extractCertificate(releaseDates) {
  const india = (releaseDates?.results || []).find(r => r.iso_3166_1 === 'IN');
  const cert = india?.release_dates?.map(d => d.certification).find(Boolean);
  if (!cert) return 'UA';
  return CERTIFICATES.includes(cert) ? cert : (cert.startsWith('UA') ? 'UA' : cert === 'A' ? 'A' : 'UA');
}

/** Prefer an official trailer, then any trailer, then a teaser — YouTube only. */
function extractTrailer(videos) {
  const results = (videos?.results || []).filter(v => v.site === 'YouTube');
  const pick =
    results.find(v => v.type === 'Trailer' && v.official) ||
    results.find(v => v.type === 'Trailer') ||
    results.find(v => v.type === 'Teaser' && v.official) ||
    results.find(v => v.type === 'Teaser');
  return pick ? `https://www.youtube.com/watch?v=${pick.key}` : '';
}

/**
 * Screen formats. TMDB has no such field, so derive it deterministically from
 * the movie's id, genre and popularity — stable across runs, and big-ticket
 * genres get the premium formats a real multiplex would give them.
 */
function deriveFormats(details, genre) {
  const formats = ['2D'];
  const spectacle = ['Action', 'Sci-Fi', 'Animation', 'Horror'].includes(genre);
  const big = (details.popularity || 0) > 25 || (details.vote_count || 0) > 800;

  if (spectacle) formats.push('3D');
  if (big) formats.push(details.id % 2 === 0 ? 'IMAX 2D' : 'IMAX 3D');
  if (spectacle && big && details.id % 3 === 0) formats.push('4DX');

  return [...new Set(formats)];
}

function toMovie(details, status) {
  const genre = normalizeGenre(details.genres);
  return {
    title: details.title,
    genre,
    language: LANGUAGE_NAMES[details.original_language] || 'English',
    duration: minutesToDuration(details.runtime),
    certificate: extractCertificate(details.release_dates),
    status,
    formats: deriveFormats(details, genre),
    posterUrl: details.poster_path ? `${IMG}/w500${details.poster_path}` : '',
    backdropUrl: details.backdrop_path ? `${IMG}/w1280${details.backdrop_path}` : '',
    trailerUrl: extractTrailer(details.videos),
    description: details.overview || '',
    rating: details.vote_average ? Number(details.vote_average.toFixed(1)) : null,
    releaseDate: details.release_date || '',
    tmdbId: details.id,
  };
}

/** One call per movie: details + trailers + certifications. */
async function fetchDetails(id) {
  return tmdbGet(`/movie/${id}`, { append_to_response: 'videos,release_dates' });
}

/**
 * Build the catalog.
 * @param {string[]} languages ISO codes, e.g. ['hi','en','gu']
 * @param {number}   perLanguage max now-showing titles to keep per language
 */
async function fetchCatalog({ languages = ['hi', 'en', 'gu'], perLanguage = 6, upcoming = 4 } = {}) {
  if (!isConfigured()) return null;

  const wanted = new Map(); // tmdbId -> status

  // What's actually in Indian cinemas right now.
  for (const page of [1, 2]) {
    const data = await tmdbGet('/movie/now_playing', { region: 'IN', page });
    for (const m of data.results || []) {
      if (languages.includes(m.original_language)) wanted.set(m.id, 'now_showing');
    }
  }

  // now_playing skews towards wide releases, so top up each language explicitly.
  // This is what gets Gujarati cinema into the list at all.
  for (const lang of languages) {
    const data = await tmdbGet('/discover/movie', {
      with_original_language: lang,
      region: 'IN',
      sort_by: 'popularity.desc',
      'primary_release_date.gte': daysAgo(120),
      'primary_release_date.lte': today(),
      page: 1,
    });
    for (const m of (data.results || []).slice(0, perLanguage)) {
      if (!wanted.has(m.id)) wanted.set(m.id, 'now_showing');
    }
  }

  // A few genuinely upcoming titles for the Coming Soon rail.
  const soon = await tmdbGet('/movie/upcoming', { region: 'IN', page: 1 });
  for (const m of (soon.results || []).filter(m => languages.includes(m.original_language)).slice(0, upcoming)) {
    if (!wanted.has(m.id)) wanted.set(m.id, 'coming_soon');
  }

  // Hydrate. Sequential on purpose — TMDB rate-limits bursts.
  const movies = [];
  for (const [id, status] of wanted) {
    try {
      const details = await fetchDetails(id);
      if (!details.poster_path) continue; // a card with no poster looks broken
      movies.push(toMovie(details, status));
    } catch (err) {
      console.warn(`   ⚠ skipped TMDB id ${id}: ${err.message}`);
    }
  }

  // Cap per language so one language can't crowd out the others.
  const byLang = {};
  const capped = [];
  for (const m of movies.sort((a, b) => (b.rating || 0) - (a.rating || 0))) {
    const key = `${m.language}:${m.status}`;
    byLang[key] = (byLang[key] || 0) + 1;
    if (m.status === 'now_showing' && byLang[key] > perLanguage) continue;
    capped.push(m);
  }

  return capped;
}

module.exports = { fetchCatalog, fetchDetails, isConfigured, toMovie, LANGUAGE_NAMES };
