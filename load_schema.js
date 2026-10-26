// Loads cloud_setup.sql into the database named in your .env (run once, from the project folder):
//   node load_schema.js
// Works with any MySQL host (for example Aiven). No MySQL client needed.
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

(async () => {
  const need = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME'];
  const missing = need.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('Missing in .env: ' + missing.join(', '));
    process.exit(1);
  }
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL == 'true' ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true
  });
  const [existing] = await db.query("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='users'");
  if (existing[0].n > 0) {
    console.log('Tables already exist in ' + process.env.DB_NAME + '. Nothing changed.');
    process.exit(0);
  }
  await db.query(fs.readFileSync('cloud_setup.sql', 'utf8'));
  console.log('Schema loaded into ' + process.env.DB_NAME + '. Next: node seed_timetable.js');
  process.exit(0);
})().catch(e => { console.error('Failed: ' + e.message); process.exit(1); });