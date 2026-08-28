require('dotenv').config({ quiet: true });

const bcrypt = require('bcryptjs');
const pool = require('../db');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function main() {
  const email = required('RESET_EMAIL').toLowerCase();
  const password = required('RESET_PASSWORD');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('RESET_EMAIL must be a valid email address');
  if (password.length < 8) throw new Error('RESET_PASSWORD must contain at least 8 characters');

  const [users] = await pool.query('SELECT id, disabled FROM users WHERE email = ?', [email]);
  if (!users.length) throw new Error(`No user exists with email: ${email}`);

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, users[0].id]);
  console.log(`Password reset successfully for: ${email}`);
  if (users[0].disabled) console.log('Warning: the account is still disabled and must be enabled by an Admin or in phpMyAdmin.');
}

main()
  .catch(error => {
    console.error(`Password reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
