# CineCloud — AWS Setup & Deployment

Two stages: **provision your AWS account** (once, from your laptop), then **deploy to EC2**.

| Service | Role |
|---|---|
| **DynamoDB** | 6 tables — Users, Movies, Theatres, Shows, SeatLocks, Bookings — on-demand billing |
| **EC2** | Runs the Node/Express server and serves the frontend |
| **SES** | Emails the ticket PDF to the customer |
| **SNS** | Publishes a booking alert to an admin topic |
| **IAM** | Instance role, so no AWS keys are ever stored on the server |

---

## Stage 1 — Provision the account (from your laptop)

### 1.1 Create an IAM user for setup

Root credentials should never be used by an application. In the AWS console:

1. **IAM → Users → Create user**, name it `cinecloud-setup`
2. Skip console access — this user only needs programmatic access
3. **Attach policies directly → Create policy → JSON**, paste [`aws/setup-policy.json`](aws/setup-policy.json), name it `CineCloudSetup`
4. Attach `CineCloudSetup` to the user
5. Open the user → **Security credentials → Create access key** → *Application running outside AWS*
6. Copy the access key ID and secret — the secret is shown **once**

> The policy is scoped to `MovieBooking_*` tables and `cinecloud-*` topics, so this key cannot touch anything else in your account.

### 1.2 Put the credentials in `.env`

Edit `movie-booking-system/.env`:

```ini
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# Comment this out — it points at DynamoDB Local:
# DYNAMODB_ENDPOINT=http://localhost:8000
```

`.env` is gitignored. Never commit it.

### 1.3 Run the setup

```bash
cd movie-booking-system
npm install

node aws-setup.js      # confirms the account, creates the SNS topic, verifies the SES sender
node setup-tables.js   # creates the 6 tables with their indexes, then seeds the catalog
node server.js         # http://localhost:3000, now on real AWS
```

`aws-setup.js` prints the account ID and asks before creating anything. Both scripts are idempotent.

### 1.4 Confirm the two emails

- **SNS** sends a subscription confirmation — alerts do not flow until you click it.
- **SES** sends a verification link for the sender address.

**SES sandbox:** a new account can only send *to verified addresses*. Verify your own test address under **SES → Identities**, or request production access. Until then, ticket emails to unverified addresses fail silently — bookings still succeed, which is by design.

---

## Stage 2 — Deploy to EC2 (automated)

```bash
node aws-deploy.js provision
```

One command creates all of it, and is safe to re-run — anything that already exists is reused:

| Resource | What it is |
|---|---|
| `CineCloudApp` policy | Least privilege: read/write the tables, send mail, publish alerts. **Cannot create or delete tables**, so a compromised instance cannot destroy your data |
| `CineCloudInstanceRole` | Instance role, so no AWS keys are ever written to the server |
| `cinecloud-key.pem` | SSH key, saved locally. AWS reveals the private key **once** — it is gitignored, keep it |
| `cinecloud-sg` | Firewall: port 80 open, port 22 restricted to **your current IP** |
| `cinecloud` instance | t2.micro Amazon Linux 2023, IMDSv2 enforced |

The instance's first boot installs Node 22, nginx and pm2, and configures nginx to proxy port 80 → 3000. Port 3000 is never exposed.

The script **asks before launching** — that's the only resource here billed by the hour.

### Managing the instance

```bash
node aws-deploy.js status      # state and public IP
node aws-deploy.js stop        # stops hourly billing
node aws-deploy.js start       # note: the public IP changes
node aws-deploy.js terminate   # destroys it; DynamoDB/SNS/SES untouched
```

### Upload and start the app

Wait ~2 minutes after provisioning for the bootstrap to finish:

```bash
IP=<public-ip>
ssh -i cinecloud-key.pem ec2-user@$IP "ls ~/.bootstrap-complete"   # exists when ready

scp -i cinecloud-key.pem -r ./routes ./services ./config ./public \
    ./server.js ./db.js ./setup-tables.js ./package.json \
    ec2-user@$IP:~/app/

scp -i cinecloud-key.pem ./.env.production.example ec2-user@$IP:~/app/.env
```

Then on the instance:

```bash
ssh -i cinecloud-key.pem ec2-user@$IP
cd ~/app
npm install --omit=dev

nano .env     # set a NEW JWT_SECRET, the region, SES sender and SNS topic ARN
              # leave the AWS key lines out — the instance role supplies them

node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET

pm2 start server.js --name cinecloud
pm2 startup   # run the command it prints
pm2 save
pm2 logs cinecloud
```

Your site is now `http://<PUBLIC-IP>` — no port number.

### If you would rather do it by hand

Everything above maps to console actions: create the two policies from `aws/*.json`, make an EC2 role from `app-policy.json`, launch Amazon Linux 2023 t2.micro with that instance profile, open 22 (your IP) and 80, then install Node/nginx/pm2 yourself.

---

## Verifying the deployment

```bash
curl http://<PUBLIC-IP>/api/health
# {"status":"ok","time":"...","dynamo":"aws"}
```

`"dynamo":"aws"` confirms it is not pointing at DynamoDB Local. Then in a browser: pick a city → open a film → play the trailer → pick a showtime → select seats → pay → download the PDF → check your inbox for the ticket and the SNS alert.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `CredentialsProviderError` on EC2 | No instance profile attached. Stop the instance → **Actions → Security → Modify IAM role** |
| `AccessDeniedException` on DynamoDB | Role is missing `CineCloudApp`, or tables are in another region |
| `ResourceNotFoundException` | Tables were created in a different region than `AWS_REGION` |
| Site unreachable | Security group inbound rule missing, or pm2 is not running (`pm2 list`) |
| No ticket email | Sender not verified, or SES sandbox and the recipient is unverified. `pm2 logs` shows the skip reason |
| No SNS alert | Subscription confirmation link never clicked |
| `"dynamo":"http://localhost:8000"` | `DYNAMODB_ENDPOINT` is still set in `.env` |

---

## Costs

Within the AWS Free Tier this runs at effectively zero: t2.micro is 750 hours/month for 12 months, DynamoDB on-demand covers 25 GB and low request volumes, SES is 62,000 outbound messages/month from EC2, SNS 1,000 email notifications.

**Stop the EC2 instance when you are not demoing it** — it is the only component that bills by the hour.

---

## Admin login

No password is stored in this repository — that would make every deployment of
this code trivially compromised.

`setup-tables.js` reads the admin credentials from `.env`:

```ini
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=a-long-password-you-choose
```

If `ADMIN_PASSWORD` is unset, the seed generates a random one and prints it
**once** — save it at that point.

To change it later:

```bash
node set-admin-password.js                        # random, printed once
node set-admin-password.js --password=yourchoice  # pick your own
node set-admin-password.js --email=you@example.com --promote
```

The last form promotes an existing account to admin, which is the cleanest way
to give yourself access using an account you registered on the site normally.
