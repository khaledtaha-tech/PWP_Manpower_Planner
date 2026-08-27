const pool = require('./db');

const DEFAULT_STATE = {
  planStartDate: new Date().toISOString().slice(0, 10),
  settings: {
    companyWorkers: 30,
    currentAgency: 10,
    requestNoticeDays: 2,
    releaseNoticeDays: 2,
    crusherMode: 'floating',
    crusherWorkers: 2,
    floatingLimit: 2,
    minReleaseDuration: 2,
    planDays: 14
  },
  machines: [
    { id: 'M1', name: 'Extruder 1', department: 'PVC', defaultProduct: 'PVC Pipe 110mm', sortOrder: 1 },
    { id: 'M2', name: 'Extruder 2', department: 'HDPE', defaultProduct: 'HDPE Pipe 90mm', sortOrder: 2 }
  ],
  plans: {
    M1: [],
    M2: []
  }
};

function parsePayload(row) {
  if (!row || !row.data) return null;
  if (typeof row.data === 'object') return row.data;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

const repository = {
  async getState() {
    const [rows] = await pool.query('SELECT data FROM app_state WHERE id = 1');
    const parsed = rows.length ? parsePayload(rows[0]) : null;
    if (!parsed || !Array.isArray(parsed.machines)) {
      await this.saveDraft(DEFAULT_STATE);
      return JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
    return parsed;
  },

  async saveDraft(state) {
    const json = JSON.stringify(state);
    await pool.query('REPLACE INTO app_state (id, data) VALUES (1, ?)', [json]);
    return state;
  },

  async getPublished() {
    const [rows] = await pool.query('SELECT data FROM history ORDER BY id DESC LIMIT 1');
    return rows.length ? parsePayload(rows[0]) : null;
  },

  async publish(buildSnapshotFn) {
    const currentState = await this.getState();
    const snapshot = buildSnapshotFn(currentState);
    const json = JSON.stringify(snapshot);
    await pool.query('INSERT INTO history (snapshot_id, published_at, data) VALUES (?, ?, ?)', [
      snapshot.id,
      new Date(),
      json
    ]);
    return snapshot;
  },

  async getHistory(limit = 30) {
    const [rows] = await pool.query('SELECT data FROM history ORDER BY id DESC LIMIT ?', [Number(limit) || 30]);
    return rows.map(parsePayload).filter(Boolean);
  }
};

module.exports = repository;