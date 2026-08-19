<div align="center">

# 🎬 CineCloud

**A cloud-native movie ticket booking system built end-to-end on AWS**

Browse films pulled live from TMDB, pick seats on an interactive layout with real-time
availability, pay through Razorpay, and get a QR-coded PDF ticket in your inbox — all
running on EC2 with DynamoDB behind it and no long-lived AWS credentials anywhere.

<br>

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)

![AWS EC2](https://img.shields.io/badge/AWS_EC2-FF9900?style=for-the-badge&logo=amazonec2&logoColor=white)
![DynamoDB](https://img.shields.io/badge/DynamoDB-4053D6?style=for-the-badge&logo=amazondynamodb&logoColor=white)
![Amazon SNS](https://img.shields.io/badge/Amazon_SNS-FF4F8B?style=for-the-badge&logo=amazonsns&logoColor=white)
![IAM](https://img.shields.io/badge/AWS_IAM-DD344C?style=for-the-badge&logo=amazoniam&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Razorpay](https://img.shields.io/badge/Razorpay-0C2451?style=for-the-badge&logo=razorpay&logoColor=white)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [AWS Services Used](#aws-services-used)
- [Data Model](#data-model)
- [API Reference](#api-reference)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Security Notes](#security-notes)
- [Project Structure](#project-structure)
- [License](#license)

---

## Overview

CineCloud is a full-stack movie ticket booking platform built as a Cloud Computing
coursework project, and then taken well past the brief. It covers the complete booking
journey — account creation with email verification, catalogue browsing, showtime
selection, seat locking, payment, ticket delivery — and the operational side too: an
admin panel, a support ticket system with threaded replies, and user reviews.

The backend is a Node.js/Express REST API talking to **DynamoDB** through the AWS SDK v3.
On EC2 it authenticates with an **attached IAM role**, so there are no access keys on the
box at all.

---

## Features

### For moviegoers

- 🔐 **JWT authentication** with email verification, password reset and password change
- 🎥 **Live movie catalogue** — real posters and official trailers pulled from the TMDB
  API (films currently in Indian cinemas: Hindi / English / Gujarati), with a static
  fallback list when no API key is set
- 🪑 **Interactive seat selection** with real-time availability and **seat locks**, so two
  people cannot buy the same seat during checkout
- 💳 **Razorpay checkout** with signature verification, plus automatic hold release when
  a payment is abandoned
- 🎟️ **QR-coded PDF tickets** generated with PDFKit and emailed on confirmation
- 📧 **Transactional email** over SMTP (Gmail App Password or any SMTP provider)
- ⭐ **Ratings and reviews** per film
- 🗂️ **Booking history** with self-service cancellation

### For administrators

- 🎬 Full CRUD on movies, theatres and shows, plus bulk **show generation**
- 🎫 **Support desk** — users raise tickets, admins reply in-thread and change status
- 🔔 **Amazon SNS alerts** on every new booking and every new support ticket
- 📊 Health endpoint for uptime monitoring

---

## Architecture

```
                        ┌─────────────────────────┐
                        │      User's Browser     │
                        │   Vanilla JS SPA        │
                        │  (hash router, no fwk)  │
                        └───────────┬─────────────┘
                                    │ HTTPS / REST + JWT
                                    ▼
                     ┌──────────────────────────────┐
                     │      Amazon EC2 Instance     │
                     │  ┌────────────────────────┐  │
                     │  │  Node.js + Express     │  │
                     │  │  • static frontend     │  │
                     │  │  • /api/* REST layer   │  │
                     │  │  • JWT middleware      │  │
                     │  └────────────────────────┘  │
                     └───────────────┬──────────────┘
                                     │ AWS SDK v3
                                     │ (IAM role — no static keys)
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
    ┌───────────────────┐  ┌──────────────────┐  ┌────────────────────┐
    │  Amazon DynamoDB  │  │   Amazon SNS     │  │  External APIs     │
    │  9 tables         │  │  admin alerts    │  │  • TMDB (catalogue)│
    │  PAY_PER_REQUEST  │  │  on booking /    │  │  • Razorpay (pay)  │
    │                   │  │  support ticket  │  │  • SMTP (mail)     │
    └───────────────────┘  └──────────────────┘  └────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JavaScript SPA — hash router, component modules, no framework |
| **Styling** | Handwritten CSS3, responsive |
| **Backend** | Node.js · Express 4 |
| **Database** | Amazon DynamoDB (AWS SDK v3, DocumentClient) |
| **Auth** | JSON Web Tokens · bcryptjs password hashing |
| **Payments** | Razorpay Orders API with server-side signature verification |
| **Tickets** | PDFKit (PDF generation) · qrcode (QR codes) |
| **Email** | Nodemailer over SMTP |
| **Notifications** | Amazon SNS |
| **Infrastructure** | Amazon EC2 · IAM roles · SSM · STS |
| **Catalogue data** | TMDB API |

---

## AWS Services Used

| Service | Role in the system |
|---|---|
| **EC2** | Hosts the Express server, which also serves the static frontend. |
| **DynamoDB** | Primary datastore — 9 tables, on-demand (`PAY_PER_REQUEST`) capacity. |
| **IAM** | An instance role grants the EC2 box scoped access to DynamoDB and SNS, so no access keys are ever stored on the server. |
| **SNS** | Publishes an alert to an admin topic on each new booking and support ticket. |
| **SSM** | Parameter and instance management during provisioning. |
| **STS** | Identity checks in the provisioning scripts. |

Provisioning is scripted — `npm run aws:provision` stands the stack up, and
`aws:start` / `aws:stop` / `aws:status` manage the instance lifecycle to keep it inside
the free tier.

---

## Data Model

Nine DynamoDB tables, all on-demand capacity:

| Table | Holds |
|---|---|
| `MovieBooking_Users` | Accounts, bcrypt password hashes, `user` / `admin` role |
| `MovieBooking_PendingSignups` | Unverified registrations awaiting email confirmation |
| `MovieBooking_Movies` | Catalogue — title, genre, poster, trailer, synopsis |
| `MovieBooking_Theatres` | Venues and their screen configuration |
| `MovieBooking_Shows` | Showtimes linking a movie to a screen, with pricing |
| `MovieBooking_SeatLocks` | Short-lived holds that prevent double-booking at checkout |
| `MovieBooking_Bookings` | Confirmed bookings, seats, payment reference, status |
| `MovieBooking_Reviews` | Per-film user ratings and written reviews |
| `MovieBooking_SupportTickets` | Support threads with admin replies and status |

---

## API Reference

All routes are under `/api`. 🔒 marks JWT-protected routes; 👑 marks admin-only.

<details>
<summary><b>Authentication</b> — <code>/api/auth</code></summary>

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/register` | Create an account (sends a verification email) |
| `POST` | `/check-email` | Check whether an address is already registered |
| `POST` | `/login` | Exchange credentials for a JWT |
| `GET` | `/verify` | Confirm an email address from the link |
| `POST` | `/resend-signup` | Resend the signup verification mail |
| `POST` | `/resend-verification` | Resend verification for an existing account |
| `POST` | `/forgot-password` | Start a password reset |
| `POST` | `/reset-password` | Complete a password reset with the token |
| `POST` | `/change-password` 🔒 | Change password while signed in |
| `GET` | `/me` 🔒 | Current user profile |

</details>

<details>
<summary><b>Catalogue</b> — <code>/api/movies</code>, <code>/api/theatres</code>, <code>/api/shows</code></summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/movies` | List films (search and genre filter) |
| `GET` | `/movies/:id` | Film detail |
| `POST` `PUT` `DELETE` | `/movies/:id` 👑 | Manage the catalogue |
| `GET` | `/theatres`, `/theatres/:id` | Venues |
| `POST` `PUT` `DELETE` | `/theatres/:id` 👑 | Manage venues |
| `GET` | `/shows`, `/shows/:showId` | Showtimes |
| `GET` | `/shows/dates` | Dates that have shows scheduled |
| `POST` | `/shows/generate` 👑 | Bulk-generate a schedule |
| `POST` `DELETE` | `/shows/:showId` 👑 | Manage showtimes |

</details>

<details>
<summary><b>Booking &amp; payments</b> — <code>/api/bookings</code>, <code>/api/payments</code></summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/bookings/seats/:showId` | Live seat availability for a show |
| `POST` | `/bookings` 🔒 | Confirm a booking |
| `GET` | `/bookings` 🔒 | Booking history |
| `GET` | `/bookings/:id` 🔒 | Booking detail |
| `GET` | `/bookings/:id/ticket` 🔒 | Download the QR-coded PDF ticket |
| `DELETE` | `/bookings/:id` 🔒 | Cancel a booking |
| `GET` | `/payments/key` | Public Razorpay key for the checkout widget |
| `POST` | `/payments/order` 🔒 | Create an order and hold the seats |
| `POST` | `/payments/verify` 🔒 | Verify the payment signature |
| `POST` | `/payments/release` 🔒 | Release seat holds on abandonment |

</details>

<details>
<summary><b>Reviews &amp; support</b> — <code>/api/reviews</code>, <code>/api/support</code></summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/reviews/:movieId` | Reviews for a film |
| `POST` | `/reviews/:movieId` 🔒 | Leave a rating and review |
| `POST` | `/support` | Raise a support ticket |
| `GET` | `/support`, `/support/:id` 🔒 | List / read tickets |
| `POST` | `/support/:id/reply` 🔒 | Reply in-thread |
| `PATCH` | `/support/:id` 👑 | Change ticket status |

</details>

Plus `GET /api/config` for runtime frontend configuration and `GET /api/health` for
uptime checks.

---

## Getting Started

### Prerequisites

- **Node.js 18+**
- An **AWS account** (free tier is enough), or
  [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)
  for offline development
- Optional: a [TMDB API key](https://www.themoviedb.org/settings/api) for the live
  catalogue, and Razorpay test keys for checkout

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Patel-Divya-236/Movie_Booking_System_.git
cd Movie_Booking_System_/movie-booking-system

# 2. Install dependencies
npm install

# 3. Configure the environment
cp .env.example .env
#    then edit .env — JWT_SECRET is required and the server refuses to start without it

# 4. Create the DynamoDB tables and seed the catalogue
npm run setup

# 5. Start the server
npm start
```

Open **http://localhost:3000**.

The seed script creates an admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Leave
`ADMIN_PASSWORD` blank and it generates a strong one and prints it **once** — copy it
then.

### npm scripts

| Script | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run setup` | Create DynamoDB tables and seed data |
| `npm run aws:setup` | Create the IAM roles and policies |
| `npm run aws:provision` | Provision the EC2 instance and deploy |
| `npm run aws:status` | Check instance state |
| `npm run aws:start` / `aws:stop` | Start / stop the instance |

---

## Configuration

Everything is environment-driven; see [`.env.example`](movie-booking-system/.env.example)
for the annotated full list.

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | **Yes** | Token signing key — the server exits if unset |
| `PORT` | No | Defaults to `3000` |
| `AWS_REGION` | No | Defaults to `ap-south-1` |
| `DYNAMODB_ENDPOINT` | No | Point at DynamoDB Local; **leave unset in production** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | No | Seeded admin account |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | No | Gmail SMTP (needs an App Password, not the account password) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | No | Any other SMTP provider; takes precedence over Gmail |
| `APP_BASE_URL` | No | Base for links inside emails |
| `TMDB_API_KEY` | No | Live catalogue; falls back to a static list without it |
| `SNS_BOOKING_TOPIC_ARN` | No | SNS topic for admin alerts |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS allowlist; permissive if unset |

> Email is entirely optional — leave the mail variables blank and bookings still work,
> just without confirmation mail.

---

## Deployment

Two documented paths:

- **[EC2_SETUP.md](movie-booking-system/EC2_SETUP.md)** — single-instance deployment,
  where the Express server serves both the API and the frontend.
- **[VERCEL_SETUP.md](movie-booking-system/VERCEL_SETUP.md)** — split deployment, with the
  static frontend on Vercel and the API on EC2. Set `ALLOWED_ORIGINS` to the Vercel
  domain so CORS permits it.

---

## Security Notes

A few decisions worth calling out, since they are the interesting part of the build:

- **No static AWS credentials in production.** The EC2 instance uses an attached IAM role;
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are only ever used for local development.
- **Fail-fast on missing secrets.** The server refuses to boot without `JWT_SECRET`
  rather than silently signing tokens with a default.
- **CORS refuses by omission, not by throwing.** A disallowed origin gets no
  `Access-Control-Allow-Origin` header — which is what the browser expects — instead of a
  500 that would look like a server fault.
- **Payment signatures are verified server-side.** A client claiming a payment succeeded
  is not enough.
- **Passwords are bcrypt-hashed**; tokens travel in the `Authorization` header rather
  than a cookie, so cross-origin requests never need credentials.
- **`.gitignore` covers `.env.*` and `*.bak`, not just `.env`** — a backup like `.env.bak`
  holds exactly the same live secrets. Private keys (`*.pem`) and local working notes are
  excluded too.

---

## Project Structure

```
movie-booking-system/
├── server.js                 # Express entry point, CORS, route mounting
├── db.js                     # DynamoDB DocumentClient + paginated query helper
├── setup-tables.js           # Table creation and seeding
├── config/
│   ├── catalog.js            # TMDB catalogue fetching
│   ├── pricing.js            # Ticket pricing rules
│   ├── seatLayouts.js        # Screen seat maps
│   ├── seedData.js           # Static fallback catalogue
│   └── validation.js         # Shared input validation
├── middleware/
│   └── auth.js               # JWT verification, admin guard
├── routes/                   # auth, movies, theatres, shows, bookings,
│                             # payments, reviews, support, config
├── services/
│   ├── mailer.js             # Nodemailer SMTP transport
│   ├── emailCheck.js         # Address validation
│   ├── notify.js             # Amazon SNS alerts
│   ├── payments.js           # Razorpay orders and verification
│   ├── ticket.js             # PDF ticket + QR generation
│   └── tmdb.js               # TMDB client
├── aws/                      # IAM policy documents
├── aws-setup.js              # IAM role and policy provisioning
├── aws-deploy.js             # EC2 provision / start / stop / status
└── public/                   # Vanilla JS SPA
    ├── index.html
    ├── css/style.css
    └── js/                   # api, router, state, dom, validation,
                              # components/, views/
```

---

## License

Released under the [MIT License](LICENSE).

<div align="center">
<br>

Built by [**Patel-Divya-236**](https://github.com/Patel-Divya-236)

⭐ Star this repo if you find it useful

</div>
