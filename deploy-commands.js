const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const logger = require('./logger');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command?.data?.toJSON) {
        commands.push(command.data.toJSON());
        logger.info('DEPLOY', `Loaded command: ${command.data.name}`);
    }
}

const rest = new REST().setToken(config.token);

(async () => {
    try {
        logger.info('DEPLOY', `Registering ${commands.length} slash command(s)...`);
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
        logger.info('DEPLOY', 'Slash commands registered successfully.');
    } catch (err) {
        logger.error('DEPLOY', err.message);
    }
})();
