const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config            = require('../config.json');
const verificationStore = require('../verificationStore');
const roleSync          = require('../roleSync');
const logger            = require('../logger');

function canUse(member) {
    if (config.adminUsers?.includes(member.user.id)) return true;
    return [config.roles.president, config.roles.secretaryOfState, config.roles.governmentOfficial]
        .filter(Boolean)
        .some(r => member.roles.cache.has(r));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unverify')
        .setDescription('Remove a user\'s verification and strip their roles (admin only)')
        .addUserOption(opt =>
            opt.setName('user').setDescription('Discord user to unverify').setRequired(true))
        .addStringOption(opt =>
            opt.setName('reason').setDescription('Reason for removal').setRequired(false)),

    async execute(interaction) {
        if (!canUse(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const targetUser = interaction.options.getUser('user');
        const reason     = interaction.options.getString('reason') ?? 'No reason provided';

        if (!await verificationStore.isVerified(targetUser.id)) {
            return interaction.editReply(`<@${targetUser.id}> is not verified.`);
        }

        const record = await verificationStore.get(targetUser.id);
        await verificationStore.remove(targetUser.id);
        await verificationStore.removePending(targetUser.id);

        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            await roleSync.strip(member);
            if (config.roles.unverified) {
                await member.roles.add(config.roles.unverified, 'Unverified').catch(() => {});
            }
        } catch (err) {
            logger.warn('UNVERIFY', `Could not update roles for ${targetUser.id}: ${err.message}`);
        }

        const embed = new EmbedBuilder()
            .setTitle('Verification Removed')
            .setColor(0xED4245)
            .addFields(
                { name: 'Discord',    value: `<@${targetUser.id}>`,       inline: true },
                { name: 'Was',        value: record.gameUsername,          inline: true },
                { name: 'Status',     value: record.immigrationStatus,     inline: true },
                { name: 'Removed By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Reason',     value: reason,                       inline: false },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info('UNVERIFY', `${targetUser.tag} unverified by ${interaction.user.tag} — ${reason}`);
    }
};
