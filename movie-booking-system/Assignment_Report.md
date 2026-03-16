# Cloud-Based Movie Ticket Booking System — Assignment Report

## 1. Introduction

The **Cloud-Based Movie Ticket Booking System (CineCloud)** is a web application that enables users to browse movies, select seats interactively, and book tickets online. The system is built entirely using **AWS cloud services**, demonstrating the practical application of cloud computing concepts including compute, storage, and communication services.

### 1.1 Objective
- Build a fully functional movie ticket booking system deployed on AWS
- Demonstrate usage of core AWS services: EC2, DynamoDB, SES/SNS
- Implement user authentication, real-time seat availability, and booking management

### 1.2 Scope
- User registration and authentication (JWT-based)
- Movie catalog with search and genre filtering
- Interactive seat selection with real-time availability
- Booking history and admin panel
- Email notification on booking confirmation (SES)

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     User's Browser                       │
│              (Opens http://<EC2-IP>:3000)                │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP Requests
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  Amazon EC2 Instance                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │            Node.js + Express Server               │  │
│  │  ┌──────────────┐  ┌──────────────────────────┐  │  │
│  │  │  Static File  │  │     REST API Layer       │  │  │
│  │  │   Serving     │  │  /api/auth/*             │  │  │
│  │  │ (Frontend UI) │  │  /api/movies/*           │  │  │
│  │  │               │  │  /api/bookings/*         │  │  │
│  │  └──────────────┘  └────────────┬─────────────┘  │  │
│  └─────────────────────────────────┼─────────────────┘  │
│                                    │                     │
│                    AWS SDK v3 (IAM Role Auth)            │
└────────────────────────────────────┼─────────────────────┘
                                     │
          ┌──────────────────────────┼──────────────┐
          │                          │              │
          ▼                          ▼              ▼
┌─────────────────┐   ┌──────────────────┐  ┌────────────┐
│ Amazon DynamoDB  │   │   Amazon SES     │  │ Amazon SNS │
│                  │   │   (Email)        │  │ (optional) │
│ - Users table    │   │                  │  │            │
│ - Movies table   │   │ Booking          │  │            │
│ - Bookings table │   │ Confirmations    │  │            │
└─────────────────┘   └──────────────────┘  └────────────┘
```

---

## 3. AWS Services Used

| Service | Purpose |
|---------|---------|
| **Amazon EC2** | Hosts the Node.js backend server AND serves the frontend. Single instance runs the entire application. |
| **Amazon DynamoDB** | NoSQL database storing Users, Movies, and Bookings data. Uses on-demand capacity (PAY_PER_REQUEST). |
| **Amazon SES** | Sends booking confirmation emails to users (optional, non-blocking). |
| **Amazon SNS** | Can be used for SMS/push notifications (optional extension). |
| **IAM Role** | EC2 instance uses an IAM role for secure, credential-less access to DynamoDB and SES. |

---

## 4. DynamoDB Table Design

### 4.1 MovieBooking_Users
| Attribute | Type | Description |
|-----------|------|-------------|
| userId (PK) | String (UUID) | Unique user identifier |
| name | String | User's full name |
| email | String | Login email (unique) |
| password | String | Bcrypt-hashed password |
| role | String | "user" or "admin" |
| createdAt | String (ISO) | Registration timestamp |

### 4.2 MovieBooking_Movies
| Attribute | Type | Description |
|-----------|------|-------------|
| movieId (PK) | String (UUID) | Unique movie identifier |
| title | String | Movie title |
| genre | String | Genre category |
| duration | String | Runtime (e.g., "2h 30m") |
| price | Number | Ticket price per seat (₹) |
| showtimes | List<String> | Available show times |
| posterUrl | String | URL to poster image |
| description | String | Brief movie description |

### 4.3 MovieBooking_Bookings
| Attribute | Type | Description |
|-----------|------|-------------|
| bookingId (PK) | String (UUID) | Unique booking identifier |
| userId | String | Reference to user |
| movieId | String | Reference to movie |
| movieTitle | String | Denormalized movie title |
| showtime | String | Selected showtime |
| seats | List<String> | Booked seat IDs (e.g., ["A1","A2"]) |
| totalPrice | Number | Total amount paid |
| status | String | "confirmed" |
| bookedAt | String (ISO) | Booking timestamp |

---

## 5. API Documentation

### Authentication
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/auth/register | Register new user | No |
| POST | /api/auth/login | Login, get JWT | No |

### Movies
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /api/movies | List all movies | No |
| POST | /api/movies | Add new movie | Admin |
| DELETE | /api/movies/:id | Delete movie | Admin |

### Bookings
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/bookings | Create booking | User |
| GET | /api/bookings | Get user's bookings | User |
| GET | /api/bookings/seats/:movieId/:showtime | Get booked seats | No |

---

## 6. Features

1. **User Authentication**: JWT-based registration and login with bcrypt password hashing
2. **Movie Catalog**: Browse movies with search by title and genre-based filtering
3. **Interactive Seat Selection**: 8×10 visual seat grid showing real-time availability
4. **Double-Booking Prevention**: Server-side validation prevents same seat from being booked twice
5. **Booking History**: Users can view their past bookings in a ticket-card format
6. **Admin Panel**: Add/delete movies, view booking statistics and revenue
7. **Email Notifications**: Booking confirmation via Amazon SES (when configured)
8. **Responsive Design**: Works on desktop and mobile devices

---

## 7. Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JavaScript (SPA) |
| Backend | Node.js, Express.js |
| Database | Amazon DynamoDB (NoSQL) |
| Auth | JWT (jsonwebtoken), bcryptjs |
| AWS SDK | @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, @aws-sdk/client-ses |
| Deployment | Amazon EC2 |

---

## 8. Data Flow Diagram

```
User Registration:
  Browser → POST /api/auth/register → Express → bcrypt hash → DynamoDB(Users)

User Login:
  Browser → POST /api/auth/login → Express → bcrypt verify → JWT token → Browser

Browse Movies:
  Browser → GET /api/movies → Express → DynamoDB(Movies) → JSON response → Browser renders cards

Book Tickets:
  Browser → GET /api/bookings/seats/:id/:time → Shows available seats
  Browser → POST /api/bookings → Express validates (no double-book) → DynamoDB(Bookings) → SES email → Success response
```

---

## 9. How to Deploy

See `EC2_SETUP.md` for detailed step-by-step deployment instructions.

**Quick Summary:**
1. Launch EC2 instance with IAM role (DynamoDB access)
2. SSH into EC2, install Node.js
3. Upload project files
4. Run `npm install`
5. Run `node setup-tables.js` (creates tables + seeds data)
6. Run `node server.js`
7. Open `http://<EC2-IP>:3000` in browser

---

## 10. Security Considerations

- Passwords hashed with **bcrypt** (10 salt rounds)
- JWT tokens expire after **24 hours**
- EC2 uses **IAM Role** — no AWS credentials stored in code
- Security Group restricts access to ports **22** (SSH) and **3000** (App)
- Input validation on all API endpoints

---

## 11. Screenshots

*[Insert screenshots after deploying on EC2]*
- Login Page
- Movie Catalog
- Seat Selection Grid
- Booking Confirmation
- Booking History
- Admin Panel

---

## 12. Future Enhancements

- Payment gateway integration (Razorpay/Stripe)
- Movie ratings and reviews
- Multiple theaters/screens support
- Show date selection (calendar)
- QR code ticket generation
- Auto-scaling with EC2 Auto Scaling Groups
- CloudFront CDN for static assets

---

## 13. Challenges Faced

1. **AWS Academy Limitations**: Local machines cannot access AWS services; solution was to run everything on EC2
2. **DynamoDB Scan Performance**: Used scan with filter expressions for simplicity; could be optimized with GSIs for production
3. **SES Sandbox**: SES requires email verification in sandbox mode; implemented as non-blocking (booking succeeds even without email)

---

## 14. Conclusion

The CineCloud Movie Ticket Booking System successfully demonstrates the use of AWS cloud services for building a complete web application. By leveraging EC2 for compute, DynamoDB for storage, and SES for notifications, the system showcases key cloud computing concepts including scalability, pay-per-use pricing, managed services, and IAM-based security. The single-server architecture makes deployment simple while still utilizing multiple AWS services effectively.
