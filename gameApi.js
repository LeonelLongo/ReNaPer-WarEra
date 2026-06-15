const logger = require('./logger');

const BASE_URL = 'https://api2.warera.io/trpc';
const API_KEY  = 'wae_8e397114bdb0234c319f7133362a3737fe21fe6f73b195ac255b87fabd3c2cce';

const cache = new Map();

async function call(endpoint, params = {}, cacheTtlMs = 0) {
    const cacheKey = `${endpoint}:${JSON.stringify(params)}`;

    if (cacheTtlMs > 0) {
        const cached = cache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) return cached.data;
    }

    try {
        const res = await fetch(`${BASE_URL}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify(params)
        });

        const json = await res.json();

        if (json.error) {
            logger.warn('API', `${endpoint} -> ${json.error.message}`);
            return null;
        }

        const data = json?.result?.data ?? null;

        if (cacheTtlMs > 0 && data !== null) {
            cache.set(cacheKey, { data, expiresAt: Date.now() + cacheTtlMs });
        }

        return data;
    } catch (err) {
        logger.error('API', `${endpoint} failed: ${err.message}`);
        return null;
    }
}

const CACHE_6H = 6 * 60 * 60 * 1000;
const CACHE_5M = 5 * 60 * 1000;

module.exports = {
    getUser:          (userId) => call('user.getUserLite', { userId }),
    getCountry:       (countryId) => call('country.getCountryById', { countryId }, CACHE_6H),
    getGovernment:    (countryId) => call('government.getByCountryId', { countryId }, CACHE_5M),
    getMU:            (muId) => call('mu.getById', { muId }),
    getCompanyIds:    (userId) => call('company.getCompanies', { userId, perPage: 20 }),
    getCompany:       (companyId) => call('company.getById', { companyId }),
    search:           (searchText) => call('search.searchAnything', { searchText }),
    raw: call
};
