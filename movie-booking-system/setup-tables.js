/**
 * Setup Script — Creates DynamoDB tables and seeds movie data
 * Run this ONCE on EC2: node setup-tables.js
 */
require('dotenv').config();
const { client } = require('./db');
const { docClient } = require('./db');
const { CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const TABLES = [
  {
    TableName: 'MovieBooking_Users',
    KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'MovieBooking_Movies',
    KeySchema: [{ AttributeName: 'movieId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'movieId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'MovieBooking_Bookings',
    KeySchema: [{ AttributeName: 'bookingId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'bookingId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

const SAMPLE_MOVIES = [
  // ========= BOLLYWOOD =========
  {
    movieId: uuidv4(),
    title: 'Dhurandhar',
    genre: 'Comedy',
    language: 'Hindi',
    duration: '2h 15m',
    price: { normal: 200, sofa: 350, recliner: 500 },
    showtimes: ['9:00 AM', '11:30 AM', '2:00 PM', '4:30 PM', '6:45 PM', '9:15 PM', '11:00 PM'],
    screen: 'Screen 1 — IMAX',
    posterUrl: 'https://assets-in.bmscdn.com/iedb/movies/images/mobile/thumbnail/xlarge/dhurandhar-et00416954-1736843741.jpg',
    description: 'A hilarious comedy about a con artist who gets caught up in a web of lies and deception.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Kerala Story',
    genre: 'Drama',
    language: 'Hindi',
    duration: '2h 18m',
    price: { normal: 180, sofa: 300, recliner: 450 },
    showtimes: ['9:30 AM', '12:00 PM', '2:30 PM', '5:00 PM', '7:30 PM', '9:45 PM', '11:30 PM'],
    screen: 'Screen 2 — Dolby Atmos',
    posterUrl: 'https://assets-in.bmscdn.com/iedb/movies/images/mobile/thumbnail/xlarge/the-kerala-story-et00352783-168326793.jpg',
    description: 'A gripping drama based on true events that shook the nation.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Pathaan',
    genre: 'Action',
    language: 'Hindi',
    duration: '2h 26m',
    price: { normal: 250, sofa: 400, recliner: 600 },
    showtimes: ['10:00 AM', '12:30 PM', '3:00 PM', '5:30 PM', '7:00 PM', '9:30 PM', '11:45 PM'],
    screen: 'Screen 1 — IMAX',
    posterUrl: 'https://assets-in.bmscdn.com/iedb/movies/images/mobile/thumbnail/xlarge/pathaan-et00323848-1674727562.jpg',
    description: 'An Indian spy takes on the leader of a group of mercenaries who have planned a deadly attack on India.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Jawan',
    genre: 'Action',
    language: 'Hindi',
    duration: '2h 49m',
    price: { normal: 250, sofa: 400, recliner: 600 },
    showtimes: ['9:00 AM', '12:00 PM', '3:00 PM', '5:00 PM', '7:00 PM', '9:30 PM', '11:30 PM'],
    screen: 'Screen 3 — 4DX',
    posterUrl: 'https://assets-in.bmscdn.com/iedb/movies/images/mobile/thumbnail/xlarge/jawan-et00326336-1693544626.jpg',
    description: 'A man is driven by a personal vendetta to rectify the wrongs in society.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Animal',
    genre: 'Action',
    language: 'Hindi',
    duration: '3h 21m',
    price: { normal: 280, sofa: 420, recliner: 650 },
    showtimes: ['10:00 AM', '1:30 PM', '4:00 PM', '6:30 PM', '9:00 PM', '11:00 PM'],
    screen: 'Screen 2 — Dolby Atmos',
    posterUrl: 'https://assets-in.bmscdn.com/iedb/movies/images/mobile/thumbnail/xlarge/animal-et00303306-1701185498.jpg',
    description: 'A son undergoes a transformation when his father\'s life is threatened.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Stree 2',
    genre: 'Horror Comedy',
    language: 'Hindi',
    duration: '2h 30m',
    price: { normal: 220, sofa: 370, recliner: 550 },
    showtimes: ['9:30 AM', '12:00 PM', '2:30 PM', '5:00 PM', '7:15 PM', '9:30 PM', '11:45 PM'],
    screen: 'Screen 4 — Standard',
    posterUrl: 'https://assets-in.bmscdn.com/iedb/movies/images/mobile/thumbnail/xlarge/stree-2-et00364850-1723187498.jpg',
    description: 'The town of Chanderi is under threat once again as a new evil entity terrorizes the residents.',
    createdAt: new Date().toISOString(),
  },
  // ========= HOLLYWOOD =========
  {
    movieId: uuidv4(),
    title: 'Oppenheimer',
    genre: 'Drama',
    language: 'English',
    duration: '3h 0m',
    price: { normal: 300, sofa: 450, recliner: 700 },
    showtimes: ['10:00 AM', '1:00 PM', '4:00 PM', '6:00 PM', '8:00 PM', '10:30 PM', '11:30 PM'],
    screen: 'Screen 1 — IMAX',
    posterUrl: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    description: 'The story of J. Robert Oppenheimer and his role in the development of the atomic bomb.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Dune: Part Two',
    genre: 'Sci-Fi',
    language: 'English',
    duration: '2h 46m',
    price: { normal: 300, sofa: 450, recliner: 700 },
    showtimes: ['9:00 AM', '11:30 AM', '2:00 PM', '4:30 PM', '7:00 PM', '9:30 PM', '11:45 PM'],
    screen: 'Screen 1 — IMAX',
    posterUrl: 'https://image.tmdb.org/t/p/w500/czembW0Rk1Ke7lCJGahbOhdCuhV.jpg',
    description: 'Paul Atreides unites with the Fremen to seek revenge against the conspirators who destroyed his family.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Deadpool & Wolverine',
    genre: 'Action',
    language: 'English',
    duration: '2h 8m',
    price: { normal: 280, sofa: 420, recliner: 650 },
    showtimes: ['9:30 AM', '12:00 PM', '2:30 PM', '5:00 PM', '7:30 PM', '9:45 PM', '11:30 PM'],
    screen: 'Screen 3 — 4DX',
    posterUrl: 'https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    description: 'Deadpool is offered a place in the Marvel Cinematic Universe by the TVA, but instead recruits Wolverine.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Inside Out 2',
    genre: 'Animation',
    language: 'English',
    duration: '1h 36m',
    price: { normal: 200, sofa: 320, recliner: 480 },
    showtimes: ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM', '7:00 PM', '9:00 PM'],
    screen: 'Screen 4 — Standard',
    posterUrl: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
    description: 'Riley enters puberty and a new set of emotions take over — Anxiety, Envy, Ennui, and Embarrassment.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'The Dark Knight',
    genre: 'Action',
    language: 'English',
    duration: '2h 32m',
    price: { normal: 250, sofa: 380, recliner: 550 },
    showtimes: ['10:00 AM', '12:30 PM', '3:00 PM', '5:30 PM', '7:45 PM', '10:00 PM', '11:30 PM'],
    screen: 'Screen 2 — Dolby Atmos',
    posterUrl: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911BTUgMe1Nqo.jpg',
    description: 'When the menace known as The Joker wreaks havoc on Gotham, Batman must fight injustice.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Interstellar',
    genre: 'Sci-Fi',
    language: 'English',
    duration: '2h 49m',
    price: { normal: 280, sofa: 400, recliner: 600 },
    showtimes: ['9:30 AM', '12:30 PM', '3:30 PM', '5:30 PM', '7:30 PM', '10:00 PM', '11:45 PM'],
    screen: 'Screen 1 — IMAX',
    posterUrl: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    description: 'Explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.',
    createdAt: new Date().toISOString(),
  },
];

async function tableExists(tableName) {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return false;
    throw err;
  }
}

async function setup() {
  console.log('🎬 Movie Booking System — Table Setup\n');

  // Create tables
  for (const table of TABLES) {
    const exists = await tableExists(table.TableName);
    if (exists) {
      console.log(`✅ Table "${table.TableName}" already exists`);
    } else {
      console.log(`📦 Creating table "${table.TableName}"...`);
      await client.send(new CreateTableCommand(table));
      let active = false;
      while (!active) {
        await new Promise(r => setTimeout(r, 2000));
        const desc = await client.send(new DescribeTableCommand({ TableName: table.TableName }));
        active = desc.Table.TableStatus === 'ACTIVE';
        if (!active) process.stdout.write('.');
      }
      console.log(`   ✅ Created!`);
    }
  }

  // Seed movies
  console.log('\n🎥 Seeding movies (12 Bollywood + Hollywood)...');
  for (const movie of SAMPLE_MOVIES) {
    await docClient.send(new PutCommand({
      TableName: 'MovieBooking_Movies',
      Item: movie,
    }));
    console.log(`   ✅ Added: ${movie.title} (${movie.language}) — ${movie.screen}`);
  }

  // Create default admin user
  console.log('\n👤 Creating admin user...');
  const adminPassword = await bcrypt.hash('admin123', 10);
  await docClient.send(new PutCommand({
    TableName: 'MovieBooking_Users',
    Item: {
      userId: uuidv4(),
      name: 'Admin',
      email: 'admin@moviebooking.com',
      password: adminPassword,
      role: 'admin',
      createdAt: new Date().toISOString(),
    },
  }));
  console.log('   ✅ Admin user created (email: admin@moviebooking.com, password: admin123)');

  console.log('\n🎉 Setup complete! Run: node server.js');
}

setup().catch(err => {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
});
