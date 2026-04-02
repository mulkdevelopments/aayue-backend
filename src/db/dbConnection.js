require('dotenv').config();
const { Pool } = require('pg');
console.log('🔌 Setting up database connection pool...', process.env.DB_USER, process.env.DB_HOST, process.env.DB_NAME, process.env.DB_PASSWORD, process.env.DB_PORT);
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

module.exports = pool;
