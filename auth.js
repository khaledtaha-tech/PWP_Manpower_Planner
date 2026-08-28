const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const VALID_ROLES = new Set(['admin', 'production_manager', 'hr']);

function jwtSecret() {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    const err = new Error('JWT_SECRET must be configured with at least 32 characters');
    err.status = 500;
    err.code = 'AUTH_CONFIGURATION_ERROR';
    throw err;
  }
  return JWT_SECRET;
}

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
      jwtSecret(),
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
      return jwt.verify(match[1], jwtSecret());
    } catch {
      const err = new Error('Session expired or invalid');
      err.status = 401;
      throw err;
    }
  }

  async authenticate(authHeader) {
    const tokenUser = this.verifyToken(authHeader);
    const [rows] = await pool.query(
      'SELECT id, email, display_name AS displayName, role, disabled FROM users WHERE id = ?',
      [Number(tokenUser.id)]
    );
    if (!rows.length) {
      const err = new Error('User account no longer exists');
      err.status = 401;
      err.code = 'ACCOUNT_NOT_FOUND';
      throw err;
    }
    const user = rows[0];
    if (user.disabled) {
      const err = new Error('This account is disabled');
      err.status = 403;
      err.code = 'ACCOUNT_DISABLED';
      throw err;
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role
    };
  }

  async changePassword(id, currentPassword, newPassword) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      const err = new Error('Invalid user ID');
      err.status = 400;
      throw err;
    }
    if (!currentPassword) {
      const err = new Error('Current password is required');
      err.status = 400;
      throw err;
    }
    if (!newPassword || newPassword.length < 8) {
      const err = new Error('New password must be at least 8 characters');
      err.status = 400;
      throw err;
    }
    if (currentPassword === newPassword) {
      const err = new Error('New password must be different from the current password');
      err.status = 400;
      throw err;
    }
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
    if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      const err = new Error('Current password is incorrect');
      err.status = 401;
      throw err;
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
  }

  async listUsers() {
    const [rows] = await pool.query(
      'SELECT id, email, display_name AS displayName, role, disabled, created_at AS createdAt FROM users ORDER BY email ASC'
    );
    return rows;
  }

  async updateUser(id, { role, disabled, displayName }, actorId) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      const err = new Error('Invalid user ID');
      err.status = 400;
      throw err;
    }
    if (userId === Number(actorId) && (role !== undefined || disabled !== undefined)) {
      const err = new Error('You cannot change your own role or disabled state');
      err.status = 400;
      throw err;
    }

    const fields = [];
    const values = [];

    if (role !== undefined) {
      const cleanRole = String(role).trim().toLowerCase();
      if (!VALID_ROLES.has(cleanRole)) {
        const err = new Error('Invalid role');
        err.status = 400;
        throw err;
      }
      fields.push('role = ?');
      values.push(cleanRole);
    }
    if (disabled !== undefined) {
      if (typeof disabled !== 'boolean') {
        const err = new Error('Disabled state must be true or false');
        err.status = 400;
        throw err;
      }
      fields.push('disabled = ?');
      values.push(disabled ? 1 : 0);
    }
    if (displayName !== undefined) {
      fields.push('display_name = ?');
      values.push(String(displayName).trim().slice(0, 100));
    }

    if (!fields.length) return;

    values.push(userId);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  }
}

module.exports = new AuthService();
