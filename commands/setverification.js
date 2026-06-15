'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config              = require('../config.json');
const verificationFlow    = require('../verificationFlow');
const verificationStore   = require('../verificationStore');
const roleSync            = require('../roleSync');
const roleLogger          = require('../roleLogger');
const immigrationResolver = require('../immigrationResolver');
const logger              = require('../logger');

const STATUS_MAP = {
    citizen:         { immigrationStatus: 'citizen',   subStatus: null },
    greenCardHolder: { immigrationStatus: 'foreigner', subStatus: 'greenCardHolder' },
    diplomat:        { immigrationStatus: 'foreigner', subStatus: 'diplomat' },
    visitorVisa:     { immigrationStatus: 'foreigner', subStatus: 'visitorVisa' },
    deportee:        { immigrationStatus: 'hostile',   subStatus: 'deportee' },
};

function canUse(member) {
    if (config.adminUsers?.includes(member.user.id)) return true;
    if (config.roles.cabinet && member.roles.cache.has(config.roles.cabinet)) return true;
    return false;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setverification')
        .setDescription('Update a member\'s verification record and roles (Cabinet only)')
        .addUserOption(opt =>
            opt.setName('user').setDescription('Discord user to update').setRequired(true))
        .addStringOption(opt =>
            opt.setName('profile').setDescription('In-game username, ID, or profile URL').setRequired(true))
        .addStringOption(opt =>
            opt.setName('role').setDescription('Immigration status to assign').setRequired(true)
                .addChoices(
                    { name: 'Citizen',          value: 'citizen' },
                    { name: 'Green Card Holder', value: 'greenCardHolder' },
                    { name: 'Diplomat',          value: 'diplomat' },
                    { name: 'Visitor Visa',      value: 'visitorVisa' },
                    { name: 'Deportee',          value: 'deportee' },
                ))
        .addStringOption(opt =>
            opt.setName('gov').setDescription('Is this user a government official?').setRequired(true)
                .addChoices(
                    { name: 'Yes', value: 'yes' },
                    { name: 'No',  value: 'no' },
                )),

    async execute(interaction) {
        if (!canUse(interaction.member)) {
            return interaction.reply({ content: 'Cabinet only.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const targetUser   = interaction.options.getUser('user');
        const profileInput = interaction.options.getString('profile');
        const roleChoice   = interaction.options.getString('role');
        const govChoice    = interaction.options.getString('gov') === 'yes';

        const data = await verificationFlow.lookupProfile(profileInput);
        if (!data) return interaction.editReply('Could not find that game profile.');

        const { profile, country, countryId } = data;
        const { immigrationStatus, subStatus } = STATUS_MAP[roleChoice];

        let govRole = null;
        let isGovernment = false;
        if (govChoice && immigrationStatus === 'citizen') {
            govRole = immigrationResolver.resolveGovRole(data.govPosition, countryId);
            isGovernment = true;
        }

        const record = {
            gameUserId:        profile._id,
            gameUsername:      profile.username,
            countryId,
            countryCode:       country?.code ?? '',
            countryName:       country?.name ?? 'Unknown',
            immigrationStatus,
            subStatus,
            build:             data.build,
            isGovernment,
            governmentRole:    govRole,
            muId:              profile.mu ?? null,
            job:               'unemployed',
            companyRoles:      [],
            verifiedAt:        Date.now(),
            approvedBy:        interaction.user.id,
        };

        await verificationStore.set(targetUser.id, record);
        await verificationStore.removePending(targetUser.id).catch(() => {});

        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            roleLogger.pendingReasons.set(member.id, { reason: 'setverification override', actor: `<@${interaction.user.id}>` });
            await roleSync.sync(member, record);
            await member.setNickname(profile.username, 'setverification override').catch(() => {});
            if (config.roles.unverified && member.roles.cache.has(config.roles.unverified)) {
                await member.roles.remove(config.roles.unverified).catch(() => {});
            }
        } catch (err) {
            logger.error('SETVERIFY', `Role sync failed for ${targetUser.id}: ${err.message}`);
            return interaction.editReply(`Record saved but role sync failed: ${err.message}`);
        }

        const f = verificationFlow.flag(country?.code);

        const embed = new EmbedBuilder()
            .setTitle('Verification Updated')
            .setColor(0x2ECC71)
            .setThumbnail(profile.avatarUrl || null)
            .addFields(
                { name: 'Discord',    value: `<@${targetUser.id}>`,             inline: true },
                { name: 'In-Game',    value: profile.username,                   inline: true },
                { name: 'Country',    value: `${f} ${country?.name ?? 'Unknown'}`, inline: true },
                { name: 'Status',     value: `${immigrationStatus}${subStatus ? ` / ${subStatus}` : ''}`, inline: true },
                { name: 'Build',      value: data.build ?? 'Unclassified',       inline: true },
                { name: 'Government', value: isGovernment ? (govRole ?? 'Yes') : 'No', inline: true },
                { name: 'Updated By', value: `<@${interaction.user.id}>`,       inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info('SETVERIFY', `${targetUser.tag} set to ${immigrationStatus}/${subStatus || 'none'} by ${interaction.user.tag}`);
    },
};
