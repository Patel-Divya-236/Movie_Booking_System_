/**
 * AWS account provisioning.
 *
 *   node aws-setup.js
 *
 * Idempotent — safe to run repeatedly. It:
 *   1. confirms which AWS account and identity it is about to act on
 *   2. creates the SNS topic for booking alerts (and subscribes an admin email)
 *   4. writes the resulting ARNs back into .env
 *
 * DynamoDB tables are NOT created here — run `node setup-tables.js` for that,
 * so schema changes and account setup stay separate concerns.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { SNSClient, CreateTopicCommand, SubscribeCommand, ListSubscriptionsByTopicCommand } = require('@aws-sdk/client-sns');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const TOPIC_NAME = process.env.SNS_TOPIC_NAME || 'cinecloud-bookings';
const ENV_PATH = path.join(__dirname, '.env');

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
};

/**
 * Flags let this run unattended (CI, or an agent driving it):
 *   --yes             skip the confirmation prompt
 *   --alerts=EMAIL    address to subscribe to the SNS topic
 */
const flags = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const ask = question => {
  // With no TTY (or --yes) a prompt would block forever on EOF.
  if (flags.yes || !process.stdin.isTTY) return Promise.resolve('');
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
};

/** Rewrite a single KEY=value line in .env, appending it if absent. */
function setEnvValue(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');

  if (pattern.test(content)) content = content.replace(pattern, line);
  else content += (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';

  fs.writeFileSync(ENV_PATH, content);
}

// ------------------------------------------------------------- preflight

async function preflight() {
  console.log(c.bold('\n🔎 Step 1 — Who am I?\n'));

  if (process.env.DYNAMODB_ENDPOINT) {
    console.log(c.yellow('   ⚠ DYNAMODB_ENDPOINT is set in .env — that points at DynamoDB Local.'));
    console.log(c.yellow('     Comment it out before running against real AWS.\n'));
  }

  let identity;
  try {
    identity = await new STSClient({ region: REGION }).send(new GetCallerIdentityCommand({}));
  } catch (err) {
    console.error(c.red('   ❌ No usable AWS credentials.\n'));
    console.error('   Add these to .env (or run `aws configure`):\n');
    console.error('     AWS_ACCESS_KEY_ID=AKIA…');
    console.error('     AWS_SECRET_ACCESS_KEY=…');
    console.error(`     AWS_REGION=${REGION}\n`);
    console.error(c.dim(`   SDK said: ${err.message}\n`));
    process.exit(1);
  }

  console.log(`   Account : ${c.cyan(identity.Account)}`);
  console.log(`   Identity: ${c.cyan(identity.Arn)}`);
  console.log(`   Region  : ${c.cyan(REGION)}\n`);

  if (!flags.yes) {
    const answer = await ask(c.bold('   Create resources in this account? (yes/no) '));
    if (!/^y(es)?$/i.test(answer)) {
      console.log('\n   Aborted — nothing was created.\n');
      process.exit(0);
    }
  }
  return identity;
}

// ------------------------------------------------------------------- SNS

async function setupSns() {
  console.log(c.bold('\n📢 Step 2 — SNS booking-alert topic\n'));
  const sns = new SNSClient({ region: REGION });

  // CreateTopic is idempotent: an existing topic just returns its ARN.
  const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: TOPIC_NAME }));
  console.log(`   ✅ Topic ready: ${c.cyan(TopicArn)}`);

  setEnvValue('SNS_BOOKING_TOPIC_ARN', TopicArn);
  console.log(c.dim('      → written to .env as SNS_BOOKING_TOPIC_ARN'));

  const adminEmail = (flags.alerts || await ask('\n   Email to receive booking alerts (blank to skip): ')).toString().trim();
  if (adminEmail) {
    const existing = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn }));
    const already = (existing.Subscriptions || []).some(s => s.Endpoint === adminEmail);

    if (already) {
      console.log(c.green(`   ✅ ${adminEmail} is already subscribed`));
    } else {
      await sns.send(new SubscribeCommand({ TopicArn, Protocol: 'email', Endpoint: adminEmail }));
      console.log(c.yellow(`   📨 Confirmation email sent to ${adminEmail}`));
      console.log(c.yellow('      Click the link in it — SNS will not deliver until you confirm.'));
    }
  }

  return TopicArn;
}

// ------------------------------------------------------------------ main

(async () => {
  console.log(c.bold('\n═══ CineCloud — AWS setup ═══'));

  const identity = await preflight();
  const topicArn = await setupSns();

  console.log(c.bold('\n═══ Done ═══\n'));
  console.log('   Account       ', identity.Account);
  console.log('   Region        ', REGION);
  console.log('   SNS topic     ', topicArn || '—');

  console.log(c.bold('\n   Next:\n'));
  console.log('   1. Comment out DYNAMODB_ENDPOINT in .env (so it targets real AWS)');
  console.log('   2. node setup-tables.js      # creates the 6 tables + indexes, seeds data');
  console.log('   3. node server.js            # run it');
  console.log('   4. Confirm the SNS subscription email in your inbox');
  console.log(c.dim('\n   To deploy on EC2, see EC2_SETUP.md\n'));
})().catch(err => {
  console.error(c.red(`\n❌ Setup failed: ${err.message}`));
  if (err.name === 'AccessDenied' || err.name === 'AuthorizationError') {
    console.error(c.dim('   The IAM user needs the permissions in aws/setup-policy.json\n'));
  }
  process.exit(1);
});
