const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, HttpError, ROLES } = require('../server');

function sampleState() {
  return {
    planStartDate: '2026-08-12',
    settings: { companyWorkers: 20, currentAgency: 5, requestNoticeDays: 3, releaseNoticeDays: 3, crusherMode: 'floating', crusherWorkers: 2, floatingLimit: 2, minReleaseDuration: 3, planDays: 14 },
    machines: [{ id: 'L-01', name: 'Line 1', department: 'HDPE', defaultProduct: 'Pipe', sortOrder: 1 }],
    plans: { 'L-01': [{ kind: 'run', product: 'Pipe', days: 14, workers: 3 }] },
    published: {
      id: 'PUB-1', publishedAt: '2026-08-12T10:00:00.000Z', planStartDate: '2026-08-12',
      settings: { companyWorkers: 20, currentAgency: 5, requestNoticeDays: 3, releaseNoticeDays: 3, crusherMode: 'floating', crusherWorkers: 2, floatingLimit: 2, minReleaseDuration: 3, planDays: 14 },
      machines: [{ id: 'L-01', name: 'Line 1', department: 'HDPE', defaultProduct: 'Pipe', sortOrder: 1 }],
      plans: { 'L-01': [{ kind: 'run', product: 'Pipe', days: 14, workers: 3 }] }
    },
    protectedExtraField: { keep: true }
  };
}

function fakeAuth() {
  const profiles = {
    'admin-token': { id: 'admin-1', email: 'admin@example.com', displayName: 'Admin', role: ROLES.ADMIN },
    'pm-token': { id: 'pm-1', email: 'pm@example.com', displayName: 'Manager', role: ROLES.PRODUCTION_MANAGER },
    'hr-token': { id: 'hr-1', email: 'hr@example.com', displayName: 'HR', role: ROLES.HR },
    'pending-token': { id: 'pending-1', email: 'pending@example.com', displayName: 'Pending User', role: null }
  };
  return {
    async authenticate(authHeader) {
      const token = String(authHeader || '').replace(/^Bearer\s+/i, '');
      if (!profiles[token]) throw new HttpError(401, 'Sign in is required', 'AUTH_REQUIRED');
      return profiles[token];
    },
    async listUsers() { return Object.values(profiles); },
    async register(email, password, displayName, role) { return { id: 'new-user', email, displayName: displayName || '', disabled: false, role }; },
    async updateUser(id, input, actorId) {
      if (id === actorId) throw new HttpError(400, 'You cannot change your own role or disable your own account', 'SELF_ADMIN_CHANGE_BLOCKED');
      return { id, email: `${id}@example.com`, disabled: Boolean(input.disabled), role: input.role || ROLES.HR };
    }
  };
}

function memoryRepository() {
  let state = sampleState();
  const history = [state.published];
  return {
    async getState() { return structuredClone(state); },
    async saveDraft(draft) { state = { ...state, ...structuredClone(draft) }; return structuredClone(state); },
    async publish() {
      const published = { ...structuredClone(state), id: 'PUB-2', publishedAt: new Date().toISOString() };
      delete published.published;
      delete published.protectedExtraField;
      state.published = published;
      history.unshift(published);
      return structuredClone(published);
    },
    async getPublished() { return structuredClone(state.published); },
    async getHistory() { return structuredClone(history); }
  };
}

async function withServer(run) {
  const server = createServer({
    authService: fakeAuth(), repository: memoryRepository(),
    database: { async query() { return [[{ ok: 1 }]]; } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function request(base, path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test('public health works, while protected data rejects signed-out requests', async () => {
  await withServer(async base => {
    assert.equal((await request(base, '/api/health')).response.status, 200);
    assert.equal((await request(base, '/api/state')).response.status, 401);
    assert.equal((await request(base, '/api/published')).response.status, 401);
  });
});

test('a self-registered account without a role cannot access any protected application data', async () => {
  await withServer(async base => {
    assert.equal((await request(base, '/api/me', 'pending-token')).response.status, 403);
    assert.equal((await request(base, '/api/published', 'pending-token')).response.status, 403);
    assert.equal((await request(base, '/api/state', 'pending-token')).response.status, 403);
    assert.equal((await request(base, '/api/admin/users', 'pending-token')).response.status, 403);
  });
});

test('HR can read Published Plan only and all draft/admin mutations are rejected by the server', async () => {
  await withServer(async base => {
    assert.equal((await request(base, '/api/me', 'hr-token')).response.status, 200);
    assert.equal((await request(base, '/api/published', 'hr-token')).response.status, 200);
    assert.equal((await request(base, '/api/state', 'hr-token')).response.status, 403);
    assert.equal((await request(base, '/api/history', 'hr-token')).response.status, 403);
    assert.equal((await request(base, '/api/state', 'hr-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).response.status, 403);
    assert.equal((await request(base, '/api/publish', 'hr-token', { method: 'POST' })).response.status, 403);
    assert.equal((await request(base, '/api/admin/users', 'hr-token')).response.status, 403);
  });
});

test('Production Manager can save/publish draft but cannot manage users', async () => {
  await withServer(async base => {
    const current = await request(base, '/api/state', 'pm-token');
    assert.equal(current.response.status, 200);
    current.body.settings.companyWorkers = 21;
    const saved = await request(base, '/api/state', 'pm-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current.body) });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.state.settings.companyWorkers, 21);
    assert.equal(saved.body.state.settings.crusherMode, 'floating');
    assert.deepEqual(saved.body.state.protectedExtraField, { keep: true });
    const invalidCrusher = structuredClone(saved.body.state);
    invalidCrusher.settings.crusherWorkers = 0;
    invalidCrusher.settings.floatingLimit = 0;
    assert.equal((await request(base, '/api/state', 'pm-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalidCrusher) })).response.status, 400);
    const crusherPeriod = structuredClone(current.body);
    crusherPeriod.machines.push({ id: 'L-13', name: 'Crusher', department: 'Crusher', defaultProduct: 'Crushing', sortOrder: 13 });
    crusherPeriod.plans['L-13'] = [{ kind: 'run', product: 'Crushing', days: 14, workers: 2 }];
    assert.equal((await request(base, '/api/state', 'pm-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(crusherPeriod) })).response.status, 400);
    assert.equal((await request(base, '/api/publish', 'pm-token', { method: 'POST' })).response.status, 200);
    assert.equal((await request(base, '/api/history', 'pm-token')).response.status, 200);
    assert.equal((await request(base, '/api/admin/users', 'pm-token')).response.status, 403);
  });
});

test('Admin can access all areas and cannot demote or disable self', async () => {
  await withServer(async base => {
    assert.equal((await request(base, '/api/state', 'admin-token')).response.status, 200);
    assert.equal((await request(base, '/api/history', 'admin-token')).response.status, 200);
    assert.equal((await request(base, '/api/admin/users', 'admin-token')).response.status, 200);
    assert.equal((await request(base, '/api/admin/users', 'admin-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'new@example.com', password: 'StrongPass1', role: 'hr' }) })).response.status, 201);
    const selfChange = await request(base, '/api/admin/users/admin-1', 'admin-token', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'hr' }) });
    assert.equal(selfChange.response.status, 400);
    assert.equal(selfChange.body.code, 'SELF_ADMIN_CHANGE_BLOCKED');
  });
});
