const config = require('./config.json');
const logger = require('./logger');

// All role keys that roleSync manages
const MANAGED_ROLES = [
    'citizen', 'governmentOfficial', 'cabinet', 'congress',
    'president', 'vicePresident', 'secretaryOfState', 'secretaryOfDefense', 'secretaryOfTreasury',
    'greenCardHolder', 'diplomat', 'visitorVisa',
    'deportee',
    'warBuild', 'econBuild',
    'verified',
    'unverified',
];

const CABINET_ROLES = new Set(['vicePresident', 'secretaryOfState', 'secretaryOfDefense', 'secretaryOfTreasury']);

const SUB_STATUS_ROLE = {
    greenCardHolder: 'greenCardHolder',
    diplomat:        'diplomat',
    visitorVisa:     'visitorVisa',
    deportee:        'deportee',
};

const BUILD_ROLE = {
    war:  'warBuild',
    econ: 'econBuild',
};

const GOV_ROLE_KEYS = new Set([
    'president', 'vicePresident', 'secretaryOfState',
    'secretaryOfDefense', 'secretaryOfTreasury', 'congress',
]);

async function sync(member, record, reason = 'roleSync') {
    const toAdd    = new Set();
    const toRemove = new Set();

    for (const key of MANAGED_ROLES) {
        const roleId = config.roles[key];
        if (roleId && member.roles.cache.has(roleId)) {
            toRemove.add(roleId);
        }
    }

    if (record) {
        const { immigrationStatus, subStatus, build, isGovernment, governmentRole } = record;

        if (config.roles.verified) toAdd.add(config.roles.verified);

        if (immigrationStatus === 'citizen') {
            if (config.roles.citizen) toAdd.add(config.roles.citizen);

            const buildKey = BUILD_ROLE[build];
            if (buildKey && config.roles[buildKey]) toAdd.add(config.roles[buildKey]);

            if (isGovernment && governmentRole) {
                const govRoleId = config.roles[governmentRole];
                if (govRoleId) toAdd.add(govRoleId);
                if (config.roles.governmentOfficial) toAdd.add(config.roles.governmentOfficial);
                if (CABINET_ROLES.has(governmentRole) && config.roles.cabinet) {
                    toAdd.add(config.roles.cabinet);
                }
            }

        } else if (immigrationStatus === 'foreigner') {
            const subKey = SUB_STATUS_ROLE[subStatus];
            if (subKey && config.roles[subKey]) toAdd.add(config.roles[subKey]);

        } else if (immigrationStatus === 'hostile') {
            if (subStatus === 'deportee' && config.roles.deportee) {
                toAdd.add(config.roles.deportee);
            }
        }
    }

    const finalRemove = [...toRemove].filter(id => !toAdd.has(id));
    const finalAdd    = [...toAdd].filter(id => !member.roles.cache.has(id));

    try {
        if (finalRemove.length) await member.roles.remove(finalRemove, reason);
        if (finalAdd.length)    await member.roles.add(finalAdd, reason);
    } catch (err) {
        logger.error('ROLESYNC', `Failed for ${member.id}: ${err.message}`);
        throw err;
    }

    if (finalAdd.length || finalRemove.length) {
        logger.info('ROLESYNC', `${member.user.tag} — added: [${finalAdd}] removed: [${finalRemove}]`);
    }
}

async function strip(member) {
    return sync(member, null);
}

module.exports = { sync, strip };
