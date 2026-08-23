/**
 * Keep the film catalogue current, without breaking anything that points at it.
 *
 *   node refresh-catalog.js [--dry-run]
 *
 * TMDB is the source; DynamoDB is the system of record. The running app never
 * calls TMDB — it reads the copy this script maintains — because bookings,
 * shows, seat locks and reviews all reference a movieId that has to exist and
 * stay stable. You cannot hang a booking off a record on someone else's server.
 *
 * The rule that makes this safe: match on tmdbId, never on movieId.
 *
 * tmdbId is TMDB's own identifier and never changes. movieId is a UUID this
 * project invents. setup-tables.js mints a fresh UUID for every film each time
 * it runs, so re-running it renames every film from the database's point of
 * view and orphans every booking pointing at the old id. That is not
 * hypothetical: it happened, and three bookings could not be repaired.
 *
 * Matching on tmdbId means an existing film is updated IN PLACE — same
 * movieId — so nothing referencing it ever breaks.
 *
 * Films that leave TMDB's now-playing list are marked `ended`, never deleted.
 * Deleting would strand their reviews (keyed on movieId) and break the link
 * from historic bookings, and it saves nothing: the whole catalogue is ~24 KB.
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { docClient, TABLES } = require('./db');
const { ScanCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const tmdb = require('./services/tmdb');

const DRY = process.argv.includes('--dry-run');

/**
 * Fields TMDB owns, so they are safe to overwrite on every run.
 *
 * Deliberately absent: movieId, createdAt, and — most importantly —
 * ratingSum/ratingCount, which are your users' reviews. TMDB knows nothing
 * about those and must never clobber them.
 */
const TMDB_OWNED = [
  'title', 'genre', 'language', 'duration', 'certificate', 'status',
  'formats', 'posterUrl', 'backdropUrl', 'trailerUrl', 'description',
  'rating', 'releaseDate',
];

async function scanAll(TableName) {
  let items = [];
  let ExclusiveStartKey;
  do {
    const r = await docClient.send(new ScanCommand({ TableName, ExclusiveStartKey }));
    items = items.concat(r.Items || []);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

(async () => {
  console.log(`\n🎞  Catalogue refresh${DRY ? ' (dry run)' : ''}\n`);

  if (!tmdb.isConfigured()) {
    console.log('   TMDB_API_KEY is not set — nothing to refresh.');
    return;
  }

  const languages = ['hi', 'en', 'gu', 'mr', 'kn', 'te', 'pa'];
  let fetched;
  try {
    fetched = await tmdb.fetchCatalog({ languages, perLanguage: 5, upcoming: 4 });
  } catch (err) {
    // A bad day at TMDB must not damage a working catalogue. Leaving the
    // existing films untouched is always better than half-updating them.
    console.error(`   ⚠ TMDB fetch failed (${err.message}) — leaving the catalogue as it is.`);
    process.exitCode = 1;
    return;
  }
  console.log(`   TMDB returned  : ${fetched.length} films`);

  const existing = await scanAll(TABLES.MOVIES);
  const byTmdbId = new Map(existing.filter(m => m.tmdbId).map(m => [String(m.tmdbId), m]));
  console.log(`   already stored : ${existing.length} films (${byTmdbId.size} with a tmdbId)`);

  const updates = [];
  const inserts = [];
  const seen = new Set();

  for (const film of fetched) {
    const key = String(film.tmdbId);
    seen.add(key);
    const current = byTmdbId.get(key);

    if (current) {
      // Only the fields that actually moved, so an unchanged film costs nothing.
      const changed = TMDB_OWNED.filter(f => JSON.stringify(current[f]) !== JSON.stringify(film[f]));
      if (changed.length) updates.push({ movie: current, film, changed });
    } else {
      inserts.push(film);
    }
  }

  // Anything we hold that TMDB no longer lists as playing.
  const ended = existing.filter(m =>
    m.tmdbId && !seen.has(String(m.tmdbId)) && m.status !== 'ended');

  console.log(`   to update      : ${updates.length}`);
  console.log(`   to insert      : ${inserts.length}`);
  console.log(`   to mark ended  : ${ended.length}`);

  if (inserts.length) {
    console.log('\n   New:');
    inserts.forEach(f => console.log(`      + ${f.title} (${f.language})`));
  }
  if (ended.length) {
    console.log('\n   No longer showing:');
    ended.forEach(m => console.log(`      – ${m.title}`));
  }
  if (updates.length) {
    console.log('\n   Updated:');
    updates.slice(0, 10).forEach(u => console.log(`      ~ ${u.movie.title} (${u.changed.join(', ')})`));
    if (updates.length > 10) console.log(`      … and ${updates.length - 10} more`);
  }

  if (DRY) {
    console.log('\n   [dry run] nothing written.\n');
    return;
  }

  // --- update in place, keeping movieId and any user ratings
  for (const { movie, film, changed } of updates) {
    const names = {};
    const values = {};
    const sets = changed.map((f, i) => {
      names[`#f${i}`] = f;
      values[`:v${i}`] = film[f];
      return `#f${i} = :v${i}`;
    });
    names['#u'] = 'refreshedAt';
    values[':u'] = new Date().toISOString();
    sets.push('#u = :u');

    await docClient.send(new UpdateCommand({
      TableName: TABLES.MOVIES,
      Key: { movieId: movie.movieId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  }

  // --- genuinely new films
  for (const film of inserts) {
    await docClient.send(new PutCommand({
      TableName: TABLES.MOVIES,
      Item: {
        movieId: uuidv4(),
        backdropUrl: '',
        rating: null,
        releaseDate: '',
        ...film,
        createdAt: new Date().toISOString(),
        refreshedAt: new Date().toISOString(),
      },
    }));
  }

  // --- retire, don't delete
  for (const movie of ended) {
    await docClient.send(new UpdateCommand({
      TableName: TABLES.MOVIES,
      Key: { movieId: movie.movieId },
      UpdateExpression: 'SET #s = :ended, endedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':ended': 'ended', ':now': new Date().toISOString() },
    }));
  }

  console.log(`\n   ✅ ${updates.length} updated, ${inserts.length} added, ${ended.length} retired`);
  console.log('   Showtimes for any new film appear on the next refresh-shows run.\n');
})().catch(err => {
  console.error('\n❌ Catalogue refresh failed:', err.message);
  process.exit(1);
});
