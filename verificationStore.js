const pool = require('./db');

function rowToVerified(row) {
    if (!row) return null;
    return {
        gameUserId:        row.game_user_id,
        gameUsername:      row.game_username,
        countryId:         row.country_id,
        countryCode:       row.country_code,
        countryName:       row.country_name,
        immigrationStatus: row.immigration_status,
        subStatus:         row.sub_status,
        build:             row.build,
        isGovernment:      row.is_government,
        governmentRole:    row.government_role,
        muId:              row.mu_id,
        job:               row.job,
        companyRoles:      row.company_roles ?? [],
        verifiedAt:        row.verified_at   ? Number(row.verified_at)  : null,
        updatedAt:         row.updated_at    ? Number(row.updated_at)   : null,
        approvedBy:        row.approved_by,
    };
}

function rowToPending(row) {
    if (!row) return null;
    return {
        gameUserId:       row.game_user_id,
        gameUsername:     row.game_username,
        countryId:        row.country_id,
        countryCode:      row.country_code,
        countryName:      row.country_name,
        ticketChannelId:  row.ticket_channel_id,
        channelSlug:      row.channel_slug,
        challengeCode:         row.challenge_code,
        challengeCodeIssuedAt: row.challenge_code_issued_at ? Number(row.challenge_code_issued_at) : null,
        requestedAt:           row.requested_at ? Number(row.requested_at) : null,
    };
}

// Verified
async function isVerified(discordId) {
    const { rows } = await pool.query('SELECT 1 FROM verifications WHERE discord_id=$1', [discordId]);
    return rows.length > 0;
}

async function get(discordId) {
    const { rows } = await pool.query('SELECT * FROM verifications WHERE discord_id=$1', [discordId]);
    return rowToVerified(rows[0]) ?? null;
}

async function getByGameId(gameUserId) {
    const { rows } = await pool.query('SELECT * FROM verifications WHERE game_user_id=$1 LIMIT 1', [gameUserId]);
    if (!rows[0]) return null;
    return [rows[0].discord_id, rowToVerified(rows[0])];
}

const findByGameId = getByGameId;

async function getAll() {
    const { rows } = await pool.query('SELECT * FROM verifications');
    return rows.map(r => ({ discordId: r.discord_id, ...rowToVerified(r) }));
}

async function set(discordId, record) {
    const r = record;
    await pool.query(`
        INSERT INTO verifications
            (discord_id, game_user_id, game_username, country_id, country_code, country_name,
             immigration_status, sub_status, build, is_government, government_role,
             mu_id, job, company_roles, verified_at, updated_at, approved_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (discord_id) DO UPDATE SET
            game_user_id=EXCLUDED.game_user_id, game_username=EXCLUDED.game_username,
            country_id=EXCLUDED.country_id, country_code=EXCLUDED.country_code,
            country_name=EXCLUDED.country_name, immigration_status=EXCLUDED.immigration_status,
            sub_status=EXCLUDED.sub_status, build=EXCLUDED.build,
            is_government=EXCLUDED.is_government, government_role=EXCLUDED.government_role,
            mu_id=EXCLUDED.mu_id, job=EXCLUDED.job, company_roles=EXCLUDED.company_roles,
            verified_at=EXCLUDED.verified_at, updated_at=EXCLUDED.updated_at,
            approved_by=EXCLUDED.approved_by
    `, [
        discordId,
        r.gameUserId        ?? null,
        r.gameUsername      ?? null,
        r.countryId         ?? null,
        r.countryCode       ?? null,
        r.countryName       ?? null,
        r.immigrationStatus ?? null,
        r.subStatus         ?? null,
        r.build             ?? null,
        r.isGovernment      ?? false,
        r.governmentRole    ?? null,
        r.muId              ?? null,
        r.job               ?? null,
        r.companyRoles      ?? [],
        r.verifiedAt        ?? null,
        Date.now(),
        r.approvedBy        ?? null,
    ]);
}

async function update(discordId, fields) {
    const current = await get(discordId);
    if (!current) return false;
    await set(discordId, { ...current, ...fields });
    return true;
}

async function remove(discordId) {
    const { rowCount } = await pool.query('DELETE FROM verifications WHERE discord_id=$1', [discordId]);
    return rowCount > 0;
}

// Pending
async function getPending(discordId) {
    const { rows } = await pool.query('SELECT * FROM pending_verifications WHERE discord_id=$1', [discordId]);
    return rowToPending(rows[0]) ?? null;
}

async function getAllPending() {
    const { rows } = await pool.query('SELECT * FROM pending_verifications');
    return rows.map(r => ({ discordId: r.discord_id, ...rowToPending(r) }));
}

async function setPending(discordId, record) {
    const r = record;
    await pool.query(`
        INSERT INTO pending_verifications
            (discord_id, game_user_id, game_username, country_id, country_code, country_name,
             ticket_channel_id, channel_slug, challenge_code, challenge_code_issued_at, requested_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (discord_id) DO UPDATE SET
            game_user_id=EXCLUDED.game_user_id, game_username=EXCLUDED.game_username,
            country_id=EXCLUDED.country_id, country_code=EXCLUDED.country_code,
            country_name=EXCLUDED.country_name, ticket_channel_id=EXCLUDED.ticket_channel_id,
            channel_slug=EXCLUDED.channel_slug, challenge_code=EXCLUDED.challenge_code,
            challenge_code_issued_at=EXCLUDED.challenge_code_issued_at,
            requested_at=EXCLUDED.requested_at
    `, [
        discordId,
        r.gameUserId             ?? null,
        r.gameUsername           ?? null,
        r.countryId              ?? null,
        r.countryCode            ?? null,
        r.countryName            ?? null,
        r.ticketChannelId        ?? null,
        r.channelSlug            ?? null,
        r.challengeCode          ?? null,
        r.challengeCodeIssuedAt  ?? null,
        r.requestedAt            ?? Date.now(),
    ]);
}

async function updatePending(discordId, patch) {
    const current = await getPending(discordId);
    if (!current) return false;
    await setPending(discordId, { ...current, ...patch });
    return true;
}

async function removePending(discordId) {
    const { rowCount } = await pool.query('DELETE FROM pending_verifications WHERE discord_id=$1', [discordId]);
    return rowCount > 0;
}

module.exports = {
    isVerified, get, getByGameId, findByGameId, getAll,
    set, update, remove,
    getPending, getAllPending, setPending, updatePending, removePending,
};
