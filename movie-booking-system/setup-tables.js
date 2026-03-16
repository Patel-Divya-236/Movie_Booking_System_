/**
 * Setup Script — Creates DynamoDB tables and seeds movie data
 * Run this ONCE on EC2: node setup-tables.js
 */
require('dotenv').config();
const { client } = require('./db');
const { docClient } = require('./db');
const { CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
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

// Screen types determine seat layout:
// "IMAX" / "Dolby Atmos" / "4DX" / "Standard" = Normal (front) + Recliner (back)
// "Luxe" = All seats are premium sofa seats
const SAMPLE_MOVIES = [
  // ========= BOLLYWOOD =========
  {
    movieId: uuidv4(),
    title: 'Dhurandhar',
    genre: 'Comedy',
    language: 'Hindi',
    duration: '2h 15m',
    price: { normal: 200, recliner: 500, sofa: 400 },
    showtimes: ['9:00 AM', '11:30 AM', '2:00 PM', '4:30 PM', '6:45 PM', '9:15 PM', '11:00 PM'],
    screen: 'Screen 1 — IMAX',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BOTk1MjBjODEtNjFiMS00YWU5LWI3ZmYtYzQ0NzdjN2YxNGY1XkEyXkFqcGc@._V1_.jpg',
    description: 'A hilarious comedy about a con artist who gets caught up in a web of lies and deception.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'The Kerala Story',
    genre: 'Drama',
    language: 'Hindi',
    duration: '2h 18m',
    price: { normal: 180, recliner: 450, sofa: 380 },
    showtimes: ['9:30 AM', '12:00 PM', '2:30 PM', '5:00 PM', '7:30 PM', '9:45 PM', '11:30 PM'],
    screen: 'Screen 2 — Dolby Atmos',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BZDVkMGE5ZDMtNDg4NS00NjNkLTgxMTMtOGZlNmE3NjIyMTllXkEyXkFqcGc@._V1_.jpg',
    description: 'A gripping drama based on true events that shook the nation.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Pathaan',
    genre: 'Action',
    language: 'Hindi',
    duration: '2h 26m',
    price: { normal: 250, recliner: 600, sofa: 500 },
    showtimes: ['10:00 AM', '12:30 PM', '3:00 PM', '5:30 PM', '7:00 PM', '9:30 PM', '11:45 PM'],
    screen: 'Screen 1 — IMAX',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BZmYxMGFhNDYtNjc4OC00ZGFhLTkwNmItMjE5YmZhYzUwODNlXkEyXkFqcGc@._V1_.jpg',
    description: 'An Indian spy takes on the leader of a group of mercenaries who have planned a deadly attack on India.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Jawan',
    genre: 'Action',
    language: 'Hindi',
    duration: '2h 49m',
    price: { normal: 250, recliner: 600, sofa: 500 },
    showtimes: ['9:00 AM', '12:00 PM', '3:00 PM', '5:00 PM', '7:00 PM', '9:30 PM', '11:30 PM'],
    screen: 'Screen 3 — 4DX',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BMmMzOWRhNTQtMTdlNC00NjVlLWFhYjAtZjIxZTlhNzBhNjg2XkEyXkFqcGc@._V1_.jpg',
    description: 'A man is driven by a personal vendetta to rectify the wrongs in society.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Animal',
    genre: 'Action',
    language: 'Hindi',
    duration: '3h 21m',
    price: { normal: 280, recliner: 650, sofa: 520 },
    showtimes: ['10:00 AM', '1:30 PM', '4:00 PM', '6:30 PM', '9:00 PM', '11:00 PM'],
    screen: 'Screen 2 — Dolby Atmos',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BNGViZGI1MjUtMGRlNi00ZjliLWIzOTEtM2I3OGMxODYzYjc2XkEyXkFqcGc@._V1_.jpg',
    description: 'A son undergoes a transformation when his father\'s life is threatened.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Stree 2',
    genre: 'Horror Comedy',
    language: 'Hindi',
    duration: '2h 30m',
    price: { sofa: 600 },
    showtimes: ['9:30 AM', '12:00 PM', '2:30 PM', '5:00 PM', '7:15 PM', '9:30 PM', '11:45 PM'],
    screen: 'Screen 5 — PVR Luxe',
    screenType: 'luxe',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BMmIxYTRiNDItNzg1MC00MDk3LThjMTMtNjNhMjg1YjJjNGRlXkEyXkFqcGc@._V1_.jpg',
    description: 'The town of Chanderi is under threat once again. All seats are premium sofa in Luxe format.',
    createdAt: new Date().toISOString(),
  },
  // ========= HOLLYWOOD =========
  {
    movieId: uuidv4(),
    title: 'Oppenheimer',
    genre: 'Drama',
    language: 'English',
    duration: '3h 0m',
    price: { normal: 300, recliner: 700, sofa: 550 },
    showtimes: ['10:00 AM', '1:00 PM', '4:00 PM', '6:00 PM', '8:00 PM', '10:30 PM', '11:30 PM'],
    screen: 'Screen 1 — IMAX',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BMDBmYTZjNjUtN2M1MS00MTQ2LTk2ODgtNzc2M2QyZGE5NTVjXkEyXkFqcGc@._V1_.jpg',
    description: 'The story of J. Robert Oppenheimer and his role in the development of the atomic bomb.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Dune: Part Two',
    genre: 'Sci-Fi',
    language: 'English',
    duration: '2h 46m',
    price: { normal: 300, recliner: 700, sofa: 550 },
    showtimes: ['9:00 AM', '11:30 AM', '2:00 PM', '4:30 PM', '7:00 PM', '9:30 PM', '11:45 PM'],
    screen: 'Screen 1 — IMAX',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BNTc0YmQxN2UtODAxMC00NjI1LWFmMjAtNTEyYzBhZjYyZTM5XkEyXkFqcGc@._V1_.jpg',
    description: 'Paul Atreides unites with the Fremen to seek revenge against the conspirators.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Deadpool & Wolverine',
    genre: 'Action',
    language: 'English',
    duration: '2h 8m',
    price: { normal: 280, recliner: 650, sofa: 500 },
    showtimes: ['9:30 AM', '12:00 PM', '2:30 PM', '5:00 PM', '7:30 PM', '9:45 PM', '11:30 PM'],
    screen: 'Screen 3 — 4DX',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BZTk5ODY0MmQtMzA3Ni00NGkzLWIzN2UtYWU4ZTRkNjRkNDkzXkEyXkFqcGc@._V1_.jpg',
    description: 'Deadpool is offered a place in the MCU by the TVA, but instead recruits Wolverine.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Inside Out 2',
    genre: 'Animation',
    language: 'English',
    duration: '1h 36m',
    price: { sofa: 480 },
    showtimes: ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM', '7:00 PM', '9:00 PM'],
    screen: 'Screen 6 — PVR Luxe',
    screenType: 'luxe',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BYTc1MDQ3NjAtOWEzMi00YzE1LWI0OTItYmRhMjlkYjk4ZjM5XkEyXkFqcGc@._V1_.jpg',
    description: 'Riley enters puberty and a new set of emotions take over. Luxe sofa seating.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'The Dark Knight',
    genre: 'Action',
    language: 'English',
    duration: '2h 32m',
    price: { normal: 250, recliner: 550, sofa: 450 },
    showtimes: ['10:00 AM', '12:30 PM', '3:00 PM', '5:30 PM', '7:45 PM', '10:00 PM', '11:30 PM'],
    screen: 'Screen 2 — Dolby Atmos',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_.jpg',
    description: 'When the menace known as The Joker wreaks havoc on Gotham, Batman must fight injustice.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Interstellar',
    genre: 'Sci-Fi',
    language: 'English',
    duration: '2h 49m',
    price: { normal: 280, recliner: 600, sofa: 480 },
    showtimes: ['9:30 AM', '12:30 PM', '3:30 PM', '5:30 PM', '7:30 PM', '10:00 PM', '11:45 PM'],
    screen: 'Screen 1 — IMAX',
    screenType: 'standard',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_.jpg',
    description: 'Explorers travel through a wormhole in space to ensure humanity\'s survival.',
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

async function clearTable(tableName, keyName) {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: tableName }));
    if (result.Items) {
      for (const item of result.Items) {
        await docClient.send(new DeleteCommand({ TableName: tableName, Key: { [keyName]: item[keyName] } }));
      }
    }
  } catch (err) {
    // Ignore errors during cleanup
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

  // Clear and re-seed movies
  console.log('\n🧹 Clearing old movie data...');
  await clearTable('MovieBooking_Movies', 'movieId');

  console.log('🎥 Seeding movies (12 Bollywood + Hollywood)...');
  for (const movie of SAMPLE_MOVIES) {
    await docClient.send(new PutCommand({
      TableName: 'MovieBooking_Movies',
      Item: movie,
    }));
    const luxeLabel = movie.screenType === 'luxe' ? ' [LUXE - All Sofa]' : '';
    console.log(`   ✅ Added: ${movie.title} (${movie.language}) — ${movie.screen}${luxeLabel}`);
  }

  // Create default admin user (skip if exists)
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
