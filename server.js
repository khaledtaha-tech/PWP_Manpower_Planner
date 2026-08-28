require('dotenv').config({ quiet: true });

const http = require('http');
const fs = require('fs');
const path = require('path');

const pool = require('./db');
const defaultRepository = require('./repository');
const defaultAuthService = require('./auth');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const ROLES = Object.freeze({
  ADMIN: 'admin',
  PRODUCTION_MANAGER: 'production_manager',
  HR: 'hr'
});

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

  const planStartDate = String(input.planStartDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planStartDate) || Number.isNaN(Date.parse(`${planStartDate}T12:00:00Z`))) {
    throw new HttpError(400, 'Plan start date is invalid', 'INVALID_STATE');
  }

  const rawSettings = input.settings;
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    throw new HttpError(400, 'Workforce settings are required', 'INVALID_STATE');
  }
  const settings = {
    ...(current?.settings || {}),
    companyWorkers: strictInteger(rawSettings.companyWorkers, 'Company Workers', 0, 999),
    currentAgency: strictInteger(rawSettings.currentAgency, 'Current Agency Workers', 0, 999),
    requestNoticeDays: strictInteger(rawSettings.requestNoticeDays, 'Request Notice', 0, 30),
    releaseNoticeDays: strictInteger(rawSettings.releaseNoticeDays, 'Release Notice', 0, 30),
    crusherMode: rawSettings.crusherMode === 'mandatory' ? 'mandatory' : 'floating',
    crusherWorkers: strictInteger(rawSettings.crusherWorkers ?? rawSettings.floatingLimit ?? current?.settings?.crusherWorkers ?? 2, 'Crusher Workers', 2, 99),
    floatingLimit: strictInteger(rawSettings.crusherWorkers ?? rawSettings.floatingLimit ?? current?.settings?.crusherWorkers ?? 2, 'Crusher Workers', 2, 99),
    minReleaseDuration: strictInteger(rawSettings.minReleaseDuration, 'Minimum Release Duration', 1, 14),
    planDays: 14
  };

  if (!Array.isArray(input.machines)) {
    throw new HttpError(400, 'Machines list is required', 'INVALID_STATE');
  }
  const currentMachines = new Map((current?.machines || []).map(machine => [String(machine.id), machine]));
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
    const machineIdentity = `${machine.id} ${machine.name} ${machine.department || ''}`.toLowerCase();
    if (machineIdentity.includes('crusher') && rawSegments.length) {
      throw new HttpError(400, `Crusher ${machine.id} is controlled by Mandatory/Floating mode and cannot contain production periods`, 'INVALID_STATE');
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

  return { ...deepClone(current || {}), planStartDate, settings, machines, plans };
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

function roleLabel(role) {
  return ({ admin: 'Admin', production_manager: 'Production Manager', hr: 'HR' })[role] || role;
}

async function requireRole(req, allowedRoles, authService) {
  const user = await authService.authenticate(req.headers.authorization);
  if (!allowedRoles.includes(user.role)) {
    throw new HttpError(403, 'You do not have permission to perform this action', 'FORBIDDEN');
  }
  return user;
}

function createRequestHandler({
  repository = defaultRepository,
  authService = defaultAuthService,
  database = pool
} = {}) {
  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      await database.query('SELECT 1');
      return sendJson(res, 200, { ok: true, app: 'PWP Manpower Planner (MySQL)', database: 'Connected' });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const { email, password } = await readBody(req);
      const result = await authService.login(email, password);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
      const user = await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER, ROLES.HR], authService);
      return sendJson(res, 200, { ...user, roleLabel: roleLabel(user.role) });
    }

    if (req.method === 'GET' && url.pathname === '/api/published') {
      await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER, ROLES.HR], authService);
      const published = await repository.getPublished();
      if (!published) throw new HttpError(404, 'No published plan available', 'NOT_FOUND');
      return sendJson(res, 200, published);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER], authService);
      const state = await repository.getState();
      return sendJson(res, 200, state || {});
    }

    if (req.method === 'POST' && url.pathname === '/api/state') {
      await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER], authService);
      const incoming = await readBody(req);
      const current = await repository.getState();
      const draft = sanitizeDraftState(incoming, current);
      const state = await repository.saveDraft(draft);
      return sendJson(res, 200, { ok: true, state });
    }

    if (req.method === 'POST' && url.pathname === '/api/publish') {
      await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER], authService);
      const published = await repository.publish(buildSnapshot);
      return sendJson(res, 200, { ok: true, published });
    }

    if (req.method === 'GET' && url.pathname === '/api/history') {
      await requireRole(req, [ROLES.ADMIN, ROLES.PRODUCTION_MANAGER], authService);
      const history = await repository.getHistory(30);
      return sendJson(res, 200, history);
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      await requireRole(req, [ROLES.ADMIN], authService);
      const users = await authService.listUsers();
      return sendJson(res, 200, users);
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/users') {
      await requireRole(req, [ROLES.ADMIN], authService);
      const { email, password, displayName, role } = await readBody(req);
      const created = await authService.register(email, password, displayName, role);
      return sendJson(res, 201, created);
    }

    const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (req.method === 'PATCH' && userMatch) {
      const actor = await requireRole(req, [ROLES.ADMIN], authService);
      const userId = decodeURIComponent(userMatch[1]);
      await authService.updateUser(userId, await readBody(req), actor.id);
      return sendJson(res, 200, { ok: true });
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

function createServer(dependencies = {}) {
  return http.createServer(createRequestHandler(dependencies));
}

function startServer() {
  const server = createServer();
  server.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    try {
      const connection = await pool.getConnection();
      console.log('Database connected successfully');
      connection.release();
    } catch (err) {
      console.error('Database connection failed:', err.message);
    }
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { createServer, createRequestHandler, HttpError, ROLES, sanitizeDraftState, buildSnapshot };
