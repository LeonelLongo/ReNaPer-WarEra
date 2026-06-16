const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: ModalRow } = require('discord.js');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config              = require('./config.json');
const verificationStore   = require('./verificationStore');
const verificationFlow    = require('./verificationFlow');
const { updateEmbedApplicationStatus } = verificationFlow;
const immigrationResolver = require('./immigrationResolver');
const roleSync            = require('./roleSync');
const roleLogger          = require('./roleLogger');
const logger              = require('./logger');
const gameApi             = require('./gameApi');
const { EmbedBuilder }    = require('discord.js');

const CODE_TIMEOUT_MS = 15 * 60 * 1000;
const _codeTimeouts = new Map();

async function denyAndClose(guild, targetId, reason) {
    const pending = await verificationStore.getPending(targetId);
    if (!pending) return;

    const slug = pending.channelSlug ?? targetId;
    await verificationStore.removePending(targetId);
    _codeTimeouts.delete(targetId);

    const channel = guild.channels.cache.get(pending.ticketChannelId);
    if (!channel) return;

    try {
        await channel.setName(`denied-${slug}`).catch(() => {});
        await channel.send({
            content: `<@${targetId}> — ${reason} Tu solicitud ha sido denegada. Podés volver a intentarlo usando el puerto de entrada.`,
        });
        setTimeout(() => channel.delete('Verification denied').catch(() => {}), 10_000);
    } catch (err) {
        logger.error('VF_BUTTON', `denyAndClose failed for ${targetId}: ${err.message}`);
    }
    logger.info('VF_BUTTON', `${targetId} denied — ${reason}`);
}

function scheduleChallengeTimeout(guild, targetId, issuedAt) {
    if (_codeTimeouts.has(targetId)) clearTimeout(_codeTimeouts.get(targetId));
    const remaining = Math.max(0, CODE_TIMEOUT_MS - (Date.now() - issuedAt));
    const tid = setTimeout(() => {
        denyAndClose(guild, targetId, 'No renombraste una empresa en 15 minutos.').catch(() => {});
    }, remaining);
    _codeTimeouts.set(targetId, tid);
}

function cancelChallengeTimeout(targetId) {
    if (_codeTimeouts.has(targetId)) {
        clearTimeout(_codeTimeouts.get(targetId));
        _codeTimeouts.delete(targetId);
    }
}

const BUTTON_STATUS_MAP = {
    approve:          { immigrationStatus: 'citizen',   subStatus: null },
    diplomat:         { immigrationStatus: 'foreigner', subStatus: 'diplomat' },
    visitorvisa:      { immigrationStatus: 'foreigner', subStatus: 'visitorVisa' },
    greencardholder:  { immigrationStatus: 'foreigner', subStatus: 'greenCardHolder' },
    deportee:         { immigrationStatus: 'hostile',   subStatus: 'deportee' },
    terrorist:        { immigrationStatus: 'hostile',   subStatus: 'terrorist' },
};

// ── Port of Entry: Apply button ──────────────────────────────────────────────

async function handleApply(interaction) {
    if (await verificationStore.isVerified(interaction.user.id)) {
        return interaction.reply({ content: 'Ya estás verificado.', flags: 64 });
    }

    const pending = await verificationStore.getPending(interaction.user.id);
    if (pending?.ticketChannelId) {
        const ch = interaction.guild.channels.cache.get(pending.ticketChannelId);
        if (ch) return interaction.reply({ content: `Ya tenés una solicitud abierta: ${ch}`, flags: 64 });
        await verificationStore.removePending(interaction.user.id);
    }

    const modal = new ModalBuilder()
        .setCustomId('vf:modal:apply')
        .setTitle('Solicitud de Ingreso');

    const profileInput = new TextInputBuilder()
        .setCustomId('profile')
        .setLabel('Usuario, ID de jugador o URL de perfil')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ej: JohnDoe o https://app.warera.io/user/...')
        .setRequired(true);

    modal.addComponents(new ModalRow().addComponents(profileInput));
    await interaction.showModal(modal);
}

async function handleModalApply(interaction) {
    await interaction.deferReply({ flags: 64 });

    if (await verificationStore.isVerified(interaction.user.id)) {
        return interaction.editReply('Ya estás verificado.');
    }

    const profileInput = interaction.fields.getTextInputValue('profile');
    const data = await verificationFlow.lookupProfile(profileInput);
    if (!data) {
        return interaction.editReply('No se encontró ese perfil del juego. Revisá tu entrada e intentá de nuevo.');
    }

    const dupe = await verificationStore.findByGameId(data.profile._id);
    if (dupe) {
        return interaction.editReply('Esa cuenta del juego ya está vinculada a otro usuario de Discord.');
    }

    try {
        const { channel, alreadyOpen } = await verificationFlow.openTicket(interaction.guild, interaction.member, data);
        if (alreadyOpen) return interaction.editReply(`Ya tenés una solicitud abierta: ${channel}`);
        return interaction.editReply(`Tu solicitud fue enviada. Por favor dirigite a ${channel} y esperá a un miembro del staff.`);
    } catch (err) {
        logger.error('VF_BUTTON', `Modal apply failed for ${interaction.user.id}: ${err.message}`);
        return interaction.editReply('Algo salió mal al abrir tu ticket. Por favor intentá de nuevo.');
    }
}

// ── Identity confirmation ────────────────────────────────────────────────────

async function handleConfirm(interaction, targetId) {
    if (interaction.user.id !== targetId) {
        return interaction.reply({ content: 'Solo el solicitante puede confirmar su identidad.', flags: 64 });
    }

    await interaction.deferUpdate();

    try {
        const pending = await verificationStore.getPending(targetId);
        if (!pending) {
            return interaction.followUp({ content: 'No se encontró el registro de la solicitud. Por favor comenzá de nuevo.', flags: 64 });
        }

        const code     = `AR-${String(Math.floor(10000 + Math.random() * 90000))}`;
        const issuedAt = Date.now();
        await verificationStore.updatePending(targetId, { challengeCode: code, challengeCodeIssuedAt: issuedAt });

        const slug = pending.channelSlug ?? targetId;
        await interaction.channel.setName(`verification-${slug}`).catch(() => {});

        const verifyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vf:verifyme:${targetId}`)
                .setLabel('Verificar')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`vf:tryagain:${targetId}`)
                .setLabel('Intentar de nuevo')
                .setStyle(ButtonStyle.Danger),
        );

        await interaction.message.edit({
            content:
                `<@${targetId}> — Para verificar tu identidad, renombrá una de tus empresas a:\n\n` +
                `**\`${code}\`**\n\n` +
                `Una vez hecho, presioná **Verificar** abajo. Podés volver a cambiarle el nombre después.\n` +
                `-# Tenés 15 minutos para completar este paso.`,
            embeds: [],
            components: [verifyRow],
        });

        scheduleChallengeTimeout(interaction.guild, targetId, issuedAt);
        logger.info('VF_BUTTON', `Confirm: code ${code} issued to ${targetId}`);
    } catch (err) {
        logger.error('VF_BUTTON', `handleConfirm failed for ${targetId}: ${err.message}`);
        await interaction.followUp({ content: 'Algo salió mal. Por favor intentá de nuevo.', flags: 64 }).catch(() => {});
    }
}

// ── Try Again ────────────────────────────────────────────────────────────────

async function handleTryAgain(interaction, targetId) {
    const pending = await verificationStore.getPending(targetId);

    if (pending?.challengeCode) {
        const isApplicant = interaction.user.id === targetId;
        const isVerifier  = config.adminUsers?.includes(interaction.user.id) ||
            [config.roles.president, config.roles.secretaryOfState, config.roles.governmentOfficial, config.roles.verifier]
                .filter(Boolean)
                .some(r => interaction.member.roles.cache.has(r));

        if (!isApplicant && !isVerifier) {
            return interaction.reply({ content: 'No tenés permisos para hacer eso.', flags: 64 });
        }

        await interaction.deferUpdate();
        const reason = isApplicant
            ? 'Elegiste no completar la verificación por nombre de empresa.'
            : 'Un miembro del staff canceló el paso de verificación.';
        await denyAndClose(interaction.guild, targetId, reason);
        return;
    }

    if (interaction.user.id !== targetId) {
        return interaction.reply({ content: 'Solo el solicitante puede usar Intentar de nuevo.', flags: 64 });
    }

    await verificationStore.updatePending(targetId, { challengeCode: null, challengeCodeIssuedAt: null });

    const modal = new ModalBuilder()
        .setCustomId(`vf:modal:retry:${targetId}`)
        .setTitle('Intentar de nuevo — Ingresá tu perfil');

    const profileInput = new TextInputBuilder()
        .setCustomId('profile')
        .setLabel('Usuario, ID de jugador o URL de perfil')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ej: JohnDoe o https://app.warera.io/user/...')
        .setRequired(true);

    modal.addComponents(new ModalRow().addComponents(profileInput));
    await interaction.showModal(modal);
}

async function handleModalRetry(interaction, targetId) {
    await interaction.deferReply({ flags: 64 });

    const profileInput = interaction.fields.getTextInputValue('profile');
    const data = await verificationFlow.lookupProfile(profileInput);
    if (!data) {
        return interaction.editReply('No se encontró ese perfil del juego. Revisá tu entrada e intentá de nuevo.');
    }

    const dupe = await verificationStore.findByGameId(data.profile._id);
    if (dupe && dupe[0] !== targetId) {
        return interaction.editReply('Esa cuenta del juego ya está vinculada a otro usuario de Discord.');
    }

    const pending = await verificationStore.getPending(targetId);
    const slug    = pending?.channelSlug ?? targetId;

    await verificationStore.updatePending(targetId, {
        gameUserId:    data.profile._id,
        gameUsername:  data.profile.username,
        countryId:     data.countryId,
        countryCode:   data.country?.code ?? '',
        countryName:   data.country?.name ?? 'Unknown',
        challengeCode: null,
    });

    await interaction.channel.setName(`applying-${slug}`).catch(() => {});

    const condensed  = verificationFlow.buildCondensedEmbed(data, interaction.user);
    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vf:confirm:${targetId}`).setLabel('Sí, soy yo').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`vf:tryagain:${targetId}`).setLabel('Intentar de nuevo').setStyle(ButtonStyle.Danger),
    );

    await interaction.channel.send({ content: `<@${targetId}> — ¿Esta es tu cuenta en el juego?`, embeds: [condensed], components: [confirmRow] });
    await interaction.editReply('Profile updated.');
}

// ── Verify Me (company name check) ──────────────────────────────────────────

async function handleVerifyMe(interaction, targetId) {
    if (interaction.user.id !== targetId) {
        return interaction.reply({ content: 'Solo el solicitante puede iniciar la verificación.', flags: 64 });
    }

    await interaction.deferUpdate();
    const originalComponents = interaction.message.components;
    await interaction.message.edit({ components: [] }).catch(() => {});

    const pending = await verificationStore.getPending(targetId);
    if (!pending?.challengeCode) {
        return interaction.followUp({ content: 'No se encontró el código de verificación. Por favor comenzá de nuevo.', flags: 64 });
    }

    const MAX_ATTEMPTS = 4;
    const RETRY_DELAY_MS = 5000;
    let companyData = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        companyData = await gameApi.getCompanyIds(pending.gameUserId);
        if (companyData !== null) break;
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }

    if (!companyData) {
        await interaction.message.edit({ components: originalComponents }).catch(() => {});
        return interaction.followUp({ content: `<@${targetId}> — No se pudo conectar con los servidores del juego. Por favor esperá e intentá de nuevo.` });
    }

    const companyIds = Array.isArray(companyData) ? companyData : (companyData.items ?? []);
    let found = false;
    for (const companyId of companyIds) {
        const company = await gameApi.getCompany(companyId);
        if (company?.name === pending.challengeCode) { found = true; break; }
    }

    if (!found) {
        await interaction.message.edit({ components: originalComponents }).catch(() => {});
        return interaction.followUp({
            content: `<@${targetId}> — No se encontró una empresa con el nombre **\`${pending.challengeCode}\`** en tu cuenta. Asegurate de que el nombre sea exacto e intentá de nuevo.`,
        });
    }

    const data = await verificationFlow.lookupProfile(`https://app.warera.io/user/${pending.gameUserId}`);
    if (!data) {
        return interaction.followUp({ content: 'No se pudo volver a obtener tu perfil del juego. Por favor contactá a un administrador.', flags: 64 });
    }

    const fullEmbed = verificationFlow.buildApplicationEmbed(data, interaction.user);
    const buttons   = verificationFlow.buildActionButtons(targetId, data.immigrationStatus);

    const verifyRoles = [
        config.roles.president,
        config.roles.secretaryOfState,
        config.roles.governmentOfficial,
    ].filter(Boolean);
    const ping = verifyRoles.map(r => `<@&${r}>`).join(' ');

    const slug = pending?.channelSlug ?? targetId;
    await interaction.channel.setName(`processing-${slug}`).catch(() => {});
    await interaction.message.edit({ content: 'Identidad verificada.', embeds: [], components: [] }).catch(() => {});

    await interaction.channel.send({
        content:    `${ping}\nIdentidad confirmada — nueva solicitud de ingreso de <@${targetId}>`,
        embeds:     [fullEmbed],
        components: buttons,
    });

    cancelChallengeTimeout(targetId);
    logger.info('VF_BUTTON', `${targetId} passed company verification (${pending.challengeCode})`);
}

// ── Approve / status assignment ──────────────────────────────────────────────

async function handleTicketButton(interaction, action, targetDiscordId) {
    await interaction.deferReply({ flags: 64 });

    const actor = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
    const canAct = config.adminUsers?.includes(interaction.user.id) ||
        [config.roles.president, config.roles.secretaryOfState, config.roles.governmentOfficial, config.roles.verifier]
            .filter(Boolean)
            .some(r => actor.roles.cache.has(r));

    if (!canAct) return interaction.editReply('No tenés permisos para procesar solicitudes.');

    if (action === 'other') {
        const id = targetDiscordId;
        const allOptions = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`vf:approve:${id}`).setLabel('Aprobar Ciudadano').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`vf:diplomat:${id}`).setLabel('Diplomático').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`vf:visitorvisa:${id}`).setLabel('Turista').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`vf:greencardholder:${id}`).setLabel('Proxi').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`vf:deny:${id}`).setLabel('Denegar').setStyle(ButtonStyle.Danger),
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`vf:close:${id}`).setLabel('Cerrar Ticket').setStyle(ButtonStyle.Secondary),
            ),
        ];
        await interaction.message.edit({ components: allOptions }).catch(() => {});
        return interaction.editReply('Mostrando todas las opciones.');
    }

    if (action === 'deny') {
        const denyPending = await verificationStore.getPending(targetDiscordId);
        const denySlug = denyPending?.channelSlug ?? targetDiscordId;
        await verificationStore.removePending(targetDiscordId);

        await interaction.channel.setName(`denied-${denySlug}`).catch(() => {});

        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vf:close:${targetDiscordId}`).setLabel('Cerrar Ticket').setStyle(ButtonStyle.Secondary),
        );

        const oldEmbed = interaction.message.embeds[0];
        const editPayload = { components: [closeRow] };
        if (oldEmbed) editPayload.embeds = [updateEmbedApplicationStatus(oldEmbed, 'denied')];
        await interaction.message.edit(editPayload).catch(() => {});
        await interaction.editReply('Solicitud denegada.');
        return;
    }

    if (action === 'close') {
        await verificationStore.removePending(targetDiscordId);
        await interaction.editReply('Cerrando ticket...');
        await interaction.channel.delete('Ticket closed').catch(() => {});
        return;
    }

    const statusInfo = BUTTON_STATUS_MAP[action];
    if (!statusInfo) return interaction.editReply('Acción desconocida.');

    const pending = await verificationStore.getPending(targetDiscordId);
    if (!pending) return interaction.editReply('No se encontró una solicitud pendiente para este usuario.');

    const data = await verificationFlow.lookupProfile(`https://app.warera.io/user/${pending.gameUserId}`);
    if (!data) return interaction.editReply('No se pudo volver a obtener el perfil del juego. Intentá de nuevo.');

    const { immigrationStatus, subStatus } = statusInfo;
    const govRole = immigrationStatus === 'citizen'
        ? immigrationResolver.resolveGovRole(data.govPosition, pending.countryId)
        : null;

    const record = {
        gameUserId:        pending.gameUserId,
        gameUsername:      pending.gameUsername,
        countryId:         pending.countryId,
        countryCode:       pending.countryCode,
        countryName:       pending.countryName,
        immigrationStatus,
        subStatus,
        build:             data.build,
        isGovernment:      !!govRole,
        governmentRole:    govRole,
        muId:              data.profile.mu ?? null,
        job:               'unemployed',
        companyRoles:      [],
        verifiedAt:        Date.now(),
        approvedBy:        interaction.user.id,
    };

    await verificationStore.set(targetDiscordId, record);
    await verificationStore.removePending(targetDiscordId);

    try {
        const member = await interaction.guild.members.fetch(targetDiscordId);
        roleLogger.pendingReasons.set(member.id, { reason: 'Verification approved', actor: `<@${interaction.user.id}>` });
        await roleSync.sync(member, record);
        await member.setNickname(pending.gameUsername, 'Verification approved').catch(() => {});

        if (config.roles.unverified && member.roles.cache.has(config.roles.unverified)) {
            await member.roles.remove(config.roles.unverified).catch(() => {});
        }

        if (subStatus === 'terrorist') {
            await interaction.guild.members.ban(targetDiscordId, { reason: 'Designated terrorist' }).catch(() => {});
        }
    } catch (err) {
        logger.error('VF_BUTTON', `Role sync failed for ${targetDiscordId}: ${err.message}`);
        return interaction.editReply(`Guardado, pero la asignación de roles falló: ${err.message}`);
    }

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vf:close:${targetDiscordId}`).setLabel('Cerrar Ticket').setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply(`<@${targetDiscordId}> aprobado como **${immigrationStatus}${subStatus ? ` / ${subStatus}` : ''}**.`);
    const oldEmbed = interaction.message.embeds[0];
    const approvePayload = { components: [closeRow] };
    if (oldEmbed) approvePayload.embeds = [updateEmbedApplicationStatus(oldEmbed, 'approved')];
    await interaction.message.edit(approvePayload).catch(() => {});

    logger.info('VF_BUTTON', `${targetDiscordId} approved as ${immigrationStatus}/${subStatus} by ${interaction.user.tag}`);
}

// ── Recover challenge timeouts after restart ─────────────────────────────────

async function recoverChallengeTimeouts(guild) {
    const all = await verificationStore.getAllPending().catch(() => []);
    let recovered = 0;
    for (const p of all) {
        if (!p.challengeCode || !p.challengeCodeIssuedAt) continue;
        const age = Date.now() - p.challengeCodeIssuedAt;
        if (age >= CODE_TIMEOUT_MS) {
            await denyAndClose(guild, p.discordId, 'No renombraste una empresa en 15 minutos.').catch(() => {});
        } else {
            scheduleChallengeTimeout(guild, p.discordId, p.challengeCodeIssuedAt);
            recovered++;
        }
    }
    if (recovered > 0) logger.info('VF_BUTTON', `Recovered ${recovered} challenge timeout(s) after restart.`);
}

// ── Register ─────────────────────────────────────────────────────────────────

function register(buttonHandlers) {
    buttonHandlers.register('portofentry_apply', handleApply);

    buttonHandlers.register('vf:', async (interaction) => {
        const id = interaction.customId;

        // Modal submissions
        if (interaction.isModalSubmit()) {
            if (id === 'vf:modal:apply') return handleModalApply(interaction);
            const retryMatch = id.match(/^vf:modal:retry:(\d+)$/);
            if (retryMatch) return handleModalRetry(interaction, retryMatch[1]);
            return;
        }

        // Buttons
        const match = id.match(/^vf:(\w+):(\d+)$/);
        if (!match) return;
        const [, action, targetId] = match;

        switch (action) {
            case 'confirm':    return handleConfirm(interaction, targetId);
            case 'tryagain':   return handleTryAgain(interaction, targetId);
            case 'verifyme':   return handleVerifyMe(interaction, targetId);
            default:           return handleTicketButton(interaction, action, targetId);
        }
    });
}

module.exports = { register, recoverChallengeTimeouts };
