const { Client, GatewayIntentBits, Collection, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs     = require('fs');
const path   = require('path');
const config = require('./config.json');
const pool   = require('./db');
const logger = require('./logger');
const roleLogger          = require('./roleLogger');
const verificationButtons = require('./verificationButtons');
const buttonHandlers      = require('./buttonHandlers');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Init audit logger
roleLogger.init(client);

// Register button handlers
verificationButtons.register(buttonHandlers);

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command?.data && command?.execute) {
        client.commands.set(command.data.name, command);
        logger.info('BOOT', `Loaded command: ${command.data.name}`);
    }
}

// Interaction handler
client.on(Events.InteractionCreate, async interaction => {
    // Slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (err) {
            logger.error('CMD', `/${interaction.commandName} — ${err.message}`);
            const msg = { content: 'An error occurred while running this command.', flags: 64 };
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(msg).catch(() => {});
            } else {
                await interaction.reply(msg).catch(() => {});
            }
        }
        return;
    }

    // Autocomplete
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command?.autocomplete) {
            await command.autocomplete(interaction).catch(err =>
                logger.error('AUTOCOMPLETE', `/${interaction.commandName} — ${err.message}`)
            );
        }
        return;
    }

    // Buttons
    if (interaction.isButton()) {
        try { await buttonHandlers.handle(interaction); }
        catch (err) { logger.error('BUTTON', `${interaction.customId} — ${err.message}`); }
        return;
    }

    // Select menus
    if (interaction.isStringSelectMenu()) {
        try { await buttonHandlers.handle(interaction); }
        catch (err) { logger.error('SELECT', `${interaction.customId} — ${err.message}`); }
        return;
    }

    // Modal submits
    if (interaction.isModalSubmit()) {
        try { await buttonHandlers.handle(interaction); }
        catch (err) { logger.error('MODAL', `${interaction.customId} — ${err.message}`); }
        return;
    }
});

// ── Port of Entry ────────────────────────────────────────────────────────────

async function loadPoeState() {
    const { rows } = await pool.query(`SELECT value FROM kv_store WHERE key='port_of_entry_msg'`);
    return { messageId: rows[0]?.value ?? null };
}

async function savePoeState(state) {
    await pool.query(
        `INSERT INTO kv_store(key,value) VALUES('port_of_entry_msg',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
        [state.messageId ?? null]
    );
}

async function ensurePortOfEntryEmbed() {
    const channelId = config.channels?.portOfEntry;
    if (!channelId) return;

    const channel = client.channels.cache.get(channelId);
    if (!channel) { logger.warn('POE', `portOfEntry channel ${channelId} not in cache.`); return; }

    const embed = new EmbedBuilder()
        .setTitle('Welcome to Argentina')
        .setColor(0x74ACDF)
        .setDescription(
            'To gain access to this server you must identify yourself.\n\n' +
            '**Click the button below to begin your immigration application.**\n\n' +
            'Have your WarEra username, player ID, or profile link ready.'
        )
        .setFooter({ text: 'Immigration Services' })
        .setTimestamp();

    const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('portofentry_apply')
            .setLabel('Apply for Entry')
            .setStyle(ButtonStyle.Primary)
    );

    try {
        const state = await loadPoeState();
        const existing = state.messageId
            ? await channel.messages.fetch(state.messageId).catch(() => null)
            : null;

        if (existing) {
            await existing.edit({ embeds: [embed], components: [button] });
            logger.info('POE', `Port of Entry embed refreshed (${existing.id}).`);
        } else {
            const msg = await channel.send({ embeds: [embed], components: [button] });
            await savePoeState({ messageId: msg.id });
            logger.info('POE', `Port of Entry embed posted (${msg.id}).`);
        }
    } catch (err) {
        logger.error('POE', `Failed to post/refresh Port of Entry embed: ${err.message}`);
    }
}

// ── Ready ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async () => {
    logger.info('BOOT', `Logged in as ${client.user.tag}`);
    logger.info('BOOT', 'Bot is ready.');

    // Logs channel
    const logsChannel = client.channels.cache.get(config.channels?.logs);
    if (logsChannel) {
        logger.setChannel(logsChannel);
        logger.info('BOOT', 'Discord log forwarding active.');
    }

    // Port of Entry
    await ensurePortOfEntryEmbed();

    // Recover pending challenge timeouts
    const guild = client.guilds.cache.first();
    if (guild) {
        verificationButtons.recoverChallengeTimeouts(guild).catch(err =>
            logger.error('VF', `Timeout recovery failed: ${err.message}`)
        );
    }
});

client.login(config.token).catch(err => {
    logger.error('BOOT', `Login failed: ${err.message}`);
    process.exit(1);
});
