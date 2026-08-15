/**
 * Change an admin password.
 *
 *   node set-admin-password.js                          reset ADMIN_EMAIL to a random password
 *   node set-admin-password.js --email=you@example.com  pick the account
 *   node set-admin-password.js --password=yourchoice    pick the password
 *   node set-admin-password.js --promote                also grant the admin role
 *
 * The new password is printed once and never written to disk. Run this against
 * whichever environment your .env points at.
 */
require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { docClient, TABLES } = require('./db');
const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const flags = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

(async () => {
  const email = (flags.email || process.env.ADMIN_EMAIL || 'admin@moviebooking.com')
    .toString().trim().toLowerCase();

  const found = await docClient.send(new QueryCommand({
    TableName: TABLES.USERS,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email },
  }));

  const user = found.Items?.[0];
  if (!user) {
    console.error(`\n❌ No account found for ${email}`);
    console.error('   Register it on the site first, or run: node setup-tables.js\n');
    process.exit(1);
  }

  const password = flags.password
    ? String(flags.password)
    : crypto.randomBytes(12).toString('base64url');

  if (password.length < 8) {
    console.error('\n❌ Use at least 8 characters.\n');
    process.exit(1);
  }

  const sets = ['password = :p', 'passwordChangedAt = :t'];
  const values = {
    ':p': await bcrypt.hash(password, 10),
    ':t': new Date().toISOString(),
  };
  if (flags.promote) {
    sets.push('#r = :role');
    values[':role'] = 'admin';
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLES.USERS,
    Key: { userId: user.userId },
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeValues: values,
    ...(flags.promote ? { ExpressionAttributeNames: { '#r': 'role' } } : {}),
  }));

  console.log(`\n✅ Password updated for ${email} (role: ${flags.promote ? 'admin' : user.role})`);
  if (!flags.password) {
    console.log(`\n   New password: ${password}`);
    console.log('   ^ shown once — save it now.\n');
  } else {
    console.log('   Using the password you supplied.\n');
  }
  console.log('   Existing JWTs stay valid for up to 24h until they expire.\n');
})().catch(err => {
  console.error('\n❌', err.message, '\n');
  process.exit(1);
});
