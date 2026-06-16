'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config              = require('../config.json');
const verificationFlow    = require('../verificationFlow');
const verificationStore   = require('../verificationStore');
const roleSync            = require('../roleSync');
const roleLogger          = require('../roleLogger');
const immigrationResolver = require('../immigrationResolver');
const logger              = require('../logger');

const SEP = '\n――――――――――――――――――――\n';

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
        .setDescription('Actualizar verificación (Gabinete) / Update verification (Cabinet)')
        .addUserOption(opt =>
            opt.setName('user').setDescription('Usuario a actualizar / User to update').setRequired(true))
        .addStringOption(opt =>
            opt.setName('profile').setDescription('Usuario, ID o URL / Username, ID, or URL').setRequired(true))
        .addStringOption(opt =>
            opt.setName('role').setDescription('Estado a asignar / Status to assign').setRequired(true)
                .addChoices(
                    { name: 'Ciudadano / Citizen',       value: 'citizen' },
                    { name: 'Proxi / Green Card Holder', value: 'greenCardHolder' },
                    { name: 'Diplomático / Diplomat',    value: 'diplomat' },
                    { name: 'Turista / Visitor Visa',    value: 'visitorVisa' },
                    { name: 'Deportado / Deportee',      value: 'deportee' },
                ))
        .addStringOption(opt =>
            opt.setName('gov').setDescription('¿Es funcionario? / Government official?').setRequired(true)
                .addChoices(
                    { name: 'Sí / Yes', value: 'yes' },
                    { name: 'No',       value: 'no' },
                )),

    async execute(interaction) {
        if (!canUse(interaction.member)) {
            return interaction.reply({ content: `Solo para el Gabinete.${SEP}Cabinet only.`, flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const targetUser   = interaction.options.getUser('user');
        const profileInput = interaction.options.getString('profile');
        const roleChoice   = interaction.options.getString('role');
        const govChoice    = interaction.options.getString('gov') === 'yes';

        const data = await verificationFlow.lookupProfile(profileInput);
        if (!data) return interaction.editReply(`No se encontró ese perfil del juego. Intenta colocando el link de tu perfil.${SEP}Could not find that game profile. Try using your profile link.`);

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
            return interaction.editReply(`Registro guardado pero la sincronización de roles falló: ${err.message}${SEP}Record saved but role sync failed: ${err.message}`);
        }

        const f = verificationFlow.flag(country?.code);

        const embed = new EmbedBuilder()
            .setTitle('Verificación Actualizada / Verification Updated')
            .setColor(0x2ECC71)
            .setThumbnail(profile.avatarUrl || null)
            .addFields(
                { name: 'Discord',                     value: `<@${targetUser.id}>`,             inline: true },
                { name: 'En el juego / In-Game',       value: profile.username,                   inline: true },
                { name: 'País / Country',               value: `${f} ${country?.name ?? 'Desconocido / Unknown'}`, inline: true },
                { name: 'Estado / Status',              value: `${immigrationStatus}${subStatus ? ` / ${subStatus}` : ''}`, inline: true },
                { name: 'Build',                        value: data.build ?? 'Sin clasificar / Unclassified', inline: true },
                { name: 'Gobierno / Government',        value: isGovernment ? (govRole ?? 'Sí / Yes') : 'No', inline: true },
                { name: 'Actualizado por / Updated by', value: `<@${interaction.user.id}>`,        inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info('SETVERIFY', `${targetUser.tag} set to ${immigrationStatus}/${subStatus || 'none'} by ${interaction.user.tag}`);
    },
};
