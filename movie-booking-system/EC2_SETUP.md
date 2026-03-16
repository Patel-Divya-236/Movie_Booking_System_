# 🚀 EC2 Deployment Guide — CineCloud Movie Booking System

## Prerequisites
- An AWS Academy Learner Lab (or any) account with EC2 access
- An EC2 instance running **Amazon Linux 2** or **Ubuntu**
- An **IAM Role** attached to the EC2 instance with permissions for:
  - `DynamoDB` (Full Access or at minimum: CreateTable, PutItem, Scan, DeleteItem, DescribeTable)
  - `SES` (optional, for email notifications)

---

## Step-by-Step Deployment

### 1. Launch EC2 Instance
1. Go to AWS Console → EC2 → **Launch Instance**
2. Choose **Amazon Linux 2023** AMI (free tier eligible)
3. Instance type: **t2.micro** (free tier)
4. Key pair: Create or select one (you can also use EC2 Instance Connect)
5. Security Group: Allow inbound:
   - **SSH (22)** — for terminal access
   - **Custom TCP (3000)** — for the web app
6. Under **Advanced Details → IAM instance profile**: Attach the role created by your lab (usually `LabInstanceProfile` or similar)
7. Launch!

### 2. Connect to EC2
- Use **EC2 Instance Connect** (browser-based SSH) from the AWS Console
- Or SSH: `ssh -i your-key.pem ec2-user@<PUBLIC-IP>`

### 3. Install Node.js
```bash
# Amazon Linux 2023
sudo yum install -y nodejs npm git

# OR Ubuntu
# sudo apt update && sudo apt install -y nodejs npm git
```

### 4. Upload the Project

**Option A — Git Clone** (if you push to GitHub):
```bash
git clone https://github.com/YOUR_USERNAME/movie-booking-system.git
cd movie-booking-system
```

**Option B — SCP from local** (upload the folder):
```bash
# Run this from YOUR LOCAL PC (not EC2)
scp -i your-key.pem -r ./movie-booking-system ec2-user@<PUBLIC-IP>:~/
```

**Option C — Copy-paste files** via EC2 Instance Connect terminal (manually create files using `nano` or `vi`).

### 5. Install Dependencies
```bash
cd movie-booking-system
npm install
```

### 6. Configure Environment
```bash
cp .env.example .env
# Edit if needed: nano .env
# The defaults should work — just make sure AWS_REGION matches your EC2 region
```

### 7. Create DynamoDB Tables & Seed Data
```bash
node setup-tables.js
```
This creates 3 tables (`MovieBooking_Users`, `MovieBooking_Movies`, `MovieBooking_Bookings`), seeds 6 sample movies, and creates an admin user.

### 8. Start the Server
```bash
node server.js
```
You should see:
```
🎬 Movie Booking System running at http://localhost:3000
```

### 9. Access the App!
Open your browser and go to:
```
http://<YOUR-EC2-PUBLIC-IP>:3000
```

---

## Default Credentials

| Role  | Email                   | Password |
|-------|-------------------------|----------|
| Admin | admin@moviebooking.com  | admin123 |

Regular users can register through the Sign Up page.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't connect on port 3000 | Check Security Group allows inbound TCP 3000 |
| DynamoDB permission denied | Ensure EC2 has IAM role with DynamoDB access |
| `npm install` fails | Run `sudo yum install nodejs npm` first |
| Server crashes on start | Check `.env` file exists with correct values |
| TMDB poster images not loading | These are external URLs; they work if EC2 has internet |

---

## Run in Background (optional)
To keep the server running after closing the terminal:
```bash
nohup node server.js > app.log 2>&1 &
```
Or install PM2:
```bash
sudo npm install -g pm2
pm2 start server.js --name cinecloud
pm2 save
```
