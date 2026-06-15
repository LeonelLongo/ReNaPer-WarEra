const { AuditLogEvent, EmbedBuilder } = require('discord.js');
const config = require('./config.json');
const logger = require('./logger');

const pendingReasons = new Map();

function init(client) {
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            await handleRoleUpdate(oldMember, newMember);
        } catch (err) {
            logger.error('ROLELOG', err.message);
        }
    });
}

async function handleRoleUpdate(oldMember, newMember) {
    const channelId = config.channels?.roleLogs;
    if (!channelId) return;

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    const added   = [...newRoles.values()].filter(r => !oldRoles.has(r.id) && r.id !== newMember.guild.id);
    const removed = [...oldRoles.values()].filter(r => !newRoles.has(r.id) && r.id !== newMember.guild.id);

    if (!added.length && !removed.length) return;

    await new Promise(r => setTimeout(r, 1200));

    let executor    = null;
    let auditReason = null;
    let isBotChange = false;

    try {
        const auditLogs = await newMember.guild.fetchAuditLogs({
            type: AuditLogEvent.MemberRoleUpdate,
            limit: 8,
        });
        const entry = auditLogs.entries.find(e =>
            e.target?.id === newMember.id &&
            Date.now() - e.createdTimestamp < 6000
        );
        if (entry) {
            executor    = entry.executor;
            auditReason = entry.reason;
            isBotChange = executor?.bot === true;
        }
    } catch (err) {
        logger.warn('ROLELOG', `Audit log fetch failed: ${err.message}`);
    }

    const channel = newMember.guild.channels.cache.get(channelId);
    if (!channel) return;

    let reasonText  = auditReason ?? null;
    let triggeredBy = null;
    if (isBotChange) {
        if (pendingReasons.has(newMember.id)) {
            const pending = pendingReasons.get(newMember.id);
            pendingReasons.delete(newMember.id);
            if (pending.reason) reasonText  = pending.reason;
            if (pending.actor)  triggeredBy = pending.actor;
        } else if (!reasonText) {
            reasonText = 'Automatic sync';
        }
    }

    const addedStr   = added.length   ? added.map(r => `<@&${r.id}> (${r.name})`).join('\n')   : null;
    const removedStr = removed.length ? removed.map(r => `<@&${r.id}> (${r.name})`).join('\n') : null;

    const embed = new EmbedBuilder()
        .setColor(isBotChange ? 0x5865F2 : 0xFEE75C)
        .setTitle(isBotChange ? 'Bot Role Change' : 'Manual Role Change')
        .setThumbnail(newMember.user.displayAvatarURL({ size: 64 }))
        .addFields([{ name: 'Member', value: `<@${newMember.id}> (${newMember.user.tag})`, inline: false }]);

    if (isBotChange && executor) embed.addFields([{ name: 'Bot', value: `<@${executor.id}>`, inline: false }]);
    if (isBotChange && triggeredBy) embed.addFields([{ name: 'Triggered By', value: triggeredBy, inline: false }]);
    if (!isBotChange && executor) embed.addFields([{ name: 'Changed By', value: `<@${executor.id}>`, inline: false }]);

    if (addedStr)   embed.addFields([{ name: 'Roles Added',   value: addedStr,   inline: false }]);
    if (removedStr) embed.addFields([{ name: 'Roles Removed', value: removedStr, inline: false }]);
    if (reasonText) embed.addFields([{ name: 'Reason',        value: reasonText, inline: false }]);

    embed.setTimestamp();
    await channel.send({ embeds: [embed] }).catch(err => logger.error('ROLELOG', `Send failed: ${err.message}`));
}

module.exports = { init, pendingReasons };
