/**
 * Wipe user-generated data, keeping the catalogue.
 *
 *   node reset-user-data.js --dry-run    show what would go
 *   node reset-user-data.js --confirm    actually delete
 *
 * Removes every non-admin account and everything attached to it: bookings,
 * seat locks, support tickets and unconfirmed signups. Movies, theatres,
 * shows and the admin account are left alone — deleting the admin would lock
 * you out of /admin, and the catalogue is expensive to rebuild.
 *
 * Written for the moment email verification was switched on: accounts created
 * before that were never proven to belong to anyone, so the safe move is to
 * clear them and let people sign up again through the verified flow.
 */
require('dotenv').config();

const { docClient, TABLES, queryAll } = require('./db');
const { ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const confirm = process.argv.includes('--confirm');
const scanAll = table => queryAll(ScanCommand, { TableName: table });

/** Delete in chunks of 25, retrying whatever DynamoDB hands back. */
async function deleteAll(tableName, keys) {
  if (!keys.length) return 0;
  for (let i = 0; i < keys.length; i += 25) {
    let requests = keys.slice(i, i + 25).map(Key => ({ DeleteRequest: { Key } }));
    for (let attempt = 0; attempt < 5 && requests.length; attempt++) {
      const res = await docClient.send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }));
      requests = res.UnprocessedItems?.[tableName] || [];
      if (requests.length) await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  return keys.length;
}

(async () => {
  const [users, bookings, locks, tickets, pending] = await Promise.all([
    scanAll(TABLES.USERS), scanAll(TABLES.BOOKINGS), scanAll(TABLES.SEAT_LOCKS),
    scanAll(TABLES.SUPPORT), scanAll(TABLES.PENDING),
  ]);

  const admins = users.filter(u => u.role === 'admin');
  const doomed = users.filter(u => u.role !== 'admin');

  console.log('\nWill delete:');
  console.log(`  ${doomed.length} account(s)`);
  console.log(`  ${bookings.length} booking(s)`);
  console.log(`  ${locks.length} seat lock(s)`);
  console.log(`  ${tickets.length} support ticket(s)`);
  console.log(`  ${pending.length} pending signup(s)`);
  console.log(`\nWill keep:`);
  console.log(`  ${admins.length} admin account(s): ${admins.map(a => a.email).join(', ')}`);
  console.log(`  all movies, theatres and shows`);

  if (!confirm) {
    console.log('\nDry run — nothing deleted. Re-run with --confirm to proceed.\n');
    return;
  }

  console.log('\nDeleting…');
  // Bookings and locks first: an interrupted run then leaves orphaned rows
  // rather than accounts whose data has silently vanished.
  console.log(`  seat locks      : ${await deleteAll(TABLES.SEAT_LOCKS, locks.map(l => ({ showId: l.showId, seatId: l.seatId })))}`);
  console.log(`  bookings        : ${await deleteAll(TABLES.BOOKINGS, bookings.map(b => ({ bookingId: b.bookingId })))}`);
  console.log(`  support tickets : ${await deleteAll(TABLES.SUPPORT, tickets.map(t => ({ ticketId: t.ticketId })))}`);
  console.log(`  pending signups : ${await deleteAll(TABLES.PENDING, pending.map(p => ({ email: p.email })))}`);
  console.log(`  accounts        : ${await deleteAll(TABLES.USERS, doomed.map(u => ({ userId: u.userId })))}`);

  const remaining = await scanAll(TABLES.USERS);
  console.log(`\nRemaining accounts (${remaining.length}):`);
  for (const u of remaining) console.log(`  ${u.email}  (${u.role})`);
  console.log('\nDone. Every seat is free again and the catalogue is untouched.\n');
})().catch(err => {
  console.error('\nFailed:', err.message, '\n');
  process.exit(1);
});
