const logger = require('./logger');

const handlers = new Map();

function register(prefix, handler) {
    handlers.set(prefix, handler);
}

async function handle(interaction) {
    const id = interaction.customId;

    for (const [prefix, handler] of handlers) {
        const matched =
            id === prefix ||
            ((prefix.endsWith(':') || prefix.endsWith('_')) && id.startsWith(prefix)) ||
            id.startsWith(prefix + ':') ||
            id.startsWith(prefix + '_');

        if (matched) {
            await handler(interaction);
            return;
        }
    }

    logger.warn('BUTTON', `No handler for customId: ${id}`);
}

module.exports = { handle, register };
