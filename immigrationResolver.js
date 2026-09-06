const diplomacyStore = require('./diplomacyStore');

const HOSTILE_STATUSES = new Set(['war', 'rival']);

/**
 * Determines the suggested immigration status for a player
 * based on their in-game country relative to Lithuania.
 */
async function resolve(countryId, isInOwnGov = false) {
    // Lithuanian citizen
    if (countryId === process.env.WARERA_COUNTRY_ID) {
        return { immigrationStatus: 'citizen', subStatus: null };
    }

    // Check diplomacy for hostile
    let diplomacyStatus = 'neutral';
    try {
        diplomacyStatus = await diplomacyStore.statusOf(countryId) ?? 'neutral';
    } catch { /* ignore */ }

    if (HOSTILE_STATUSES.has(diplomacyStatus)) {
        return { immigrationStatus: 'hostile', subStatus: 'deportee' };
    }

    if (diplomacyStatus === 'territory') {
        return { immigrationStatus: 'foreigner', subStatus: 'greenCardHolder' };
    }

    const subStatus = isInOwnGov ? 'diplomat' : 'visitorVisa';
    return { immigrationStatus: 'foreigner', subStatus };
}

/**
 * Maps a game government position string to the config role key.
 * Only returns a role if the player is in THIS nation's government.
 */
function resolveGovRole(position, countryId) {
    if (countryId !== process.env.WARERA_COUNTRY_ID || !position) return null;

    const map = {
        'President':                   'president',
        'Vice President':              'vicePresident',
        'Minister of Foreign Affairs': 'secretaryOfState',
        'Minister of Defense':         'secretaryOfDefense',
        'Minister of Economy':         'secretaryOfTreasury',
        'Congress Member':             'congress',
    };

    return map[position] || null;
}

module.exports = { resolve, resolveGovRole };
