const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config              = require('../config.json');
const verificationFlow    = require('../verificationFlow');
const verificationStore   = require('../verificationStore');
const roleSync            = require('../roleSync');
const roleLogger          = require('../roleLogger');
const immigrationResolver = require('../immigrationResolver');
const logger              = require('../logger');

function canUse(member) {
    if (config.adminUsers?.includes(member.user.id)) return true;
    return !!config.roles.governmentOfficial && member.roles.cache.has(config.roles.governmentOfficial);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('manualverify')
        .setDescription('Manually verify a user, bypassing the ticket system (admin only)')
        .addUserOption(opt =>
            opt.setName('user').setDescription('Discord user to verify').setRequired(true))
        .addStringOption(opt =>
            opt.setName('profile').setDescription('In-game username, ID, or profile URL').setRequired(true))
        .addStringOption(opt =>
            opt.setName('status')
                .setDescription('Override immigration status (default: auto-detect)')
                .setRequired(false)
                .addChoices(
                    { name: 'Citizen',          value: 'citizen' },
                    { name: 'Green Card Holder', value: 'greenCardHolder' },
                    { name: 'Diplomat',          value: 'diplomat' },
                    { name: 'Visitor Visa',      value: 'visitorVisa' },
                    { name: 'Deportee',          value: 'deportee' },
                )),

    async execute(interaction) {
        if (!canUse(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const targetUser     = interaction.options.getUser('user');
        const profileInput   = interaction.options.getString('profile');
        const statusOverride = interaction.options.getString('status');

        if (await verificationStore.isVerified(targetUser.id)) {
            const existing = await verificationStore.get(targetUser.id);
            return interaction.editReply(`<@${targetUser.id}> is already verified as **${existing.gameUsername}**. Use /unverify first.`);
        }

        const data = await verificationFlow.lookupProfile(profileInput);
        if (!data) return interaction.editReply('Could not find that game profile.');

        const { profile, country, countryId } = data;

        const dupe = await verificationStore.findByGameId(profile._id);
        if (dupe) return interaction.editReply(`This game account is already linked to <@${dupe[0]}>.`);

        let { immigrationStatus, subStatus } = data;
        if (statusOverride) {
            const overrideMap = {
                citizen:         { immigrationStatus: 'citizen',   subStatus: null },
                greenCardHolder: { immigrationStatus: 'foreigner', subStatus: 'greenCardHolder' },
                diplomat:        { immigrationStatus: 'foreigner', subStatus: 'diplomat' },
                visitorVisa:     { immigrationStatus: 'foreigner', subStatus: 'visitorVisa' },
                deportee:        { immigrationStatus: 'hostile',   subStatus: 'deportee' },
            };
            ({ immigrationStatus, subStatus } = overrideMap[statusOverride]);
        }

        const govRole = immigrationResolver.resolveGovRole(data.govPosition, countryId);

        const record = {
            gameUserId:        profile._id,
            gameUsername:      profile.username,
            countryId,
            countryCode:       country?.code ?? '',
            countryName:       country?.name ?? 'Unknown',
            immigrationStatus,
            subStatus,
            build:             data.build,
            isGovernment:      !!govRole,
            governmentRole:    govRole,
            muId:              profile.mu ?? null,
            job:               'unemployed',
            companyRoles:      [],
            verifiedAt:        Date.now(),
            approvedBy:        interaction.user.id,
        };

        await verificationStore.set(targetUser.id, record);

        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            roleLogger.pendingReasons.set(member.id, { reason: 'Manual verification', actor: `<@${interaction.user.id}>` });
            await roleSync.sync(member, record);
            await member.setNickname(profile.username, 'Manual verification').catch(() => {});
        } catch (err) {
            logger.error('MANUALVERIFY', `Role sync failed for ${targetUser.id}: ${err.message}`);
            return interaction.editReply(`Verified and saved, but role assignment failed: ${err.message}`);
        }

        const f = verificationFlow.flag(country?.code);

        const embed = new EmbedBuilder()
            .setTitle('Manual Verification Complete')
            .setColor(0x2ECC71)
            .setThumbnail(profile.avatarUrl || null)
            .addFields(
                { name: 'Discord',  value: `<@${targetUser.id}>`,       inline: true },
                { name: 'In-Game',  value: profile.username,             inline: true },
                { name: 'Country',  value: `${f} ${country?.name ?? 'Unknown'}`, inline: true },
                { name: 'Status',   value: `${immigrationStatus}${subStatus ? ` / ${subStatus}` : ''}`, inline: true },
                { name: 'Build',    value: data.build ?? 'Unclassified', inline: true },
                { name: 'Approved', value: `<@${interaction.user.id}>`, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info('MANUALVERIFY', `${targetUser.tag} verified as ${immigrationStatus} by ${interaction.user.tag}`);
    }
};
