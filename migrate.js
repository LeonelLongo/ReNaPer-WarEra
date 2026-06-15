/**
 * PostgreSQL schema migration.
 * Run once: node migrate.js
 * Safe to re-run (all statements use IF NOT EXISTS / DO NOTHING).
 */

const pool = require('./db');

const SCHEMA = `
-- Verified users
CREATE TABLE IF NOT EXISTS verifications (
    discord_id          TEXT PRIMARY KEY,
    game_user_id        TEXT NOT NULL,
    game_username       TEXT NOT NULL,
    country_id          TEXT,
    country_code        TEXT,
    country_name        TEXT,
    immigration_status  TEXT,
    sub_status          TEXT,
    build               TEXT,
    is_government       BOOLEAN DEFAULT FALSE,
    government_role     TEXT,
    mu_id               TEXT,
    job                 TEXT,
    company_roles       TEXT[]  DEFAULT '{}',
    verified_at         BIGINT,
    updated_at          BIGINT,
    approved_by         TEXT
);
CREATE INDEX IF NOT EXISTS verifications_game_user_id ON verifications(game_user_id);

-- Pending verification tickets
CREATE TABLE IF NOT EXISTS pending_verifications (
    discord_id          TEXT PRIMARY KEY,
    game_user_id        TEXT,
    game_username       TEXT,
    country_id          TEXT,
    country_code        TEXT,
    country_name        TEXT,
    ticket_channel_id   TEXT,
    channel_slug        TEXT,
    challenge_code           TEXT,
    challenge_code_issued_at BIGINT,
    requested_at             BIGINT
);

-- Diplomacy (relations with other countries)
CREATE TABLE IF NOT EXISTS diplomacy (
    country_id  TEXT PRIMARY KEY,
    status      TEXT    NOT NULL DEFAULT 'neutral',
    set_by      TEXT,
    updated_at  BIGINT
);

-- Key-value store
CREATE TABLE IF NOT EXISTS kv_store (
    key   TEXT PRIMARY KEY,
    value TEXT
);

INSERT INTO kv_store(key, value) VALUES
    ('port_of_entry_msg', NULL)
ON CONFLICT DO NOTHING;
`;

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('[MIGRATE] Running schema migration...');
        await client.query(SCHEMA);
        console.log('[MIGRATE] Done.');
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error('[MIGRATE] Error:', err.message);
    process.exit(1);
});
