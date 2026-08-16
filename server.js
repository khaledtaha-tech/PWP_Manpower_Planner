require('dotenv').config({ quiet: true });

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const ROLES = Object.freeze({
  ADMIN: 'admin',
  PRODUCTION_MANAGER: 'production_manager',
  HR: 'hr'
});
const VALID_ROLES = new Set(Object.values(ROLES));

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > 2 * 1024 * 1024) {
        reject(new HttpError(413, 'Request body is too large', 'BODY_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON body', 'INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function strictInteger(value, label, min, max) {
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${label} must be an integer from ${min} to ${max}`, 'INVALID_STATE');
  }
  return number;
}

function sanitizeDraftState(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Invalid draft plan', 'INVALID_STATE');
  }
  if (!current || typeof current !== 'object') {
    throw new HttpError(503, 'The existing Firestore state could not be loaded', 'STATE_UNAVAILABLE');
  }

  const planStartDate = String(input.planStartDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planStartDate) || Number.isNaN(Date.parse(`${planStartDate}T12:00:00Z`))) {
    throw new HttpError(400, 'Plan start date is invalid', 'INVALID_STATE');
  }

  const rawSettings = input.settings;
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    throw new HttpError(400, 'Workforce settings are required', 'INVALID_STATE');
  }
  const settings = {
    ...(current.settings || {}),
    companyWorkers: strictInteger(rawSettings.companyWorkers, 'Company Workers', 0, 999),
    currentAgency: strictInteger(rawSettings.currentAgency, 'Current Agency Workers', 0, 999),
    requestNoticeDays: strictInteger(rawSettings.requestNoticeDays, 'Request Notice', 0, 30),
    releaseNoticeDays: strictInteger(rawSettings.releaseNoticeDays, 'Release Notice', 0, 30),
    crusherMode: rawSettings.crusherMode === 'mandatory' ? 'mandatory' : 'floating',
    crusherWorkers: strictInteger(rawSettings.crusherWorkers ?? rawSettings.floatingLimit ?? current.settings?.crusherWorkers ?? 2, 'Crusher Workers', 0, 99),
    floatingLimit: strictInteger(rawSettings.crusherWorkers ?? rawSettings.floatingLimit ?? current.settings?.crusherWorkers ?? 2, 'Crusher Workers', 0, 99),
    minReleaseDuration: strictInteger(rawSettings.minReleaseDuration, 'Minimum Release Duration', 1, 14),
    planDays: 14
  };

  if (!Array.isArray(input.machines)) {
    throw new HttpError(400, 'Machines list is required', 'INVALID_STATE');
  }
  const currentMachines = new Map((current.machines || []).map(machine => [String(machine.id), machine]));
  const machineIds = new Set();
  const machines = input.machines.map((rawMachine, index) => {
    if (!rawMachine || typeof rawMachine !== 'object' || Array.isArray(rawMachine)) {
      throw new HttpError(400, `Machine at position ${index + 1} is invalid`, 'INVALID_STATE');
    }
    const id = String(rawMachine.id || '').trim();
    const name = String(rawMachine.name || '').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id.length > 30 || !name || name.length > 100) {
      throw new HttpError(400, `Machine at position ${index + 1} requires a valid ID and name`, 'INVALID_STATE');
    }
    if (machineIds.has(id)) {
      throw new HttpError(400, `Duplicate Machine ID: ${id}`, 'INVALID_STATE');
    }
    machineIds.add(id);
    return {
      ...(currentMachines.get(id) || {}),
      id,
      name,
      department: String(rawMachine.department || '').trim().slice(0, 80),
      defaultProduct: String(rawMachine.defaultProduct || '').trim().slice(0, 120),
      sortOrder: strictInteger(rawMachine.sortOrder ?? index + 1, `Sort order for ${id}`, 0, 999)
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);

  if (!input.plans || typeof input.plans !== 'object' || Array.isArray(input.plans)) {
    throw new HttpError(400, 'Machine plans are required', 'INVALID_STATE');
  }
  for (const key of Object.keys(input.plans)) {
    if (!machineIds.has(key)) {
      throw new HttpError(400, `Draft contains a plan for unknown machine ${key}`, 'INVALID_STATE');
    }
  }

  const plans = {};
  for (const machine of machines) {
    const rawSegments = input.plans[machine.id];
    if (!Array.isArray(rawSegments)) {
      throw new HttpError(400, `Plan for machine ${machine.id} must be a list`, 'INVALID_STATE');
    }
    let totalDays = 0;
    plans[machine.id] = rawSegments.map((segment, index) => {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
        throw new HttpError(400, `Period ${index + 1} for ${machine.id} is invalid`, 'INVALID_STATE');
      }
      if (segment.kind !== 'run' && segment.kind !== 'stopped') {
        throw new HttpError(400, `Period ${index + 1} for ${machine.id} has an invalid status`, 'INVALID_STATE');
      }
      const days = strictInteger(segment.days, `Duration for ${machine.id} period ${index + 1}`, 1, 14);
      totalDays += days;
      if (totalDays > 14) {
        throw new HttpError(400, `Total duration for ${machine.id} exceeds 14 days`, 'INVALID_STATE');
      }
      if (segment.kind === 'stopped') {
        const suppliedWorkers = Number(segment.workers ?? 0);
        if (suppliedWorkers !== 0) {
          throw new HttpError(400, `Stopped period ${index + 1} for ${machine.id} must have zero workers`, 'INVALID_STATE');
        }
        return { kind: 'stopped', product: 'Stopped', days, workers: 0 };
      }
      const product = String(segment.product || '').trim();
      if (!product) {
        throw new HttpError(400, `Product is required for ${machine.id} period ${index + 1}`, 'INVALID_STATE');
      }
      return {
        kind: 'run',
        product: product.slice(0, 120),
        days,
        workers: strictInteger(segment.workers, `Workers for ${machine.id} period ${index + 1}`, 0, 99)
      };
    });
  }

  return { planStartDate, settings, machines, plans };
}

function buildSnapshot(state) {
  return {
    id: `PUB-${Date.now()}`,
    publishedAt: new Date().toISOString(),
    planStartDate: state.planStartDate,
    settings: deepClone(state.settings),
    machines: deepClone(state.machines),
    plans: deepClone(state.plans)
  };
}

class FirestoreRepository {
  constructor(firestore) {
    this.firestore = firestore;
  }
  stateRef() {
    return this.firestore.collection('pwp_manpower').doc('state');
  }
  historyRef() {
    return this.stateRef().collection('history');
  }
  async getState() {
    const snapshot = await this.stateRef().get();
    if (!snapshot.exists) {
      throw new HttpError(
        503,
        'Existing Firestore document pwp_manpower/state was not found. V3 will not seed or create it automatically.',
        'STATE_NOT_FOUND'
      );
    }
    return snapshot.data();
  }
  async saveDraft(draft) {
    const ref = this.stateRef();
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new HttpError(503, 'Existing Firestore state was not found; no data was written', 'STATE_NOT_FOUND');
    }
    await ref.set(draft, { merge: true });
    return { ...snapshot.data(), ...draft };
  }
  async publish() {
    const stateRef = this.stateRef();
    return this.firestore.runTransaction(async transaction => {
      const stateSnapshot = await transaction.get(stateRef);
      if (!stateSnapshot.exists) {
        throw new HttpError(503, 'Existing Firestore state was not found; no data was written', 'STATE_NOT_FOUND');
      }
      const state = stateSnapshot.data();
      const published = buildSnapshot(state);
      transaction.set(stateRef, { published }, { merge: true });
      transaction.set(this.historyRef().doc(published.id), published);
      return published;
    });
  }
  async getPublished() {
    const state = await this.getState();
    if (!state.published) throw new HttpError(404, 'No published plan is available yet', 'NO_PUBLISHED_PLAN');
    return state.published;
  }
  async getHistory(limit = 30) {
    const snapshot = await this.historyRef().orderBy('publishedAt', 'desc').limit(limit).get();
    return snapshot.docs.map(document => document.data());
  }
}

class FirebaseAuthService {
  constructor(auth) {
    this.auth = auth;
  }
  async authenticate(req) {
    const authorization = String(req.headers.authorization || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new HttpError(401, 'Sign in is required', 'AUTH_REQUIRED');
    let decoded;
    try {
      decoded = await this.auth.verifyIdToken(match[1], true);
    } catch {
      throw new HttpError(401, 'Your session is invalid or expired. Please sign in again.', 'INVALID_TOKEN');
    }
    let user;
    try {
      user = await this.auth.getUser(decoded.uid);
    } catch {
      throw new HttpError(401, 'The user account is unavailable', 'USER_UNAVAILABLE');
    }
    if (user.disabled) throw new HttpError(403, 'This user account is disabled', 'USER_DISABLED');
    const role = String(decoded.role || user.customClaims?.role || '').toLowerCase();
    if (!VALID_ROLES.has(role)) {
      throw new HttpError(403, 'No application role has been assigned to this account', 'ROLE_REQUIRED');
    }
    return { uid: user.uid, email: user.email || decoded.email || '', displayName: user.displayName || '', role };
  }
  async listUsers() {
    const users = [];
    let pageToken;
    do {
      const page = await this.auth.listUsers(1000, pageToken);
      users.push(...page.users.map(user => ({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        disabled: Boolean(user.disabled),
        role: VALID_ROLES.has(user.customClaims?.role) ? user.customClaims.role : null,
        createdAt: user.metadata?.creationTime || null,
        lastSignInAt: user.metadata?.lastSignInTime || null
      })));
      pageToken = page.pageToken;
    } while (pageToken && users.length < 5000);
    return users.sort((a, b) => a.email.localeCompare(b.email));
  }
  async createUser(input) {
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const displayName = String(input.displayName || '').trim().slice(0, 100);
    const role = String(input.role || '').toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'A valid email address is required', 'INVALID_USER');
    if (password.length < 8) throw new HttpError(400, 'Temporary password must contain at least 8 characters', 'INVALID_USER');
    if (!VALID_ROLES.has(role)) throw new HttpError(400, 'Select a valid role', 'INVALID_ROLE');
    let created;
    try {
      created = await this.auth.createUser({ email, password, displayName: displayName || undefined, emailVerified: false });
      await this.auth.setCustomUserClaims(created.uid, { role });
      await this.auth.revokeRefreshTokens(created.uid);
      return { uid: created.uid, email, displayName, disabled: false, role };
    } catch (error) {
      if (created?.uid) {
        try { await this.auth.deleteUser(created.uid); } catch { /* best-effort rollback of the new account only */ }
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error.message || 'Unable to create user', 'CREATE_USER_FAILED');
    }
  }
  async updateUser(uid, input, actorUid) {
    if (!uid) throw new HttpError(400, 'User ID is required', 'INVALID_USER');
    const changesRole = Object.prototype.hasOwnProperty.call(input, 'role');
    const changesDisabled = Object.prototype.hasOwnProperty.call(input, 'disabled');
    if (uid === actorUid && (changesRole || changesDisabled)) {
      throw new HttpError(400, 'You cannot change your own role or disable your own account', 'SELF_ADMIN_CHANGE_BLOCKED');
    }
    const current = await this.auth.getUser(uid);
    const updates = {};
    if (changesDisabled) updates.disabled = Boolean(input.disabled);
    if (Object.prototype.hasOwnProperty.call(input, 'displayName')) updates.displayName = String(input.displayName || '').trim().slice(0, 100);
    if (Object.keys(updates).length) await this.auth.updateUser(uid, updates);
    let role = current.customClaims?.role || null;
    if (changesRole) {
      role = String(input.role || '').toLowerCase();
      if (!VALID_ROLES.has(role)) throw new HttpError(400, 'Select a valid role', 'INVALID_ROLE');
      await this.auth.setCustomUserClaims(uid, { ...(current.customClaims || {}), role });
    }
    if (changesRole || changesDisabled) await this.auth.revokeRefreshTokens(uid);
    const updated = await this.auth.getUser(uid);
    return {
      uid: updated.uid,
      email: updated.email || '',
      displayName: updated.displayName || '',
      disabled: Boolean(updated.disabled),
      role
    };
  }
}

class UnavailableService {
  constructor(message) { this.message = message; }
  fail() { throw new HttpError(503, this.message, 'FIREBASE_NOT_CONFIGURED'); }
  authenticate() { return this.fail(); }
  getState() { return this.fail(); }
  saveDraft() { return this.fail(); }
  publish() { return this.fail(); }
  getPublished() { return this.fail(); }
  getHistory() { return this.fail(); }
  listUsers() { return this.fail(); }
  createUser() { return this.fail(); }
  updateUser() { return this.fail(); }
}

function getPublicFirebaseConfig() {
  return {
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || ''
  };
}

function hasWebConfig(config) {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

async function initializeFirebaseServices() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  const publicConfig = getPublicFirebaseConfig();
  const missingAdmin = !projectId || !clientEmail || !privateKeyRaw;
  if (missingAdmin) {
    const message = 'Firebase Admin environment variables are not configured. No local database or seed fallback will be used.';
    const unavailable = new UnavailableService(message);
    return { authService: unavailable, repository: unavailable, publicConfig, ready: false, detail: message };
  }
  try {
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const { getFirestore } = require('firebase-admin/firestore');
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
    const app = getApps().length ? getApps()[0] : initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId
    });
    const firestore = getFirestore(app);
    const stateSnapshot = await firestore.collection('pwp_manpower').doc('state').get();
    const stateExists = stateSnapshot.exists;
    return {
      authService: new FirebaseAuthService(getAuth(app)),
      repository: new FirestoreRepository(firestore),
      publicConfig,
      ready: stateExists && hasWebConfig(publicConfig),
      detail: stateExists
        ? (hasWebConfig(publicConfig) ? `Firebase connected · ${projectId}` : 'Firebase connected; web authentication variables are incomplete')
        : 'Firebase connected, but existing pwp_manpower/state was not found. No seed was run.'
    };
  } catch (error) {
    const message = `Firebase initialization failed: ${error.message}`;
    const unavailable = new UnavailableService(message);
    return { authService: unavailable, repository: unavailable, publicConfig, ready: false, detail: message };
  }
}

function roleLabel(role) {
  return ({ admin: 'Admin', production_manager: 'Production Manager', hr: 'HR' })[role] || role;
}

function createRequestHandler({ authService, repository, publicConfig = {}, ready = true, detail = 'Ready' }) {
  async function requireRole(req, allowedRoles) {
    const user = await authService.authenticate(req);
    if (!allowedRoles.includes(user.role)) {
      throw new HttpError(403, 'You do not have permission to perform this action', 'FORBIDDEN');
    }
    return user;
  }

  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/api/config') {
        return sendJson(res, 200, { firebase: publicConfig, configured: hasWebConfig(publicConfig) });
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: ready, app: 'PWP Manpower Planner V3', firebaseConfigured: ready, detail });
      }
      if (req.method === 'GET' && url.pathname === '/api/me') {
        const user = await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER, ROLES.HR]);
        return sendJson(res, 200, { ...user, roleLabel: roleLabel(user.role) });
      }
      if (req.method === 'GET' && url.pathname === '/api/published') {
        await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER, ROLES.HR]);
        return sendJson(res, 200, await repository.getPublished());
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER]);
        return sendJson(res, 200, await repository.getState());
      }
      if (req.method === 'POST' && url.pathname === '/api/state') {
        await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER]);
        const incoming = await readBody(req);
        const current = await repository.getState();
        const draft = sanitizeDraftState(incoming, current);
        const state = await repository.saveDraft(draft);
        return sendJson(res, 200, { ok: true, state });
      }
      if (req.method === 'POST' && url.pathname === '/api/publish') {
        await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER]);
        return sendJson(res, 200, { ok: true, published: await repository.publish() });
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER]);
        return sendJson(res, 200, await repository.getHistory(30));
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/users') {
        await requireRole(req, [ROLES.ADMIN]);
        return sendJson(res, 200, await authService.listUsers());
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/users') {
        await requireRole(req, [ROLES.ADMIN]);
        return sendJson(res, 201, await authService.createUser(await readBody(req)));
      }
      const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (req.method === 'PATCH' && userMatch) {
        const actor = await requireRole(req, [ROLES.ADMIN]);
        const updated = await authService.updateUser(decodeURIComponent(userMatch[1]), await readBody(req), actor.uid);
        return sendJson(res, 200, updated);
      }
      if (url.pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'API endpoint not found', code: 'NOT_FOUND' });
      }
      return serveStatic(req, res);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      return sendJson(res, status, { error: error.message || 'Server error', code: error.code || 'SERVER_ERROR' });
    }
  };
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { pathname = '/'; }
  if (pathname === '/') pathname = '/index.html';
  const relative = path.normalize(pathname).replace(/^([/\\]*\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const absolute = path.join(PUBLIC_DIR, relative);
  if (!absolute.startsWith(`${PUBLIC_DIR}${path.sep}`) && absolute !== PUBLIC_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(absolute, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const extension = path.extname(absolute).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    res.writeHead(200, {
      'Content-Type': contentTypes[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(absolute).pipe(res);
  });
}

function createServer(services) {
  return http.createServer(createRequestHandler(services));
}

async function start() {
  const services = await initializeFirebaseServices();
  const server = createServer(services);
  server.listen(PORT, () => {
    console.log(`PWP Manpower Planner V3 running on http://localhost:${PORT}`);
    console.log(services.detail);
  });
  return server;
}

if (require.main === module) {
  start().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  ROLES,
  HttpError,
  FirestoreRepository,
  FirebaseAuthService,
  buildSnapshot,
  createRequestHandler,
  createServer,
  sanitizeDraftState,
  start
};
