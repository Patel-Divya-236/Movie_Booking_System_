/**
 * EC2 provisioning.
 *
 *   node aws-deploy.js provision   create the role, key pair, firewall and instance
 *   node aws-deploy.js status      show the instance and its public address
 *   node aws-deploy.js stop        stop the instance (stops hourly billing)
 *   node aws-deploy.js start       start it again
 *   node aws-deploy.js terminate   destroy it permanently
 *
 * Idempotent: re-running `provision` reuses anything that already exists
 * rather than creating duplicates.
 *
 * This is the only script here that creates a resource billed by the hour,
 * so it prints the cost note and asks for confirmation before launching.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const {
  IAMClient, CreatePolicyCommand, CreateRoleCommand, AttachRolePolicyCommand,
  CreateInstanceProfileCommand, AddRoleToInstanceProfileCommand,
  GetInstanceProfileCommand, GetRoleCommand,
} = require('@aws-sdk/client-iam');
const {
  EC2Client, CreateKeyPairCommand, DescribeKeyPairsCommand,
  CreateSecurityGroupCommand, DescribeSecurityGroupsCommand, AuthorizeSecurityGroupIngressCommand,
  RunInstancesCommand, DescribeInstancesCommand, CreateTagsCommand,
  StopInstancesCommand, StartInstancesCommand, TerminateInstancesCommand,
  waitUntilInstanceRunning, waitUntilInstanceStatusOk,
} = require('@aws-sdk/client-ec2');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const NAME = 'cinecloud';
const ROLE_NAME = 'CineCloudInstanceRole';
const POLICY_NAME = 'CineCloudApp';
const SG_NAME = 'cinecloud-sg';
const KEY_NAME = 'cinecloud-key';
const KEY_PATH = path.join(__dirname, `${KEY_NAME}.pem`);
const INSTANCE_TYPE = process.env.EC2_INSTANCE_TYPE || 't2.micro';
const AL2023_AMI_PARAM = '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64';

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
};

const ec2 = new EC2Client({ region: REGION });
const iam = new IAMClient({ region: REGION });

const flags = Object.fromEntries(
  process.argv.slice(3).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ask = q => {
  // Without a TTY a prompt reads EOF immediately, so treat it as "no answer".
  if (!process.stdin.isTTY) return Promise.resolve('');
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, a => { rl.close(); res(a.trim()); });
  });
};

/**
 * Treat "it already exists" as success — that's what makes this re-runnable.
 * Matched by substring because AWS is inconsistent about the suffix:
 * IAM raises EntityAlreadyExistsException, EC2 raises InvalidGroup.Duplicate.
 */
function isAlreadyExists(err) {
  const name = err.name || '';
  return name.includes('AlreadyExists') || name.includes('Duplicate');
}

async function tolerateExisting(fn, label) {
  try {
    const result = await fn();
    console.log(c.green(`   ✅ ${label} created`));
    return result;
  } catch (err) {
    if (isAlreadyExists(err)) {
      console.log(c.dim(`   • ${label} already exists — reusing`));
      return null;
    }
    throw err;
  }
}

// -------------------------------------------------------------- preflight

async function identity() {
  try {
    return await new STSClient({ region: REGION }).send(new GetCallerIdentityCommand({}));
  } catch (err) {
    console.error(c.red('\n❌ No usable AWS credentials. Fill in AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env\n'));
    console.error(c.dim(`   ${err.message}\n`));
    process.exit(1);
  }
}

async function findInstance() {
  const res = await ec2.send(new DescribeInstancesCommand({
    Filters: [
      { Name: 'tag:Name', Values: [NAME] },
      { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
    ],
  }));
  return res.Reservations?.[0]?.Instances?.[0] || null;
}

// -------------------------------------------------------------------- IAM

async function ensureRole(accountId) {
  console.log(c.bold('\n🔐 IAM instance role\n'));

  const appPolicy = JSON.parse(fs.readFileSync(path.join(__dirname, 'aws', 'app-policy.json'), 'utf8'));
  delete appPolicy.Comment; // AWS rejects unknown top-level keys

  const policyArn = `arn:aws:iam::${accountId}:policy/${POLICY_NAME}`;
  await tolerateExisting(
    () => iam.send(new CreatePolicyCommand({
      PolicyName: POLICY_NAME,
      PolicyDocument: JSON.stringify(appPolicy),
      Description: 'Least-privilege policy for the CineCloud app running on EC2',
    })),
    `policy ${POLICY_NAME}`
  );

  await tolerateExisting(
    () => iam.send(new CreateRoleCommand({
      RoleName: ROLE_NAME,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { Service: 'ec2.amazonaws.com' },
          Action: 'sts:AssumeRole',
        }],
      }),
      Description: 'Lets the CineCloud EC2 instance reach DynamoDB, SES and SNS without stored keys',
    })),
    `role ${ROLE_NAME}`
  );

  await iam.send(new AttachRolePolicyCommand({ RoleName: ROLE_NAME, PolicyArn: policyArn }));
  console.log(c.dim(`   • ${POLICY_NAME} attached to ${ROLE_NAME}`));

  await tolerateExisting(
    () => iam.send(new CreateInstanceProfileCommand({ InstanceProfileName: ROLE_NAME })),
    `instance profile ${ROLE_NAME}`
  );

  try {
    await iam.send(new AddRoleToInstanceProfileCommand({
      InstanceProfileName: ROLE_NAME, RoleName: ROLE_NAME,
    }));
  } catch (err) {
    // LimitExceeded means the profile already holds this role — a profile
    // can only carry one, so on a re-run that is the expected outcome.
    if (!err.name?.includes('LimitExceeded') && !isAlreadyExists(err)) throw err;
  }

  // IAM is eventually consistent; RunInstances fails if the profile isn't
  // visible yet, so wait for it to actually resolve.
  process.stdout.write(c.dim('   • waiting for IAM to propagate'));
  for (let i = 0; i < 20; i++) {
    try {
      const profile = await iam.send(new GetInstanceProfileCommand({ InstanceProfileName: ROLE_NAME }));
      if (profile.InstanceProfile?.Roles?.length) { console.log(c.dim(' ready')); break; }
    } catch { /* not visible yet */ }
    process.stdout.write(c.dim('.'));
    await sleep(3000);
  }

  return ROLE_NAME;
}

// -------------------------------------------------------------------- EC2

async function ensureKeyPair() {
  console.log(c.bold('\n🔑 SSH key pair\n'));

  const existing = await ec2.send(new DescribeKeyPairsCommand({ KeyNames: [KEY_NAME] }))
    .catch(() => null);

  if (existing?.KeyPairs?.length) {
    if (!fs.existsSync(KEY_PATH)) {
      console.log(c.red(`   ⚠ ${KEY_NAME} exists in AWS but ${KEY_NAME}.pem is missing locally.`));
      console.log(c.red('     AWS only reveals the private key once. Delete the key pair in the'));
      console.log(c.red('     EC2 console and re-run to generate a fresh one.'));
      process.exit(1);
    }
    console.log(c.dim(`   • ${KEY_NAME} already exists — reusing ${KEY_NAME}.pem`));
    return KEY_NAME;
  }

  const pair = await ec2.send(new CreateKeyPairCommand({ KeyName: KEY_NAME }));
  fs.writeFileSync(KEY_PATH, pair.KeyMaterial, { mode: 0o600 });
  console.log(c.green(`   ✅ created and saved to ${KEY_NAME}.pem`));
  console.log(c.yellow('   ⚠ This file is your only copy — it is gitignored, keep it safe.'));
  return KEY_NAME;
}

/** Your current public IP, so SSH isn't open to the whole internet. */
async function myIp() {
  try {
    const res = await fetch('https://checkip.amazonaws.com');
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

async function ensureSecurityGroup() {
  console.log(c.bold('\n🛡  Security group\n'));

  const found = await ec2.send(new DescribeSecurityGroupsCommand({
    Filters: [{ Name: 'group-name', Values: [SG_NAME] }],
  }));

  let groupId = found.SecurityGroups?.[0]?.GroupId;
  if (groupId) {
    console.log(c.dim(`   • ${SG_NAME} already exists — reusing (${groupId})`));
  } else {
    const created = await ec2.send(new CreateSecurityGroupCommand({
      GroupName: SG_NAME,
      // ASCII only: EC2 rejects non-ASCII characters in a group description.
      Description: 'CineCloud - HTTP from anywhere, SSH from the admin IP',
    }));
    groupId = created.GroupId;
    console.log(c.green(`   ✅ ${SG_NAME} created (${groupId})`));
  }

  const ip = await myIp();
  const sshCidr = ip ? `${ip}/32` : '0.0.0.0/0';
  if (!ip) {
    console.log(c.yellow('   ⚠ Could not detect your public IP — opening SSH to 0.0.0.0/0.'));
    console.log(c.yellow('     Narrow this in the EC2 console when you can.'));
  }

  const rules = [
    { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: sshCidr, Description: 'SSH from admin' }] },
    { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP' }] },
  ];

  for (const rule of rules) {
    try {
      await ec2.send(new AuthorizeSecurityGroupIngressCommand({ GroupId: groupId, IpPermissions: [rule] }));
      console.log(c.green(`   ✅ allow tcp/${rule.FromPort} from ${rule.IpRanges[0].CidrIp}`));
    } catch (err) {
      if (err.name === 'InvalidPermission.Duplicate') {
        console.log(c.dim(`   • tcp/${rule.FromPort} rule already present`));
      } else throw err;
    }
  }

  // Port 3000 stays closed: nginx fronts the app on 80.
  return groupId;
}

/**
 * Bootstrap script the instance runs on first boot. It prepares the machine
 * only — the application itself is uploaded afterwards, so a failed deploy
 * never leaves a half-installed server.
 */
function userData() {
  const script = `#!/bin/bash
set -euxo pipefail

curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs nginx
npm install -g pm2

cat > /etc/nginx/conf.d/cinecloud.conf <<'NGINX'
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

rm -f /etc/nginx/conf.d/default.conf
systemctl enable --now nginx

install -d -o ec2-user -g ec2-user /home/ec2-user/app
touch /home/ec2-user/.bootstrap-complete
chown ec2-user:ec2-user /home/ec2-user/.bootstrap-complete
`;
  return Buffer.from(script).toString('base64');
}

async function launch({ profileName, keyName, groupId }) {
  console.log(c.bold('\n🚀 EC2 instance\n'));

  const existing = await findInstance();
  if (existing) {
    console.log(c.dim(`   • instance already exists: ${existing.InstanceId} (${existing.State.Name})`));
    return existing;
  }

  const ami = await new SSMClient({ region: REGION })
    .send(new GetParameterCommand({ Name: AL2023_AMI_PARAM }));
  const imageId = ami.Parameter.Value;
  console.log(c.dim(`   • Amazon Linux 2023 AMI: ${imageId}`));

  console.log(c.yellow(`\n   ⚠ About to launch a ${INSTANCE_TYPE} in ${REGION}.`));
  console.log(c.yellow('     This bills by the hour once the free tier is used up.'));
  console.log(c.yellow('     Run `node aws-deploy.js stop` when you are not demoing it.\n'));

  if (!flags.yes) {
    const answer = await ask(c.bold('   Launch it? (yes/no)  [--yes to skip this] '));
    if (!/^y(es)?$/i.test(answer)) {
      console.log('\n   Aborted — no instance was created.\n');
      process.exit(0);
    }
  }

  const run = await ec2.send(new RunInstancesCommand({
    ImageId: imageId,
    InstanceType: INSTANCE_TYPE,
    MinCount: 1,
    MaxCount: 1,
    KeyName: keyName,
    SecurityGroupIds: [groupId],
    IamInstanceProfile: { Name: profileName },
    UserData: userData(),
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [{ Key: 'Name', Value: NAME }, { Key: 'Project', Value: 'CineCloud' }],
    }],
    MetadataOptions: { HttpTokens: 'required' }, // IMDSv2 only
  }));

  const instanceId = run.Instances[0].InstanceId;
  console.log(c.green(`   ✅ launched ${instanceId}`));

  process.stdout.write(c.dim('   • waiting for it to run'));
  await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [instanceId] });
  console.log(c.dim(' running'));

  process.stdout.write(c.dim('   • waiting for status checks (this takes a few minutes)'));
  await waitUntilInstanceStatusOk({ client: ec2, maxWaitTime: 600 }, { InstanceIds: [instanceId] });
  console.log(c.dim(' ok'));

  return findInstance();
}

// --------------------------------------------------------------- commands

async function provision() {
  console.log(c.bold('\n═══ CineCloud — EC2 provisioning ═══'));

  const me = await identity();
  console.log(`\n   Account : ${c.cyan(me.Account)}`);
  console.log(`   Region  : ${c.cyan(REGION)}`);

  const profileName = await ensureRole(me.Account);
  const keyName = await ensureKeyPair();
  const groupId = await ensureSecurityGroup();
  const instance = await launch({ profileName, keyName, groupId });

  const ip = instance.PublicIpAddress;
  console.log(c.bold('\n═══ Instance ready ═══\n'));
  console.log(`   Instance  ${instance.InstanceId}`);
  console.log(`   Public IP ${c.cyan(ip)}`);
  console.log(`   SSH       ssh -i ${KEY_NAME}.pem ec2-user@${ip}`);
  console.log(c.bold('\n   Next: upload the app and start it.\n'));
  console.log(c.dim('   The instance is still running its bootstrap (Node, nginx, pm2).'));
  console.log(c.dim('   Give it ~2 minutes, then check:'));
  console.log(c.dim(`     ssh -i ${KEY_NAME}.pem ec2-user@${ip} "ls ~/.bootstrap-complete"\n`));
}

async function status() {
  const instance = await findInstance();
  if (!instance) return console.log('\n   No CineCloud instance found. Run: node aws-deploy.js provision\n');
  console.log(`\n   ${instance.InstanceId}  ${instance.State.Name}  ${instance.PublicIpAddress || '(no public IP)'}`);
  console.log(`   Type ${instance.InstanceType}  ·  launched ${instance.LaunchTime.toISOString()}`);
  if (instance.PublicIpAddress) {
    console.log(`\n   Site  http://${instance.PublicIpAddress}`);
    console.log(`   SSH   ssh -i ${KEY_NAME}.pem ec2-user@${instance.PublicIpAddress}\n`);
  }
}

async function power(action) {
  const instance = await findInstance();
  if (!instance) return console.log('\n   No instance found.\n');
  const ids = { InstanceIds: [instance.InstanceId] };

  if (action === 'stop') {
    await ec2.send(new StopInstancesCommand(ids));
    console.log(c.green(`\n   Stopping ${instance.InstanceId} — hourly billing stops once it is stopped.`));
    console.log(c.dim('   Note: the public IP changes when you start it again.\n'));
  } else if (action === 'start') {
    await ec2.send(new StartInstancesCommand(ids));
    console.log(c.green(`\n   Starting ${instance.InstanceId} — run \`status\` in a minute for the new IP.\n`));
  } else if (action === 'terminate') {
    const answer = await ask(c.red(`\n   Permanently destroy ${instance.InstanceId}? Type the instance id to confirm: `));
    if (answer !== instance.InstanceId) return console.log('\n   Aborted.\n');
    await ec2.send(new TerminateInstancesCommand(ids));
    console.log(c.green('\n   Terminated. DynamoDB tables, SNS and SES are untouched.\n'));
  }
}

const command = process.argv[2] || 'provision';
const handlers = {
  provision,
  status,
  stop: () => power('stop'),
  start: () => power('start'),
  terminate: () => power('terminate'),
};

if (!handlers[command]) {
  console.error(`\nUnknown command "${command}". Use: provision | status | stop | start | terminate\n`);
  process.exit(1);
}

handlers[command]().catch(err => {
  console.error(c.red(`\n❌ ${err.name}: ${err.message}\n`));
  if (err.name === 'CredentialsProviderError' || err.name === 'InvalidClientTokenId') {
    console.error(c.dim('   Fill in AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env — see EC2_SETUP.md § 1.1.\n'));
  }
  if (err.name === 'UnauthorizedOperation' || err.name === 'AccessDenied') {
    console.error(c.dim('   Your IAM user needs EC2 and IAM permissions — see EC2_SETUP.md § 1.1.\n'));
  }
  process.exit(1);
});
