const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config            = require('../config.json');
const verificationStore = require('../verificationStore');
const roleSync          = require('../roleSync');
const logger            = require('../logger');

const SEP = '\n――――――――――――――――――――\n';

function canUse(member) {
    if (config.adminUsers?.includes(member.user.id)) return true;
    return [config.roles.president, config.roles.secretaryOfState, config.roles.governmentOfficial]
        .filter(Boolean)
        .some(r => member.roles.cache.has(r));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unverify')
        .setDescription('Quitar verificación y roles (admin) / Remove verification & roles (admin)')
        .addUserOption(opt =>
            opt.setName('user').setDescription('Usuario a desverificar / User to unverify').setRequired(true))
        .addStringOption(opt =>
            opt.setName('reason').setDescription('Razón / Reason').setRequired(false)),

    async execute(interaction) {
        if (!canUse(interaction.member)) {
            return interaction.reply({ content: `No tenés permisos para usar este comando.${SEP}You do not have permission to use this command.`, flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const targetUser = interaction.options.getUser('user');
        const reason     = interaction.options.getString('reason') ?? 'No se indicó razón / No reason provided';

        if (!await verificationStore.isVerified(targetUser.id)) {
            return interaction.editReply(`<@${targetUser.id}> no está verificado.${SEP}<@${targetUser.id}> is not verified.`);
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
            .setTitle('Verificación Eliminada / Verification Removed')
            .setColor(0xED4245)
            .addFields(
                { name: 'Discord',                    value: `<@${targetUser.id}>`,       inline: true },
                { name: 'Era / Was',                   value: record.gameUsername,          inline: true },
                { name: 'Estado / Status',             value: record.immigrationStatus,     inline: true },
                { name: 'Eliminado por / Removed by',  value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Razón / Reason',              value: reason,                       inline: false },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info('UNVERIFY', `${targetUser.tag} unverified by ${interaction.user.tag} — ${reason}`);
    }
};
