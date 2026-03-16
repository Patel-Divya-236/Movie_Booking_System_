/**
 * Setup Script — Creates DynamoDB tables and seeds sample movie data
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
  {
    movieId: uuidv4(),
    title: 'Inception',
    genre: 'Sci-Fi',
    duration: '2h 28m',
    price: 250,
    showtimes: ['10:00 AM', '2:00 PM', '6:00 PM', '9:30 PM'],
    posterUrl: 'https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEhniJIyqhtdN.jpg',
    description: 'A thief who steals corporate secrets through dream-sharing technology is given the task of planting an idea into the mind of a C.E.O.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'The Dark Knight',
    genre: 'Action',
    duration: '2h 32m',
    price: 300,
    showtimes: ['11:00 AM', '3:00 PM', '7:00 PM', '10:00 PM'],
    posterUrl: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911BTUgMe1Nqo.jpg',
    description: 'When the menace known as The Joker wreaks havoc on Gotham, Batman must accept one of the greatest tests to fight injustice.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Interstellar',
    genre: 'Sci-Fi',
    duration: '2h 49m',
    price: 280,
    showtimes: ['10:30 AM', '2:30 PM', '6:30 PM'],
    posterUrl: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    description: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Avengers: Endgame',
    genre: 'Action',
    duration: '3h 1m',
    price: 350,
    showtimes: ['11:00 AM', '3:30 PM', '7:30 PM'],
    posterUrl: 'https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9TBWN804Sr.jpg',
    description: 'After the devastating events of Infinity War, the Avengers assemble once more to reverse Thanos\' actions and restore balance.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Oppenheimer',
    genre: 'Drama',
    duration: '3h 0m',
    price: 320,
    showtimes: ['12:00 PM', '4:00 PM', '8:00 PM'],
    posterUrl: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    description: 'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.',
    createdAt: new Date().toISOString(),
  },
  {
    movieId: uuidv4(),
    title: 'Dune: Part Two',
    genre: 'Sci-Fi',
    duration: '2h 46m',
    price: 300,
    showtimes: ['10:00 AM', '1:30 PM', '5:00 PM', '9:00 PM'],
    posterUrl: 'https://image.tmdb.org/t/p/w500/czembW0Rk1Ke7lCJGahbOhdCuhV.jpg',
    description: 'Paul Atreides unites with the Fremen to seek revenge against the conspirators who destroyed his family.',
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
      // Wait for table to become active
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
  console.log('\n🎥 Seeding sample movies...');
  for (const movie of SAMPLE_MOVIES) {
    await docClient.send(new PutCommand({
      TableName: 'MovieBooking_Movies',
      Item: movie,
    }));
    console.log(`   ✅ Added: ${movie.title}`);
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
