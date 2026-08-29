const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');

test('empty legacy M1/M2 placeholder state migrates safely to the factory machine master', async () => {
  const originalQuery = pool.query;
  const writes = [];
  const legacy = {
    planStartDate: '2026-08-27',
    settings: { companyWorkers: 20, currentAgency: 10, crusherWorkers: 2 },
    machines: [{ id: 'M1', name: 'Extruder 1' }, { id: 'M2', name: 'Extruder 2' }],
    plans: { M1: [], M2: [] }
  };
  pool.query = async (sql, parameters) => {
    if (sql.startsWith('SELECT data FROM app_state')) return [[{ data: JSON.stringify(legacy) }]];
    writes.push({ sql, parameters });
    return [{ affectedRows: 1 }];
  };
  delete require.cache[require.resolve('../repository')];
  const repository = require('../repository');
  try {
    const state = await repository.getState();
    assert.equal(state.machines.length, 13);
    assert.equal(state.machines[0].id, 'L-01');
    assert.equal(state.machines[12].name, 'Crusher');
    assert.deepEqual(Object.keys(state.plans), state.machines.map(machine => machine.id));
    assert.equal(writes.length, 1);
    assert.match(writes[0].sql, /ON DUPLICATE KEY UPDATE/);
  } finally {
    pool.query = originalQuery;
    delete require.cache[require.resolve('../repository')];
  }
});

test('legacy placeholder state with real plan data is never auto-migrated', async () => {
  const originalQuery = pool.query;
  const legacyWithData = {
    planStartDate: '2026-08-27',
    settings: { companyWorkers: 20 },
    machines: [{ id: 'M1', name: 'Real Machine 1' }, { id: 'M2', name: 'Real Machine 2' }],
    plans: { M1: [{ kind: 'run', product: 'Pipe', days: 14, workers: 3 }], M2: [] }
  };
  let writeCount = 0;
  pool.query = async sql => {
    if (sql.startsWith('SELECT data FROM app_state')) return [[{ data: legacyWithData }]];
    writeCount += 1;
    return [{ affectedRows: 1 }];
  };
  delete require.cache[require.resolve('../repository')];
  const repository = require('../repository');
  try {
    const state = await repository.getState();
    assert.deepEqual(state, legacyWithData);
    assert.equal(writeCount, 0);
  } finally {
    pool.query = originalQuery;
    delete require.cache[require.resolve('../repository')];
  }
});

test('publishing supports the original minimal history table without metadata columns', async () => {
  const originalQuery = pool.query;
  const state = {
    planStartDate: '2026-08-29',
    settings: {},
    machines: [],
    plans: {}
  };
  const writes = [];
  pool.query = async (sql, parameters) => {
    if (sql.startsWith('SELECT data FROM app_state')) return [[{ data: state }]];
    if (sql === 'SHOW COLUMNS FROM history') {
      return [[{ Field: 'id' }, { Field: 'data' }, { Field: 'created_at' }]];
    }
    writes.push({ sql, parameters });
    return [{ affectedRows: 1 }];
  };
  delete require.cache[require.resolve('../repository')];
  const repository = require('../repository');
  try {
    const snapshot = await repository.publish(current => ({ ...current, id: 'PUB-LEGACY' }));
    assert.equal(snapshot.id, 'PUB-LEGACY');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].sql, 'INSERT INTO history (data) VALUES (?)');
    assert.equal(JSON.parse(writes[0].parameters[0]).id, 'PUB-LEGACY');
  } finally {
    pool.query = originalQuery;
    delete require.cache[require.resolve('../repository')];
  }
});

test('publishing uses metadata columns when the current history schema provides them', async () => {
  const originalQuery = pool.query;
  const state = { planStartDate: '2026-08-29', settings: {}, machines: [], plans: {} };
  const writes = [];
  pool.query = async (sql, parameters) => {
    if (sql.startsWith('SELECT data FROM app_state')) return [[{ data: state }]];
    if (sql === 'SHOW COLUMNS FROM history') {
      return [[{ Field: 'id' }, { Field: 'snapshot_id' }, { Field: 'published_at' }, { Field: 'data' }]];
    }
    writes.push({ sql, parameters });
    return [{ affectedRows: 1 }];
  };
  delete require.cache[require.resolve('../repository')];
  const repository = require('../repository');
  try {
    await repository.publish(current => ({ ...current, id: 'PUB-CURRENT' }));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].sql, 'INSERT INTO history (snapshot_id, published_at, data) VALUES (?, ?, ?)');
    assert.equal(writes[0].parameters[0], 'PUB-CURRENT');
    assert.ok(writes[0].parameters[1] instanceof Date);
  } finally {
    pool.query = originalQuery;
    delete require.cache[require.resolve('../repository')];
  }
});
