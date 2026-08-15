/**
 * Setup — provisions the DynamoDB tables and seeds the catalog.
 *
 *   node setup-tables.js            create tables + seed everything
 *   node setup-tables.js --reseed   wipe catalog data and seed again
 *
 * Safe to re-run: existing tables are left alone, and the admin user is only
 * created if it isn't already there.
 */
require('dotenv').config();

const { client, docClient, TABLES } = require('./db');
const { CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { PutCommand, ScanCommand, BatchWriteCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const {
  CITIES, BOOKING_WINDOW_DAYS, FILMS_PER_CITY,
  FILMS_PER_SCREEN_PER_DAY, languagesForCity,
} = require('./config/catalog');
const {
  FALLBACK_MOVIES, THEATRES, SCREEN_TEMPLATES,
  CITY_MULTIPLIER, SHOW_SLOTS, languagesForMovie,
  REVIEWER_NAMES, REVIEW_COMMENTS,
} = require('./config/seedData');
const { applyFormatSurcharge } = require('./config/pricing');
const tmdb = require('./services/tmdb');

const PAY_PER_REQUEST = 'PAY_PER_REQUEST';
const S = 'S';

const TABLE_DEFS = [
  {
    TableName: TABLES.USERS,
    KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: S },
      { AttributeName: 'email', AttributeType: S },
    ],
    // Login used to Scan the whole table; this makes it a Query.
    GlobalSecondaryIndexes: [{
      IndexName: 'email-index',
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'ALL' },
    }],
    BillingMode: PAY_PER_REQUEST,
  },
  {
    TableName: TABLES.MOVIES,
    KeySchema: [{ AttributeName: 'movieId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'movieId', AttributeType: S }],
    BillingMode: PAY_PER_REQUEST,
  },
  {
    TableName: TABLES.THEATRES,
    KeySchema: [{ AttributeName: 'theatreId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'theatreId', AttributeType: S },
      { AttributeName: 'city', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [{
      IndexName: 'city-index',
      KeySchema: [{ AttributeName: 'city', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'ALL' },
    }],
    BillingMode: PAY_PER_REQUEST,
  },
  {
    TableName: TABLES.SHOWS,
    KeySchema: [{ AttributeName: 'showId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'showId', AttributeType: S },
      { AttributeName: 'city', AttributeType: S },
      { AttributeName: 'movieId', AttributeType: S },
      { AttributeName: 'dateStart', AttributeType: S }, // "YYYY-MM-DD#HH:mm"
      { AttributeName: 'movieCity', AttributeType: S }, // "movieId#city"
    ],
    GlobalSecondaryIndexes: [
      {
        // "What's on in Mumbai on the 5th?"
        IndexName: 'city-date-index',
        KeySchema: [
          { AttributeName: 'city', KeyType: 'HASH' },
          { AttributeName: 'dateStart', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        // "Where is this film playing in this city, on this date?"
        IndexName: 'movieCity-date-index',
        KeySchema: [
          { AttributeName: 'movieCity', KeyType: 'HASH' },
          { AttributeName: 'dateStart', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'movieId-date-index',
        KeySchema: [
          { AttributeName: 'movieId', KeyType: 'HASH' },
          { AttributeName: 'dateStart', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: PAY_PER_REQUEST,
  },
  {
    // Signups waiting on their verification link. Nothing reaches the Users
    // table until the address is proven; DynamoDB's TTL sweeps up the rest.
    TableName: TABLES.PENDING,
    KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'email', AttributeType: S }],
    BillingMode: PAY_PER_REQUEST,
  },
  {
    // One item per occupied seat. The conditional write on this table is what
    // actually prevents double booking.
    TableName: TABLES.SEAT_LOCKS,
    KeySchema: [
      { AttributeName: 'showId', KeyType: 'HASH' },
      { AttributeName: 'seatId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'showId', AttributeType: S },
      { AttributeName: 'seatId', AttributeType: S },
    ],
    BillingMode: PAY_PER_REQUEST,
  },
  {
    // One item per (film, reviewer). The composite key is the uniqueness rule:
    // a second review from the same person overwrites the first rather than
    // stacking, so nobody can vote twice by submitting twice.
    //
    // The running average is NOT computed from this table on read — the movie
    // record carries ratingSum/ratingCount, updated in the same transaction as
    // the write. The listing page renders a dozen films at once and querying
    // reviews per film per render would be both slow and needlessly expensive.
    TableName: TABLES.REVIEWS,
    KeySchema: [
      { AttributeName: 'movieId', KeyType: 'HASH' },
      { AttributeName: 'userId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'movieId', AttributeType: S },
      { AttributeName: 'userId', AttributeType: S },
    ],
    BillingMode: PAY_PER_REQUEST,
  },
  {
    TableName: TABLES.SUPPORT,
    KeySchema: [{ AttributeName: 'ticketId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'ticketId', AttributeType: S },
      { AttributeName: 'userId', AttributeType: S },
      { AttributeName: 'createdAt', AttributeType: S },
      { AttributeName: 'allTickets', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-createdAt-index',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        // Constant partition key so the admin queue sorts by date without a
        // Scan. Fine at this volume; a busy system would shard the key.
        IndexName: 'allTickets-createdAt-index',
        KeySchema: [
          { AttributeName: 'allTickets', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: PAY_PER_REQUEST,
  },
  {
    TableName: TABLES.BOOKINGS,
    KeySchema: [{ AttributeName: 'bookingId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'bookingId', AttributeType: S },
      { AttributeName: 'userId', AttributeType: S },
      { AttributeName: 'showId', AttributeType: S },
      { AttributeName: 'bookedAt', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-bookedAt-index',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'bookedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'showId-index',
        KeySchema: [{ AttributeName: 'showId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: PAY_PER_REQUEST,
  },
];

// ---------------------------------------------------------------- helpers

async function tableExists(name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return false;
    throw err;
  }
}

async function waitActive(name) {
  for (let i = 0; i < 60; i++) {
    const desc = await client.send(new DescribeTableCommand({ TableName: name }));
    const tableOk = desc.Table.TableStatus === 'ACTIVE';
    const indexesOk = (desc.Table.GlobalSecondaryIndexes || [])
      .every(gsi => gsi.IndexStatus === 'ACTIVE');
    if (tableOk && indexesOk) return;
    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write('.');
  }
  throw new Error(`Timed out waiting for ${name}`);
}

/** BatchWrite in chunks of 25, retrying whatever DynamoDB hands back unprocessed. */
async function batchPut(tableName, items) {
  for (let i = 0; i < items.length; i += 25) {
    let requests = items.slice(i, i + 25).map(Item => ({ PutRequest: { Item } }));
    for (let attempt = 0; attempt < 5 && requests.length; attempt++) {
      const res = await docClient.send(new BatchWriteCommand({
        RequestItems: { [tableName]: requests },
      }));
      requests = (res.UnprocessedItems && res.UnprocessedItems[tableName]) || [];
      if (requests.length) await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
  }
}

async function clearTable(tableName, keyNames) {
  const res = await docClient.send(new ScanCommand({
    TableName: tableName,
    ProjectionExpression: keyNames.map((_, i) => `#k${i}`).join(', '),
    ExpressionAttributeNames: Object.fromEntries(keyNames.map((k, i) => [`#k${i}`, k])),
  }));
  const items = res.Items || [];
  for (let i = 0; i < items.length; i += 25) {
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: items.slice(i, i + 25).map(item => ({
          DeleteRequest: { Key: Object.fromEntries(keyNames.map(k => [k, item[k]])) },
        })),
      },
    }));
  }
  return items.length;
}

function to12Hour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

function dateKey(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function roundTo10(n) {
  return Math.round(n / 10) * 10;
}

// ---------------------------------------------------------------- seeding

async function seedMovies() {
  let movies = null;

  if (tmdb.isConfigured()) {
    // Every language any city programmes, so each city has genuine local
    // cinema rather than a Hindi/English list with a regional label.
    const wanted = ['hi', 'en', 'gu', 'mr', 'kn', 'te', 'pa'];
    console.log('🎞  Fetching current releases from TMDB (Hindi / English / regional)...');
    try {
      movies = await tmdb.fetchCatalog({ languages: wanted, perLanguage: 5, upcoming: 4 });
      console.log(`   ✅ ${movies.length} films fetched from TMDB`);
    } catch (err) {
      console.warn(`   ⚠ TMDB fetch failed (${err.message}) — using fallback list`);
    }
  } else {
    console.log('ℹ  No TMDB_API_KEY set — using the static fallback list.');
    console.log('   Add a free key to .env and re-run to pull films currently in cinemas.');
  }

  if (!movies || movies.length === 0) movies = FALLBACK_MOVIES;

  const items = movies.map(m => ({
    movieId: uuidv4(),
    backdropUrl: '',
    rating: null,
    releaseDate: '',
    ...m,
    createdAt: new Date().toISOString(),
  }));

  await batchPut(TABLES.MOVIES, items);

  const showing = items.filter(m => m.status === 'now_showing');
  const soon = items.filter(m => m.status === 'coming_soon');
  console.log(`   ✅ ${showing.length} now showing, ${soon.length} coming soon`);
  for (const m of showing) {
    console.log(`      • ${m.title} (${m.language}) — ${m.formats.join(', ')}${m.trailerUrl ? ' 🎬' : ''}`);
  }
  return items;
}

/**
 * Demo reviews for films already showing.
 *
 * These are invented — see config/seedData.js. Ratings are drawn around the
 * film's own TMDB score so the two numbers do not contradict each other on the
 * detail page: a film TMDB rates 8.2 should not show a user average of 2.1.
 *
 * Writes the aggregate straight onto the movie record, the same pair of fields
 * the live rating endpoint maintains, so seeded and genuine reviews add up
 * through one code path.
 */
async function seedReviews(movies) {
  const showing = movies.filter(m => m.status === 'now_showing');
  const reviews = [];
  const aggregates = new Map();

  for (const movie of showing) {
    // TMDB is out of 10 and ours is out of 5. No TMDB score means aim at 3.5,
    // i.e. mildly positive, rather than pretending to know.
    const centre = movie.rating ? movie.rating / 2 : 3.5;
    const howMany = 6 + Math.floor(Math.random() * 13); // 6–18

    // Distinct reviewers per film.
    const names = [...REVIEWER_NAMES].sort(() => Math.random() - 0.5).slice(0, howMany);

    // Comments are drawn without replacement per film — a pool shuffled once
    // per rating, then consumed. Drawing independently repeated the same
    // sentence several times on a single film, which reads as obviously fake.
    const unused = {};
    for (const [score, pool] of Object.entries(REVIEW_COMMENTS)) {
      unused[score] = [...pool].sort(() => Math.random() - 0.5);
    }

    let sum = 0;
    names.forEach((name, i) => {
      // Scatter either side of the centre, then clamp into 1..5.
      const spread = (Math.random() - 0.5) * 2.2;
      const rating = Math.min(5, Math.max(1, Math.round(centre + spread)));

      // If a band is exhausted the review simply carries no text, which is
      // normal — plenty of real ratings come without a written review.
      const comment = unused[rating].pop() || '';

      // Backdate across the last two months so the list is not all one day.
      const daysAgo = 1 + Math.floor(Math.random() * 60);
      const when = new Date(Date.now() - daysAgo * 86400000).toISOString();

      sum += rating;
      reviews.push({
        movieId: movie.movieId,
        userId: `seed#${movie.movieId}#${i}`,
        userName: name,
        rating,
        comment,
        createdAt: when,
        updatedAt: when,
        // The flag that makes these removable and honest.
        source: 'seed',
      });
    });

    aggregates.set(movie.movieId, { sum, count: names.length });
  }

  await batchPut(TABLES.REVIEWS, reviews);

  for (const [movieId, agg] of aggregates) {
    await docClient.send(new UpdateCommand({
      TableName: TABLES.MOVIES,
      Key: { movieId },
      UpdateExpression: 'SET ratingSum = :s, ratingCount = :c',
      ExpressionAttributeValues: { ':s': agg.sum, ':c': agg.count },
    }));
  }

  console.log(`   ✅ ${reviews.length} demo reviews across ${showing.length} films`);
  console.log('      (invented seed data — marked source:"seed")');
  return reviews;
}

async function seedTheatres() {
  const items = THEATRES.map(t => ({
    theatreId: uuidv4(),
    name: t.name,
    city: t.city,
    area: t.area,
    screens: t.screens.map((key, i) => {
      const tpl = SCREEN_TEMPLATES[key];
      const mult = CITY_MULTIPLIER[t.city] || 1;
      const basePrices = {};
      for (const [tier, price] of Object.entries(tpl.basePrices)) {
        basePrices[tier] = roundTo10(price * mult);
      }
      return {
        screenId: `S${i + 1}`,
        name: tpl.name,
        layoutId: tpl.layoutId,
        supportedFormats: tpl.supportedFormats,
        basePrices,
      };
    }),
    createdAt: new Date().toISOString(),
  }));

  await batchPut(TABLES.THEATRES, items);
  console.log(`   ✅ ${items.length} theatres across ${new Set(items.map(t => t.city)).size} cities`);
  return items;
}

/**
 * Build the schedule.
 *
 * Scheduling is done per city rather than per screen, because the thing that
 * matters to a booker is "where can I see this film today" — and that only
 * works if a title lands on several screens across different theatres.
 *
 * Three rules make that happen:
 *   1. A city programmes a capped number of titles (FILMS_PER_CITY), the way
 *      a real chain does, instead of every film in the catalogue.
 *   2. Each screen runs two titles a day, splitting the daily slots.
 *   3. Assignments are dealt across theatres before repeating within one, so
 *      a film appears at several cinemas rather than twice in the same lobby.
 */
function buildShows(movies, theatres) {
  const showing = movies.filter(m => m.status === 'now_showing');
  const shows = [];

  const theatresByCity = {};
  for (const t of theatres) (theatresByCity[t.city] = theatresByCity[t.city] || []).push(t);

  for (const [city, cityTheatres] of Object.entries(theatresByCity)) {
    const cityLanguages = languagesForCity(city);

    // A film only plays in a city that programmes its language. This is what
    // keeps Gujarati cinema out of Bengaluru and puts Kannada into it.
    const eligible = showing
      .filter(m => languagesForMovie(m, cityLanguages).length > 0)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, FILMS_PER_CITY);
    if (!eligible.length) continue;

    // Flatten the city into a list of screens, interleaved by theatre so that
    // consecutive assignments land in different buildings.
    const screenSlots = [];
    const maxScreens = Math.max(...cityTheatres.map(t => t.screens.length));
    for (let i = 0; i < maxScreens; i++) {
      for (const theatre of cityTheatres) {
        if (theatre.screens[i]) screenSlots.push({ theatre, screen: theatre.screens[i] });
      }
    }

    const slotsPerFilm = Math.ceil(SHOW_SLOTS.length / FILMS_PER_SCREEN_PER_DAY);

    for (let day = 0; day < BOOKING_WINDOW_DAYS; day++) {
      const date = dateKey(day);
      // Shift the starting point each day so the same film isn't permanently
      // stuck on the same screen.
      let pick = day;

      // Blocks outermost: deal the first block to every screen in the city
      // before starting the second. Consecutive films therefore land in
      // different cinemas instead of stacking up in one lobby.
      for (let block = 0; block < FILMS_PER_SCREEN_PER_DAY; block++) {
        // Nudge the starting film between blocks. Without this, a city with
        // as many screens as films deals the identical order every block, so
        // each film returns to the same screen and ends up in one theatre.
        pick += block === 0 ? 0 : Math.max(1, Math.floor(eligible.length / 3)) + 1;

        for (const { theatre, screen } of screenSlots) {
          // Next film this screen can actually project.
          let chosen = null;
          for (let attempt = 0; attempt < eligible.length; attempt++) {
            const movie = eligible[(pick + attempt) % eligible.length];
            const format = screen.supportedFormats.find(f => movie.formats.includes(f));
            if (format) { chosen = { movie, format }; pick += attempt + 1; break; }
          }
          if (!chosen) continue;

          const { movie, format } = chosen;
          const spoken = languagesForMovie(movie, cityLanguages);
          const blockSlots = SHOW_SLOTS.slice(block * slotsPerFilm, (block + 1) * slotsPerFilm);

          for (const [i, slot] of blockSlots.entries()) {
            // Rotate the language across the block's slots, so a dubbed film
            // genuinely offers a choice rather than the same track every time.
            const language = spoken[i % spoken.length];

            shows.push({
              showId: uuidv4(),
              movieId: movie.movieId,
              movieTitle: movie.title,
              posterUrl: movie.posterUrl,
              // The language of THIS screening, which may be a dub.
              language,
              originalLanguage: movie.language,
              isDubbed: language !== movie.language,
              certificate: movie.certificate,
              duration: movie.duration,

              theatreId: theatre.theatreId,
              theatreName: theatre.name,
              city: theatre.city,
              area: theatre.area,
              screenId: screen.screenId,
              screenName: screen.name,
              layoutId: screen.layoutId,

              format,
              date,
              time: to12Hour(slot),
              time24: slot,
              startsAt: new Date(`${date}T${slot}:00`).toISOString(),

              // GSI partition/sort keys
              dateStart: `${date}#${slot}`,
              movieCity: `${movie.movieId}#${theatre.city}`,

              prices: applyFormatSurcharge(screen.basePrices, format),
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
    }
  }
  return shows;
}

/**
 * Seed the admin account.
 *
 * Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD in .env. If no password
 * is set, a random one is generated and printed once — deliberately, so that
 * a working password never has to live in this repository. An earlier version
 * hardcoded one, which meant anyone reading the source could sign in as admin
 * on a deployed site.
 */
async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@moviebooking.com').trim().toLowerCase();

  const existing = await docClient.send(new QueryCommand({
    TableName: TABLES.USERS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email },
  }));

  if (existing.Items && existing.Items.length > 0) {
    console.log(`   ✅ Admin (${email}) already exists — password left untouched`);
    console.log('      To change it: node set-admin-password.js');
    return;
  }

  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }

  await docClient.send(new PutCommand({
    TableName: TABLES.USERS,
    Item: {
      userId: uuidv4(),
      name: 'Admin',
      email,
      password: await bcrypt.hash(password, 10),
      role: 'admin',
      // Created by the operator, not self-registered, so there is nothing to
      // confirm — otherwise the admin sees a "verify your email" prompt for an
      // address they chose themselves.
      emailVerified: true,
      verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  }));

  console.log(`   ✅ Admin created — ${email}`);
  if (generated) {
    console.log(`      Password: ${password}`);
    console.log('      ^ shown once. Save it now, or set ADMIN_PASSWORD in .env.');
  } else {
    console.log('      Password: taken from ADMIN_PASSWORD in .env');
  }
}

// ---------------------------------------------------------------- main

async function setup() {
  console.log('\n🎬 CineCloud — Setup');
  console.log(`   Region:   ${process.env.AWS_REGION || 'us-east-1'}`);
  console.log(`   Endpoint: ${process.env.DYNAMODB_ENDPOINT || 'AWS (default)'}\n`);

  console.log('📦 Tables');
  for (const def of TABLE_DEFS) {
    if (await tableExists(def.TableName)) {
      console.log(`   ✅ ${def.TableName} — exists`);
    } else {
      process.stdout.write(`   ⏳ ${def.TableName} — creating`);
      await client.send(new CreateTableCommand(def));
      await waitActive(def.TableName);
      console.log(' ready');
    }
  }

  console.log('\n🧹 Clearing catalog data (users and bookings are preserved)');
  // Seat locks are keyed by showId, so once the shows are regenerated with
  // fresh ids the old locks are unreachable garbage that would permanently
  // occupy seats. They go with the shows.
  const cleared = [
    await clearTable(TABLES.SEAT_LOCKS, ['showId', 'seatId']),
    await clearTable(TABLES.SHOWS, ['showId']),
    await clearTable(TABLES.THEATRES, ['theatreId']),
    await clearTable(TABLES.MOVIES, ['movieId']),
  ];
  console.log(`   ✅ removed ${cleared.reduce((a, b) => a + b, 0)} old records`);

  console.log('\n🎥 Movies');
  const movies = await seedMovies();

  console.log('\n🏢 Theatres');
  const theatres = await seedTheatres();

  console.log('\n🕐 Shows');
  const shows = buildShows(movies, theatres);
  await batchPut(TABLES.SHOWS, shows);
  console.log(`   ✅ ${shows.length} shows over the next ${BOOKING_WINDOW_DAYS} days`);
  for (const city of CITIES) {
    const n = shows.filter(s => s.city === city.id).length;
    if (n) console.log(`      • ${city.name}: ${n}`);
  }

  console.log('\n⭐ Reviews');
  await seedReviews(movies);

  console.log('\n👤 Admin');
  await seedAdmin();

  console.log('\n🎉 Setup complete — run: node server.js\n');
}

setup().catch(err => {
  console.error('\n❌ Setup failed:', err.message);
  if (err.name === 'UnrecognizedClientException' || err.name === 'CredentialsProviderError') {
    console.error('   No valid AWS credentials. For local dev set DYNAMODB_ENDPOINT and run DynamoDB Local.');
  }
  process.exit(1);
});
