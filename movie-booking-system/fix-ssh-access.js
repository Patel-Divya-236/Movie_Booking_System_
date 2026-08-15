/**
 * Re-point the SSH rule at your current IP.
 *
 *   node fix-ssh-access.js
 *
 * Home broadband hands out dynamic addresses, so the IP allowed when the
 * security group was created stops matching after a reconnect and SSH starts
 * timing out. This adds your current address and removes stale ones, keeping
 * port 22 closed to everyone else.
 */
require('dotenv').config();

const {
  EC2Client, DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand,
} = require('@aws-sdk/client-ec2');

const SG_NAME = 'cinecloud-sg';
const ec2 = new EC2Client({ region: process.env.AWS_REGION || 'ap-south-1' });

/** Ask a couple of services, so one being unreachable isn't fatal. */
async function detectIp() {
  const flag = process.argv.find(a => a.startsWith('--ip='));
  if (flag) return flag.split('=')[1];

  for (const url of ['https://checkip.amazonaws.com', 'https://api.ipify.org', 'https://ifconfig.me/ip']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const ip = (await res.text()).trim();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
      }
    } catch { /* try the next one */ }
  }
  throw new Error('Could not detect your public IP. Pass it explicitly: --ip=1.2.3.4');
}

(async () => {
  const myIp = await detectIp();
  const cidr = `${myIp}/32`;
  console.log(`\nYour current IP: ${myIp}`);

  const found = await ec2.send(new DescribeSecurityGroupsCommand({
    Filters: [{ Name: 'group-name', Values: [SG_NAME] }],
  }));
  const sg = found.SecurityGroups?.[0];
  if (!sg) {
    console.error(`\n❌ Security group "${SG_NAME}" not found. Run: node aws-deploy.js provision\n`);
    process.exit(1);
  }

  const sshRules = sg.IpPermissions.filter(p => p.FromPort === 22);
  const existing = sshRules.flatMap(p => (p.IpRanges || []).map(r => r.CidrIp));

  if (existing.includes(cidr)) {
    console.log('✅ Your IP is already allowed — SSH should work.\n');
    return;
  }

  await ec2.send(new AuthorizeSecurityGroupIngressCommand({
    GroupId: sg.GroupId,
    IpPermissions: [{
      IpProtocol: 'tcp', FromPort: 22, ToPort: 22,
      IpRanges: [{ CidrIp: cidr, Description: `SSH from admin (${new Date().toISOString().slice(0, 10)})` }],
    }],
  }));
  console.log(`✅ Allowed SSH from ${cidr}`);

  // Drop the addresses that no longer belong to you, so port 22 does not
  // slowly accumulate access for whoever now holds those IPs.
  const stale = existing.filter(c => c !== cidr && c !== '0.0.0.0/0');
  for (const old of stale) {
    try {
      await ec2.send(new RevokeSecurityGroupIngressCommand({
        GroupId: sg.GroupId,
        IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: old }] }],
      }));
      console.log(`🧹 Removed stale rule for ${old}`);
    } catch (err) {
      // Access was already granted above, so a failure to tidy up is a
      // warning, not a reason to exit non-zero.
      console.warn(`⚠ Could not remove the stale rule for ${old}: ${err.name}`);
      if (err.name === 'UnauthorizedOperation') {
        console.warn('  Add ec2:RevokeSecurityGroupIngress to the CineCloudSetup policy,');
        console.warn('  or delete the rule by hand in the EC2 console.');
      }
    }
  }

  console.log('\nSSH should work now.\n');
})().catch(err => {
  console.error(`\n❌ ${err.name}: ${err.message}\n`);
  process.exit(1);
});
