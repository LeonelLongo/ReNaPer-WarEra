const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const config              = require('./config.json');
const gameApi             = require('./gameApi');
const buildClassifier     = require('./buildClassifier');
const immigrationResolver = require('./immigrationResolver');
const verificationStore   = require('./verificationStore');
const logger              = require('./logger');

// ── Profile lookup ───────────────────────────────────────────────────────────

async function lookupProfile(input) {
    const trimmed = input.trim();
    const urlMatch = trimmed.match(/\/user\/([a-f0-9]{24})/i);
    const rawId    = urlMatch?.[1] ?? (trimmed.match(/^[a-f0-9]{24}$/) ? trimmed : null);

    let profile = null;

    if (rawId) {
        profile = await gameApi.getUser(rawId);
    } else {
        const results = await gameApi.search(trimmed);
        if (!results?.userIds?.length) return null;

        const lower = trimmed.toLowerCase();
        let fallback = null;

        for (const userId of results.userIds) {
            const p = await gameApi.getUser(userId);
            if (!p) continue;
            if (p.username?.toLowerCase() === lower) { profile = p; break; }
            if (!fallback) fallback = p;
        }

        if (!profile) profile = fallback;
    }

    if (!profile) return null;

    const countryId = typeof profile.country === 'object' ? profile.country?._id : profile.country;
    let country = null;
    let govPosition = null;

    if (countryId) {
        country = await gameApi.getCountry(countryId);
        govPosition = await getGovPosition(profile._id, countryId);
    }

    const build = buildClassifier.classify(profile.skills);
    const { immigrationStatus, subStatus } = await immigrationResolver.resolve(
        countryId,
        govPosition !== null && countryId !== config.countryId
    );

    const isLocalGov = immigrationStatus === 'citizen' && govPosition !== null;
    const govRole = immigrationResolver.resolveGovRole(govPosition, countryId);

    let muName = null;
    let muRole = null;
    if (profile.mu) {
        const mu = await gameApi.getMU(profile.mu);
        muName = mu?.name ?? null;
        if (mu) {
            const uid = profile._id;
            if (mu.roles?.managers?.includes(uid))    muRole = 'manager';
            else if (mu.roles?.commanders?.includes(uid)) muRole = 'commander';
            else if (mu.members?.includes(uid))        muRole = 'member';
        }
    }

    return { profile, country, countryId, govPosition, build, immigrationStatus, subStatus, isLocalGov, govRole, muName, muRole };
}

async function getGovPosition(gameUserId, countryId) {
    const gov = await gameApi.getGovernment(countryId);
    if (!gov) return null;

    if (gov.president === gameUserId)           return 'President';
    if (gov.vicePresident === gameUserId)       return 'Vice President';
    if (gov.minOfDefense === gameUserId)        return 'Minister of Defense';
    if (gov.minOfForeignAffairs === gameUserId) return 'Minister of Foreign Affairs';
    if (gov.minOfEconomy === gameUserId)        return 'Minister of Economy';
    if (gov.congressMembers?.includes(gameUserId)) return 'Congress Member';
    return null;
}

// ── Embeds ───────────────────────────────────────────────────────────────────

const STATUS_COLOR = {
    citizen:   0x2ECC71,
    foreigner: 0x3498DB,
    hostile:   0xED4245,
};

const STATUS_LABEL = {
    citizen:   'Ciudadano',
    foreigner: 'Extranjero',
    hostile:   'Hostil',
};

const SUB_STATUS_LABEL = {
    greenCardHolder: 'Proxi',
    diplomat:        'Diplomático',
    visitorVisa:     'Turista',
    deportee:        'Deportado',
    terrorist:       'Terrorista Designado',
};

const GOV_POSITION_LABEL = {
    'President':                   'Presidente',
    'Vice President':              'Vicepresidente',
    'Minister of Defense':         'Ministro de Defensa',
    'Minister of Foreign Affairs': 'Ministro de Relaciones Exteriores',
    'Minister of Economy':         'Ministro de Economía',
    'Congress Member':             'Miembro del Congreso',
};

const APPLICATION_STATUS_VALUE = {
    pending:  'Pendiente',
    approved: 'Aprobado',
    denied:   'Denegado',
};

function flag(code) {
    if (!code || code.length !== 2) return '';
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)));
}

function buildCondensedEmbed(data, discordUser) {
    const { profile, country } = data;
    const countryFlag = flag(country?.code);

    const embed = new EmbedBuilder()
        .setTitle(`${countryFlag} ${profile.username}`)
        .setColor(0x95A5A6)
        .setDescription('¿Eres vos?')
        .addFields(
            { name: 'Nivel',   value: String(profile.leveling?.level ?? '?'), inline: true },
            { name: 'País', value: `${countryFlag} ${country?.name ?? 'Desconocido'}`, inline: true },
        )
        .setTimestamp();

    if (profile.avatarUrl) embed.setThumbnail(profile.avatarUrl);
    return embed;
}

function buildApplicationEmbed(data, discordUser, applicationStatus = 'pending') {
    const { profile, country, govPosition, build, immigrationStatus, subStatus, muName } = data;
    const countryFlag = flag(country?.code);

    const govLabel = govPosition ? (GOV_POSITION_LABEL[govPosition] ?? govPosition) : null;
    const countryValue = govLabel
        ? `${countryFlag} ${country?.name ?? 'Unknown'}\n${govLabel}`
        : `${countryFlag} ${country?.name ?? 'Unknown'}`;

    const statusValue = subStatus
        ? `${STATUS_LABEL[immigrationStatus]}\n${SUB_STATUS_LABEL[subStatus] ?? subStatus}`
        : STATUS_LABEL[immigrationStatus];

    const MU_ROLE_LABEL = { manager: 'Gerente', commander: 'Comandante' };
    const muRoleLine = data.muRole && MU_ROLE_LABEL[data.muRole] ? `\n${MU_ROLE_LABEL[data.muRole]}` : '';
    const muValue = muName && profile.mu
        ? `[${muName}](https://app.warera.io/mu/${profile.mu})${muRoleLine}`
        : 'Ninguna';

    const BUILD_LABEL = { war: 'Soldado', econ: 'Economista' };
    const buildValue = BUILD_LABEL[build] ?? 'Sin clasificar';

    const embed = new EmbedBuilder()
        .setTitle(`${countryFlag} ${profile.username}`)
        .setURL(`https://app.warera.io/user/${profile._id}`)
        .setColor(STATUS_COLOR[immigrationStatus] ?? 0x95A5A6)
        .setAuthor({ name: 'Solicitud de Ingreso' })
        .setTimestamp();

    if (profile.avatarUrl) embed.setThumbnail(profile.avatarUrl);

    embed.addFields(
        { name: 'Discord',   value: `<@${discordUser.id}>`,                                   inline: true },
        { name: 'Nivel',     value: String(profile.leveling?.level ?? '?'),                 inline: true },
        { name: 'País',      value: countryValue,                                            inline: true },
        { name: 'MU',        value: muValue,                                                 inline: true },
        { name: 'Build',     value: buildValue,                                              inline: true },
        { name: 'Sugerido',  value: statusValue,                                             inline: true },
        { name: 'Estado',    value: APPLICATION_STATUS_VALUE[applicationStatus] ?? 'Pendiente', inline: true },
    );

    return embed;
}

function updateEmbedApplicationStatus(embed, status) {
    const updated = EmbedBuilder.from(embed);
    const fields  = [...(updated.data.fields ?? [])];
    const idx     = fields.findIndex(f => f.name === 'Application Status');
    if (idx >= 0) {
        fields[idx] = { name: 'Application Status', value: APPLICATION_STATUS_VALUE[status] ?? status, inline: true };
        updated.setFields(fields);
    }
    return updated;
}

// ── Buttons ──────────────────────────────────────────────────────────────────

function buildActionButtons(discordId, immigrationStatus) {
    const id = discordId;

    const approveBtn = new ButtonBuilder().setCustomId(`vf:approve:${id}`).setLabel('Aprobar Ciudadano').setStyle(ButtonStyle.Success);
    const denyBtn    = new ButtonBuilder().setCustomId(`vf:deny:${id}`).setLabel('Denegar').setStyle(ButtonStyle.Danger);
    const closeBtn   = new ButtonBuilder().setCustomId(`vf:close:${id}`).setLabel('Cerrar Ticket').setStyle(ButtonStyle.Secondary);
    const otherBtn   = new ButtonBuilder().setCustomId(`vf:other:${id}`).setLabel('Otro').setStyle(ButtonStyle.Secondary);

    if (immigrationStatus === 'citizen') {
        return [new ActionRowBuilder().addComponents(approveBtn, denyBtn, otherBtn, closeBtn)];
    }

    if (immigrationStatus === 'foreigner') {
        return [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`vf:diplomat:${id}`).setLabel('Diplomático').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`vf:visitorvisa:${id}`).setLabel('Turista').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`vf:greencardholder:${id}`).setLabel('Proxi').setStyle(ButtonStyle.Secondary),
                denyBtn,
                otherBtn,
            ),
            new ActionRowBuilder().addComponents(closeBtn)
        ];
    }

    if (immigrationStatus === 'hostile') {
        return [new ActionRowBuilder().addComponents(denyBtn, otherBtn, closeBtn)];
    }

    return [new ActionRowBuilder().addComponents(denyBtn, otherBtn, closeBtn)];
}

// ── Ticket ───────────────────────────────────────────────────────────────────

async function openTicket(guild, discordUser, lookupData) {
    const existing = await verificationStore.getPending(discordUser.id);
    if (existing?.ticketChannelId) {
        const ch = guild.channels.cache.get(existing.ticketChannelId);
        if (ch) return { channel: ch, alreadyOpen: true };
        await verificationStore.removePending(discordUser.id);
    }

    const { profile, country, countryId } = lookupData;
    const displayName = discordUser.displayName ?? discordUser.username;
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const channelName = `applying-${slug}`;

    const verifyRoles = [
        config.roles.president,
        config.roles.secretaryOfState,
        config.roles.governmentOfficial,
        config.roles.verifier,
    ].filter(Boolean);

    const permissionOverwrites = [
        { id: guild.id,          deny:  ['ViewChannel'] },
        { id: discordUser.id,    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        ...verifyRoles.map(roleId => ({
            id: roleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
        }))
    ];

    const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: config.channels.ticketsCategory || null,
        permissionOverwrites,
        reason: `Immigration application — ${discordUser.user?.tag ?? discordUser.tag ?? discordUser.id}`
    });

    await verificationStore.setPending(discordUser.id, {
        gameUserId:      profile._id,
        gameUsername:    profile.username,
        countryId,
        countryCode:     country?.code ?? '',
        countryName:     country?.name ?? 'Unknown',
        ticketChannelId: channel.id,
        channelSlug:     slug,
    });

    const condensed = buildCondensedEmbed(lookupData, discordUser);
    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`vf:confirm:${discordUser.id}`)
            .setLabel('Sí, soy yo')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`vf:tryagain:${discordUser.id}`)
            .setLabel('Intentar de nuevo')
            .setStyle(ButtonStyle.Danger),
    );

    await channel.send({
        content:    `<@${discordUser.id}> — ¿Esta es tu cuenta en el juego?`,
        embeds:     [condensed],
        components: [confirmRow],
    });

    const tag = discordUser.user?.tag ?? discordUser.tag ?? discordUser.id;
    logger.info('VERFLOW', `Ticket opened for ${tag} -> ${channel.name}`);
    return { channel, alreadyOpen: false };
}

module.exports = {
    lookupProfile, openTicket,
    buildCondensedEmbed, buildApplicationEmbed,
    buildActionButtons, updateEmbedApplicationStatus,
    getGovPosition, flag,
};
