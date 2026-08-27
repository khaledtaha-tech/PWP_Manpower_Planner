require('dotenv').config({ quiet: true });

const pool = require('../db');
const authService = require('../auth');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function main() {
  const email = required('FIRST_ADMIN_EMAIL').toLowerCase();
  const password = required('FIRST_ADMIN_PASSWORD');
  const displayName = String(process.env.FIRST_ADMIN_DISPLAY_NAME || '').trim();
  const [existing] = await pool.query('SELECT id, role FROM users WHERE email = ?', [email]);
  if (existing.length) {
    if (existing[0].role === 'admin') {
      console.log(`Admin already configured: ${email}`);
      return;
    }
    throw new Error(`User ${email} already exists with role ${existing[0].role}; promote it from the Admin screen or phpMyAdmin`);
  }
  await authService.register(email, password, displayName, 'admin');
  console.log(`First Admin created successfully: ${email}`);
}

main()
  .catch(error => {
    console.error(`First Admin setup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
