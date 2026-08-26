const pool = require('./db');

class MySQLRepository {
  async getState() {
    const [rows] = await pool.query('SELECT data FROM app_state WHERE id = ?', ['current_state']);
    if (!rows.length) {
      return null;
    }
    return typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
  }

  async saveDraft(draft) {
    const currentState = await this.getState() || {};
    const updatedState = { ...currentState, ...draft };
    const serialized = JSON.stringify(updatedState);

    await pool.query(
      'INSERT INTO app_state (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?',
      ['current_state', serialized, serialized]
    );

    return updatedState;
  }

  async publish(snapshotBuilder) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query('SELECT data FROM app_state WHERE id = ? FOR UPDATE', ['current_state']);
      if (!rows.length) {
        throw new Error('No state found to publish');
      }

      const state = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      const published = snapshotBuilder(state);
      state.published = published;

      const serializedState = JSON.stringify(state);
      const serializedPublished = JSON.stringify(published);

      await connection.query('UPDATE app_state SET data = ? WHERE id = ?', [serializedState, 'current_state']);
      await connection.query(
        'INSERT INTO history (id, published_at, data) VALUES (?, ?, ?)',
        [published.id, published.publishedAt, serializedPublished]
      );

      await connection.commit();
      return published;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getPublished() {
    const state = await this.getState();
    if (!state || !state.published) {
      return null;
    }
    return state.published;
  }

  async getHistory(limit = 30) {
    const [rows] = await pool.query(
      'SELECT data FROM history ORDER BY created_at DESC LIMIT ?',
      [Number(limit)]
    );
    return rows.map(row => (typeof row.data === 'string' ? JSON.parse(row.data) : row.data));
  }
}

module.exports = new MySQLRepository();