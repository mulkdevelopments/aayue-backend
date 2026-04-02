require('dotenv').config();
const { Pool } = require('pg');
const migrationFiles = require('./migrationFiles');

// PostgreSQL connection config
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migrations...');
        for (let i = 0; i < migrationFiles.length; i++) {
            const sql = migrationFiles[i];
            console.log(`Running migration ${i + 1}/${migrationFiles.length}...`);
            await client.query(sql);
        }
        console.log('All migrations executed successfully!');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        client.release();
        pool.end();
    }
}

// Execute migration
if (require.main === module) {
    migrate();
}

module.exports = migrate;
