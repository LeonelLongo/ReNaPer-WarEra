const pool = require('./db');

const STATUSES = ['ally', 'nap', 'neutral', 'rival', 'war', 'territory'];
const HOSTILE_STATUSES = new Set(['war', 'rival']);

async function getAll() {
    const { rows } = await pool.query('SELECT * FROM diplomacy');
    const result = {};
    for (const r of rows) {
        result[r.country_id] = { status: r.status, setBy: r.set_by, updatedAt: r.updated_at ? Number(r.updated_at) : null };
    }
    return result;
}

async function get(countryId) {
    const { rows } = await pool.query('SELECT * FROM diplomacy WHERE country_id=$1', [String(countryId)]);
    if (!rows[0]) return null;
    return { status: rows[0].status, setBy: rows[0].set_by, updatedAt: rows[0].updated_at ? Number(rows[0].updated_at) : null };
}

async function statusOf(countryId) {
    const entry = await get(countryId);
    return entry?.status ?? 'neutral';
}

async function set(countryId, status, setBy) {
    if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
    await pool.query(
        `INSERT INTO diplomacy (country_id, status, set_by, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (country_id) DO UPDATE SET status=EXCLUDED.status, set_by=EXCLUDED.set_by, updated_at=EXCLUDED.updated_at`,
        [String(countryId), status, setBy ?? null, Date.now()]
    );
}

async function remove(countryId) {
    await pool.query('DELETE FROM diplomacy WHERE country_id=$1', [String(countryId)]);
}

module.exports = { STATUSES, HOSTILE_STATUSES, getAll, get, statusOf, set, remove };
