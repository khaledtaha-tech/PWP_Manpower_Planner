const pool = require('./db');

const DEFAULT_MACHINES = [
  { id: 'L-01', name: 'Kabra 90', department: 'HDPE', defaultProduct: 'HDPE Single Wall Pipe', sortOrder: 1 },
  { id: 'L-02', name: 'Beier 2', department: 'PPR', defaultProduct: 'PPR Extrusion', sortOrder: 2 },
  { id: 'L-03', name: 'Wend 2', department: 'HDPE', defaultProduct: 'HDPE Telecom Pipe', sortOrder: 3 },
  { id: 'L-04', name: 'Wend 1', department: 'HDPE', defaultProduct: 'HDPE Telecom Pipe', sortOrder: 4 },
  { id: 'L-05', name: 'Beier 1', department: 'PPR', defaultProduct: 'PPR Extrusion', sortOrder: 5 },
  { id: 'L-06', name: 'Duct 1', department: 'PVC', defaultProduct: 'PVC Duct', sortOrder: 6 },
  { id: 'L-07', name: 'Sheeting 1', department: 'Sheeting', defaultProduct: 'Sheet Extrusion', sortOrder: 7 },
  { id: 'L-08', name: 'Duct 2', department: 'PVC', defaultProduct: 'PVC Duct', sortOrder: 8 },
  { id: 'L-09', name: 'Sheeting 2', department: 'Sheeting', defaultProduct: 'Sheet Extrusion', sortOrder: 9 },
  { id: 'L-10', name: 'COD', department: 'HDPE', defaultProduct: 'Corrugated Duct', sortOrder: 10 },
  { id: 'L-11', name: 'Tongda', department: 'PVC', defaultProduct: 'PVC Pipe', sortOrder: 11 },
  { id: 'L-12', name: 'DWC', department: 'DWC', defaultProduct: 'Double Wall Corrugated Pipe', sortOrder: 12 },
  { id: 'L-13', name: 'Crusher', department: 'Crusher', defaultProduct: 'Crushing / Support', sortOrder: 13 }
];

function defaultState() {
  return {
    planStartDate: new Date().toISOString().slice(0, 10),
    settings: {
      companyWorkers: 20,
      currentAgency: 35,
      requestNoticeDays: 3,
      releaseNoticeDays: 3,
      crusherMode: 'floating',
      crusherWorkers: 2,
      floatingLimit: 2,
      minReleaseDuration: 3,
      planDays: 14
    },
    machines: DEFAULT_MACHINES.map(machine => ({ ...machine })),
    plans: Object.fromEntries(DEFAULT_MACHINES.map(machine => [machine.id, []]))
  };
}

function parsePayload(row) {
  if (!row || !row.data) return null;
  if (typeof row.data === 'object') return row.data;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function isLegacyPlaceholderState(state) {
  if (!state || !Array.isArray(state.machines) || state.machines.length !== 2) return false;
  const ids = state.machines.map(machine => String(machine.id)).sort();
  if (ids[0] !== 'M1' || ids[1] !== 'M2') return false;
  return ids.every(id => !Array.isArray(state.plans?.[id]) || state.plans[id].length === 0);
}

const repository = {
  async getState() {
    const [rows] = await pool.query('SELECT data FROM app_state WHERE id = 1');
    const parsed = rows.length ? parsePayload(rows[0]) : null;
    if (!parsed || !Array.isArray(parsed.machines)) {
      const initial = defaultState();
      await this.saveDraft(initial);
      return initial;
    }
    if (isLegacyPlaceholderState(parsed)) {
      const migrated = defaultState();
      migrated.planStartDate = parsed.planStartDate || migrated.planStartDate;
      migrated.settings = { ...migrated.settings, ...(parsed.settings || {}) };
      await this.saveDraft(migrated);
      return migrated;
    }
    return parsed;
  },

  async saveDraft(state) {
    const json = JSON.stringify(state);
    await pool.query(
      'INSERT INTO app_state (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      [json]
    );
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
    const [columnRows] = await pool.query('SHOW COLUMNS FROM history');
    const columns = new Set(columnRows.map(column => String(column.Field || column.COLUMN_NAME || '').toLowerCase()));
    if (!columns.has('data')) {
      throw new Error('The history table must contain a data column');
    }

    // Existing Hostinger databases may use the original minimal history table
    // (id, data, created_at). New installations also store searchable metadata.
    const insertColumns = [];
    const values = [];
    if (columns.has('snapshot_id')) {
      insertColumns.push('snapshot_id');
      values.push(snapshot.id);
    }
    if (columns.has('published_at')) {
      insertColumns.push('published_at');
      values.push(new Date());
    }
    insertColumns.push('data');
    values.push(json);

    await pool.query(
      `INSERT INTO history (${insertColumns.join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`,
      values
    );
    return snapshot;
  },

  async getHistory(limit = 30) {
    const [rows] = await pool.query('SELECT data FROM history ORDER BY id DESC LIMIT ?', [Number(limit) || 30]);
    return rows.map(parsePayload).filter(Boolean);
  }
};

module.exports = repository;
