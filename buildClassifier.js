// Build classification — 80% threshold rule.
// War skills:  attack, precision, criticalChance, criticalDamages, armor, dodge, health, lootChance, hunger
// Econ skills: entrepreneurship, energy, production, companies, management

const WAR_SKILLS  = new Set(['attack', 'precision', 'criticalChance', 'criticalDamages', 'armor', 'dodge', 'health', 'lootChance', 'hunger']);
const ECON_SKILLS = new Set(['entrepreneurship', 'energy', 'production', 'companies', 'management']);

const THRESHOLD = 0.80;

function classify(skills) {
    if (!skills || typeof skills !== 'object') return null;

    let warPoints  = 0;
    let econPoints = 0;
    let totalPoints = 0;

    for (const [name, skill] of Object.entries(skills)) {
        const level = skill?.level ?? 0;
        if (level === 0) continue;
        if (WAR_SKILLS.has(name))       { warPoints  += level; totalPoints += level; }
        else if (ECON_SKILLS.has(name)) { econPoints += level; totalPoints += level; }
    }

    if (totalPoints === 0) return null;
    if (warPoints  / totalPoints >= THRESHOLD) return 'war';
    if (econPoints / totalPoints >= THRESHOLD) return 'econ';
    return null;
}

module.exports = { classify };
