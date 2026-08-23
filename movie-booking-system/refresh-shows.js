/**
 * Top up the showtime window.
 *
 *   node refresh-shows.js [--dry-run] [--purge-past]
 *
 * Shows are seeded for a fixed number of days ahead. That window does not roll
 * on its own, so it silently runs out — and when it does, the home page shows
 * nothing at all, because a film is only listed if it is actually playing in
 * the chosen city. The failure looks like a broken API rather than stale data,
 * which is exactly how it was first misdiagnosed.
 *
 * Run this daily (cron) and the window always reaches BOOKING_WINDOW_DAYS
 * ahead.
 *
 * Only dates that have NO shows are generated. Existing days are left exactly
 * as they are, because regenerating them would mint new showIds and orphan the
 * seat locks and bookings that point at the old ones.
 */

require('dotenv').config();
const { docClient, TABLES } = require('./db');
const { ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { BOOKING_WINDOW_DAYS } = require('./config/catalog');
const { buildShows, batchPut } = require('./setup-tables');

const DRY = process.argv.includes('--dry-run');
const PURGE = process.argv.includes('--purge-past');

async function scanAll(TableName, ProjectionExpression, ExpressionAttributeNames) {
  let items = [];
  let ExclusiveStartKey;
  do {
    const r = await docClient.send(new ScanCommand({
      TableName, ProjectionExpression, ExpressionAttributeNames, ExclusiveStartKey,
    }));
    items = items.concat(r.Items || []);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Local calendar date, not the UTC one — see dateKey in setup-tables.js. */
function dayString(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

(async () => {
  console.log(`\n🕐 Showtime window refresh${DRY ? ' (dry run)' : ''}\n`);

  const today = dayString(0);
  const existing = await scanAll(TABLES.SHOWS, '#d', { '#d': 'date' });
  const have = new Set(existing.map(s => s.date));

  const wanted = Array.from({ length: BOOKING_WINDOW_DAYS }, (_, i) => dayString(i));
  const missing = wanted.filter(d => !have.has(d));

  console.log(`   window   : ${wanted[0]} → ${wanted[wanted.length - 1]} (${BOOKING_WINDOW_DAYS} days)`);
  console.log(`   existing : ${existing.length} shows across ${have.size} dates`);
  console.log(`   missing  : ${missing.length ? missing.join(', ') : 'none — window is full'}`);

  if (missing.length) {
    const movies = await scanAll(TABLES.MOVIES);
    const theatres = await scanAll(TABLES.THEATRES);

    // buildShows always starts from today, so generate the full window and
    // keep only the days that are actually absent.
    const generated = buildShows(movies, theatres).filter(s => missing.includes(s.date));
    console.log(`   to write : ${generated.length} shows`);

    if (!DRY && generated.length) {
      await batchPut(TABLES.SHOWS, generated);
      console.log('   ✅ written');
    }
  }

  if (PURGE) {
    const past = existing.filter(s => s.date < today);
    console.log(`\n   past shows: ${past.length}`);
    if (!DRY && past.length) {
      // Re-scan for the keys, since the first pass only projected the date.
      const withKeys = await scanAll(TABLES.SHOWS, 'showId, #d', { '#d': 'date' });
      const stale = withKeys.filter(s => s.date < today);
      for (let i = 0; i < stale.length; i += 25) {
        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            [TABLES.SHOWS]: stale.slice(i, i + 25).map(s => ({ DeleteRequest: { Key: { showId: s.showId } } })),
          },
        }));
      }
      console.log('   ✅ purged');
    }
  }

  console.log('\nDone.\n');
})().catch(err => {
  console.error('\n❌ Refresh failed:', err.message);
  process.exit(1);
});
