const { SlashCommandBuilder } = require('discord.js');
const verificationStore = require('../verificationStore');
const verificationFlow  = require('../verificationFlow');
const logger            = require('../logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Submit your in-game identity to begin an immigration application')
        .addStringOption(opt =>
            opt.setName('profile')
                .setDescription('In-game username, player ID, or profile URL')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        if (await verificationStore.isVerified(interaction.user.id)) {
            return interaction.editReply('Ya estás verificado.');
        }

        const pending = await verificationStore.getPending(interaction.user.id);
        if (pending?.ticketChannelId) {
            const ch = interaction.guild.channels.cache.get(pending.ticketChannelId);
            if (ch) return interaction.editReply(`Ya tenés una solicitud abierta: ${ch}`);
            await verificationStore.removePending(interaction.user.id);
        }

        const profileInput = interaction.options.getString('profile');
        const data = await verificationFlow.lookupProfile(profileInput);
        if (!data) {
            return interaction.editReply('No se encontró ese perfil del juego. Revisá tu usuario, ID o URL.');
        }

        const dupe = await verificationStore.findByGameId(data.profile._id);
        if (dupe) {
            return interaction.editReply('Esa cuenta del juego ya está vinculada a otro usuario de Discord.');
        }

        try {
            const ticket = await verificationFlow.openTicket(interaction.guild, interaction.member, data);
            return interaction.editReply(`Tu solicitud fue enviada. Por favor dirigite a ${ticket.channel} para completar el proceso.`);
        } catch (err) {
            logger.error('VERIFY', `Failed to open ticket for ${interaction.user.id}: ${err.message}`);
            return interaction.editReply('Algo salió mal al abrir tu ticket. Por favor intentá de nuevo.');
        }
    }
};
