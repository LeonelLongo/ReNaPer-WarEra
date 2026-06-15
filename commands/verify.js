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
            return interaction.editReply('You are already verified.');
        }

        const pending = await verificationStore.getPending(interaction.user.id);
        if (pending?.ticketChannelId) {
            const ch = interaction.guild.channels.cache.get(pending.ticketChannelId);
            if (ch) return interaction.editReply(`You already have an open application: ${ch}`);
            await verificationStore.removePending(interaction.user.id);
        }

        const profileInput = interaction.options.getString('profile');
        const data = await verificationFlow.lookupProfile(profileInput);
        if (!data) {
            return interaction.editReply('Could not find that game profile. Double-check your username, ID, or URL.');
        }

        const dupe = await verificationStore.findByGameId(data.profile._id);
        if (dupe) {
            return interaction.editReply('That game account is already linked to another Discord user.');
        }

        try {
            const ticket = await verificationFlow.openTicket(interaction.guild, interaction.member, data);
            return interaction.editReply(`Your application has been submitted. Please go to ${ticket.channel} to complete the process.`);
        } catch (err) {
            logger.error('VERIFY', `Failed to open ticket for ${interaction.user.id}: ${err.message}`);
            return interaction.editReply('Something went wrong while opening your ticket. Please try again.');
        }
    }
};
