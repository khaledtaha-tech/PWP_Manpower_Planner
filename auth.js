const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'manpower_secret_key_change_me';
const VALID_ROLES = new Set(['admin', 'production_manager', 'hr']);

class AuthService {
  async register(email, password, displayName, role) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanRole = String(role || '').trim().toLowerCase();
    const cleanName = String(displayName || '').trim().slice(0, 100);

    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      const err = new Error('A valid email is required');
      err.status = 400;
      throw err;
    }
    if (!password || password.length < 8) {
      const err = new Error('Password must be at least 8 characters');
      err.status = 400;
      throw err;
    }
    if (!VALID_ROLES.has(cleanRole)) {
      const err = new Error('Invalid role specified');
      err.status = 400;
      throw err;
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length) {
      const err = new Error('Email already registered');
      err.status = 400;
      throw err;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
      [cleanEmail, passwordHash, cleanName, cleanRole]
    );

    return {
      id: result.insertId,
      email: cleanEmail,
      displayName: cleanName,
      role: cleanRole,
      disabled: 0
    };
  }

  async login(email, password) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (!rows.length) {
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const user = rows[0];
    if (user.disabled) {
      const err = new Error('This account is disabled');
      err.status = 403;
      throw err;
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      }
    };
  }

  verifyToken(authHeader) {
    const header = String(authHeader || '');
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      const err = new Error('Authentication required');
      err.status = 401;
      throw err;
    }

    try {
      return jwt.verify(match[1], JWT_SECRET);
    } catch {
      const err = new Error('Session expired or invalid');
      err.status = 401;
      throw err;
    }
  }

  async listUsers() {
    const [rows] = await pool.query(
      'SELECT id, email, display_name AS displayName, role, disabled, created_at AS createdAt FROM users ORDER BY email ASC'
    );
    return rows;
  }

  async updateUser(id, { role, disabled, displayName }, actorId) {
    if (Number(id) === Number(actorId) && (role !== undefined || disabled !== undefined)) {
      const err = new Error('You cannot change your own role or disabled state');
      err.status = 400;
      throw err;
    }

    const fields = [];
    const values = [];

    if (role !== undefined) {
      if (!VALID_ROLES.has(role)) {
        const err = new Error('Invalid role');
        err.status = 400;
        throw err;
      }
      fields.push('role = ?');
      values.push(role);
    }
    if (disabled !== undefined) {
      fields.push('disabled = ?');
      values.push(disabled ? 1 : 0);
    }
    if (displayName !== undefined) {
      fields.push('display_name = ?');
      values.push(String(displayName).trim().slice(0, 100));
    }

    if (!fields.length) return;

    values.push(Number(id));
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  }
}

module.exports = new AuthService();