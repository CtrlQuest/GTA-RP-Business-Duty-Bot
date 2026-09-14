require('dotenv').config();

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const { DateTime } = require('luxon');
const { loadConfig } = require('./config');
const { ShiftStore } = require('./store');
const {
  formatDateTime,
  formatDuration,
  formatShortDateTime,
  discordTimestamp,
} = require('./time');
const { buildWeeklyReport, buildOnDutyEmbed } = require('./report');
const { buildSummaryText } = require('./export');
const { isGuildOwner } = require('./permissions');

const config = loadConfig();
const store = new ShiftStore(config.dataFile, config.defaultTimezone);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const buttonIds = {
  clockOn: 'duty_clock_on',
  clockOff: 'duty_clock_off',
  myTime: 'duty_my_time',
  onDuty: 'duty_on_duty',
  report: 'duty_weekly_report',
  adjustTime: 'duty_adjust_time',
  adjustMember: 'duty_adjust_member',
  adjustTimeModal: 'duty_adjust_time_modal',
  exportReset: 'duty_export_reset',
  confirmReset: 'duty_confirm_export_reset',
  cancelReset: 'duty_cancel_export_reset',
};

const timezoneChoices = [
  ['Eastern Time (EST/EDT)', 'America/New_York'],
  ['Central Time (CST/CDT)', 'America/Chicago'],
  ['Mountain Time (MST/MDT)', 'America/Denver'],
  ['Pacific Time (PST/PDT)', 'America/Los_Angeles'],
  ['UTC', 'UTC'],
  ['United Kingdom', 'Europe/London'],
];

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure this server and post its duty button panel.')
    .addChannelOption((option) =>
      option.setName('clock-channel').setDescription('Channel where staff press the duty buttons.')
        .addChannelTypes(ChannelType.GuildText).setRequired(true),
    )
    .addChannelOption((option) =>
      option.setName('log-channel').setDescription('Separate channel for clock-off and management logs.')
        .addChannelTypes(ChannelType.GuildText).setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName('manager-role').setDescription('Role allowed to manage reports, time, and approved managers.')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('business-name').setDescription('Business name shown on the duty panel and reports.')
        .setMaxLength(80),
    )
    .addStringOption((option) => {
      option.setName('timezone').setDescription('Timezone used for reports and exports.');
      for (const [name, value] of timezoneChoices) option.addChoices({ name, value });
      return option;
    }),
  new SlashCommandBuilder().setName('setup-status').setDescription('Show this server’s current duty-bot settings.'),
  new SlashCommandBuilder()
    .setName('add-manager')
    .setDescription('Server owner: approve a person to run reports and change duty time.')
    .addUserOption((option) =>
      option.setName('member').setDescription('Person to approve as a duty manager.').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('remove-manager')
    .setDescription('Server owner: remove a person’s individual duty-manager approval.')
    .addUserOption((option) =>
      option.setName('member').setDescription('Person whose approval should be removed.').setRequired(true),
    ),
  new SlashCommandBuilder().setName('list-managers')
    .setDescription('Show the manager role and individually approved managers.'),
  new SlashCommandBuilder().setName('refresh-duty-panel')
    .setDescription('Restore or update the clock buttons in the configured panel channel.'),
  new SlashCommandBuilder()
    .setName('duty-report')
    .setDescription('Show a duty report.')
    .addIntegerOption((option) =>
      option.setName('weeks-ago').setDescription('0 for the current period; 1 for last calendar week, and so on.')
        .setMinValue(0).setMaxValue(8),
    ),
  new SlashCommandBuilder().setName('on-duty').setDescription('Show everyone who is currently clocked on.'),
  new SlashCommandBuilder().setName('my-time').setDescription('Show your current duty status and recorded minutes.'),
  new SlashCommandBuilder()
    .setName('force-clock-off')
    .setDescription('Clock another member off duty.')
    .addUserOption((option) =>
      option.setName('member').setDescription('The member to clock off.').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('adjust-time')
    .setDescription('Add or remove minutes from a member in the current pay period.')
    .addUserOption((option) =>
      option.setName('member').setDescription('The member whose time should change.').setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('minutes').setDescription('Positive adds time; negative removes time.')
        .setMinValue(-10080).setMaxValue(10080).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why the time is being changed.').setMaxLength(150).setRequired(true),
    ),
].map((command) => command.setDMPermission(false).toJSON());

function guildSettings(interaction) {
  return interaction.guildId ? store.guildConfig(interaction.guildId) : null;
}

function hasRole(interaction, roleId) {
  if (!roleId) return false;
  const roles = interaction.member?.roles;
  if (!roles) return false;
  return roles.cache ? roles.cache.has(roleId) : roles.includes(roleId);
}

function isServerOwner(interaction) {
  return isGuildOwner(interaction.guild?.ownerId, interaction.user.id);
}

function canRunSetup(interaction) {
  return isServerOwner(interaction)
    || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function isApproved(interaction) {
  const settings = guildSettings(interaction);
  if (!settings) return false;
  return canRunSetup(interaction)
    || hasRole(interaction, settings.managerRoleId)
    || (settings.managers || []).includes(interaction.user.id);
}

function canAssignManagers(interaction) {
  return isServerOwner(interaction);
}

function displayName(interaction) {
  return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
}

function presentationConfig(settings) {
  return { businessName: settings.businessName, colour: config.colour, timezone: settings.timezone };
}

async function replyNotConfigured(interaction) {
  const response = {
    content: 'This server has not been configured yet. The server owner or an administrator must run `/setup` first.',
    flags: MessageFlags.Ephemeral,
  };
  if (interaction.replied || interaction.deferred) await interaction.followUp(response);
  else await interaction.reply(response);
}

function dutyPanel(settings) {
  const embed = new EmbedBuilder()
    .setColor(config.colour)
    .setTitle(`${settings.businessName} — Duty Clock`)
    .setDescription('Staff use the first row. Management controls are on the second row.')
    .addFields(
      { name: 'Clock On', value: 'Press when your shift begins.', inline: true },
      { name: 'Clock Off', value: 'Press when your shift finishes.', inline: true },
      { name: 'My Time', value: 'View your status, minutes, and recent shifts.', inline: true },
    );
  const staffRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buttonIds.clockOn).setLabel('Clock On').setEmoji('🟢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buttonIds.clockOff).setLabel('Clock Off').setEmoji('🔴').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(buttonIds.myTime).setLabel('My Time').setEmoji('⏱️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buttonIds.onDuty).setLabel("Who's On").setEmoji('👥').setStyle(ButtonStyle.Primary),
  );
  const adminRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buttonIds.report).setLabel('Weekly Report').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buttonIds.adjustTime).setLabel('Adjust Time').setEmoji('🛠️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buttonIds.exportReset).setLabel('Export & Reset').setEmoji('📤').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [staffRow, adminRow] };
}

async function sendLog(guildId, message) {
  const settings = store.guildConfig(guildId);
  if (!settings) return false;
  const channel = await client.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.guildId !== guildId) return false;
  await channel.send({ content: message, allowedMentions: { parse: [] } });
  return true;
}

async function ensureDutyPanel(guildId) {
  const settings = store.guildConfig(guildId);
  if (!settings) throw new Error('This server has not been configured.');
  const channel = await client.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.guildId !== guildId) {
    throw new Error('The configured clock channel is unavailable to the bot.');
  }
  const saved = store.panelMessage(guildId);
  if (saved?.channelId === channel.id) {
    const existing = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (existing) {
      await existing.edit(dutyPanel(settings));
      return { created: false, message: existing };
    }
  }
  const message = await channel.send(dutyPanel(settings));
  store.setPanelMessage(guildId, channel.id, message.id);
  return { created: true, message };
}

async function configureServer(interaction) {
  if (!canRunSetup(interaction)) {
    await interaction.reply({ content: 'Only the server owner or a Discord administrator can run `/setup`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const panelChannel = interaction.options.getChannel('clock-channel', true);
  const logChannel = interaction.options.getChannel('log-channel', true);
  const managerRole = interaction.options.getRole('manager-role', true);
  if (panelChannel.id === logChannel.id) {
    await interaction.reply({ content: 'Choose separate clock and log channels.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (managerRole.id === interaction.guildId || managerRole.managed) {
    await interaction.reply({
      content: 'Choose a normal manager role that can be assigned to staff, not @everyone or an integration role.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const me = interaction.guild.members.me;
  const panelPermissions = panelChannel.permissionsFor(me);
  const logPermissions = logChannel.permissionsFor(me);
  const panelRequired = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
  const logRequired = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
  if (!panelPermissions?.has(panelRequired) || !logPermissions?.has(logRequired)) {
    await interaction.reply({
      content: 'The bot needs View Channel and Send Messages in both channels, plus Embed Links and Read Message History in the clock channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const existing = store.guildConfig(interaction.guildId);
  const settings = store.configureGuild(interaction.guildId, {
    panelChannelId: panelChannel.id,
    logChannelId: logChannel.id,
    managerRoleId: managerRole.id,
    businessName: interaction.options.getString('business-name') || existing?.businessName
      || interaction.guild.name || config.defaultBusinessName,
    timezone: interaction.options.getString('timezone') || existing?.timezone || config.defaultTimezone,
    configuredBy: interaction.user.id,
    configuredAt: new Date().toISOString(),
  });
  const panel = await ensureDutyPanel(interaction.guildId);
  await interaction.editReply([
    '✅ Duty bot setup complete.',
    `**Clock channel:** <#${settings.panelChannelId}>`,
    `**Log channel:** <#${settings.logChannelId}>`,
    `**Manager role:** <@&${settings.managerRoleId}>`,
    `**Business:** ${settings.businessName}`,
    `**Timezone:** ${settings.timezone}`,
    panel.created ? '**Panel:** Posted' : '**Panel:** Updated',
  ].join('\n'));
}

async function showSetupStatus(interaction) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  if (!isApproved(interaction)) {
    await interaction.reply({ content: 'You do not have permission to view the setup.', flags: MessageFlags.Ephemeral });
    return;
  }
  const managers = settings.managers?.length ? settings.managers.map((id) => `<@${id}>`).join(', ') : 'None';
  await interaction.reply({
    content: [`**${settings.businessName} setup**`, `Clock channel: <#${settings.panelChannelId}>`,
      `Log channel: <#${settings.logChannelId}>`, `Manager role: <@&${settings.managerRoleId}>`,
      `Individually approved: ${managers}`, `Timezone: ${settings.timezone}`].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function changeManager(interaction, remove = false) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  if (!canAssignManagers(interaction)) {
    await interaction.reply({
      content: 'Only the Discord server owner can add or remove approved managers.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const member = interaction.options.getUser('member', true);
  if (member.bot) {
    await interaction.reply({ content: 'A bot cannot be added as a duty manager.', flags: MessageFlags.Ephemeral });
    return;
  }
  const changed = remove ? store.removeManager(interaction.guildId, member.id)
    : store.addManager(interaction.guildId, member.id);
  const action = remove ? 'removed from' : 'added to';
  await interaction.reply({
    content: changed ? `✅ <@${member.id}> was ${action} the individually approved duty managers.`
      : `<@${member.id}> ${remove ? 'was not individually approved' : 'is already an approved duty manager'}.`,
    flags: MessageFlags.Ephemeral,
  });
  if (changed) {
    await sendLog(interaction.guildId,
      `🔐 <@${interaction.user.id}> ${remove ? 'removed' : 'added'} <@${member.id}> ${remove ? 'from' : 'as'} an approved duty manager.`)
      .catch((error) => console.error('Could not send manager-change log:', error));
  }
}

async function listManagers(interaction) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  if (!isApproved(interaction)) {
    await interaction.reply({ content: 'You do not have permission to view duty managers.', flags: MessageFlags.Ephemeral });
    return;
  }
  const individual = settings.managers?.length ? settings.managers.map((id) => `• <@${id}>`).join('\n')
    : 'No individually approved managers.';
  await interaction.reply({
    content: `**Manager role:** <@&${settings.managerRoleId}>\n\n**Individually approved managers:**\n${individual}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function clockOn(interaction) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  const nowIso = new Date().toISOString();
  const result = store.clockOn({ guildId: interaction.guildId, userId: interaction.user.id,
    displayName: displayName(interaction), nowIso });
  if (result.status === 'already_active') {
    await interaction.reply({
      content: `You are already clocked on. Your shift began **${formatDateTime(result.shift.startedAt, settings.timezone)}** (${discordTimestamp(result.shift.startedAt, 'R')}).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const started = formatDateTime(result.shift.startedAt, settings.timezone);
  let logged = true;
  try {
    logged = await sendLog(interaction.guildId, `🟢 <@${interaction.user.id}> clocked on.\n**Clocked on:** ${started}`);
  } catch (error) {
    logged = false;
    console.error('Could not send the clock-on log:', error);
  }
  await interaction.reply({
    content: `🟢 You are now **clocked on** for ${settings.businessName}.\n**Clocked on:** ${started}${logged ? '' : '\n⚠️ Your shift was saved, but the log message could not be sent.'}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function completeClockOff(interaction, targetUserId, forced = false) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const nowIso = new Date().toISOString();
  const result = store.clockOff({ guildId: interaction.guildId, userId: targetUserId,
    nowIso, endedBy: interaction.user.id });
  if (result.status === 'not_active') {
    await interaction.editReply(forced ? 'That member is not currently clocked on.' : 'You are not currently clocked on.');
    return;
  }
  const shiftMs = Date.parse(result.shift.endedAt) - Date.parse(result.shift.startedAt);
  const summary = store.currentPeriodSummary(interaction.guildId, nowIso);
  const person = summary.people.find((entry) => entry.userId === targetUserId);
  const started = formatDateTime(result.shift.startedAt, settings.timezone);
  const ended = formatDateTime(result.shift.endedAt, settings.timezone);
  const logMessage = [`🔴 <@${targetUserId}> clocked off${forced ? ` (by <@${interaction.user.id}>)` : ''}.`,
    `**Clocked on:** ${started}`,
    `**Clocked off:** ${ended}`,
    `**Shift worked:** ${formatDuration(shiftMs)}`,
    `**Total this pay period:** ${formatDuration(person?.milliseconds || 0)} across ${person?.shiftCount || 0} shift${person?.shiftCount === 1 ? '' : 's'}.`].join('\n');
  let logged = true;
  try { logged = await sendLog(interaction.guildId, logMessage); } catch (error) {
    logged = false;
    console.error('Could not send the clock-off log:', error);
  }
  await interaction.editReply(
    `${forced ? `<@${targetUserId}> has been` : 'You are now'} **clocked off**.\n**Clocked on:** ${started}\n**Clocked off:** ${ended}\n**Shift length:** ${formatDuration(shiftMs)}${logged ? '' : '\n⚠️ The shift was saved, but the log message could not be sent.'}`,
  );
}

async function showMyTime(interaction) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  const nowIso = new Date().toISOString();
  const summary = store.currentPeriodSummary(interaction.guildId, nowIso);
  const person = summary.people.find((entry) => entry.userId === interaction.user.id);
  const active = store.activeFor(interaction.guildId, interaction.user.id);
  const shifts = store.currentPeriodShifts(interaction.guildId, nowIso)
    .filter((shift) => shift.userId === interaction.user.id)
    .slice(0, 5);
  const recent = shifts.length
    ? shifts.map((shift) => {
      const start = formatShortDateTime(shift.startedAt, settings.timezone);
      const end = shift.endedAt ? formatShortDateTime(shift.endedAt, settings.timezone) : 'Still on duty';
      return `• ${start} → ${end} — **${formatDuration(shift.countedMilliseconds)}**`;
    }).join('\n')
    : 'No shifts recorded in this pay period.';
  const status = active
    ? `🟢 On duty since ${formatDateTime(active.startedAt, settings.timezone)}\nCurrent session: **${formatDuration(Date.parse(nowIso) - Date.parse(active.startedAt))}**`
    : '🔴 Clocked off';
  const embed = new EmbedBuilder()
    .setColor(config.colour)
    .setTitle(`${settings.businessName} — My Time`)
    .setDescription(status)
    .addFields(
      { name: 'Total this pay period', value: formatDuration(person?.milliseconds || 0), inline: true },
      { name: 'Shifts recorded', value: String(person?.shiftCount || 0), inline: true },
      { name: 'Manual adjustments', value: `${person?.adjustmentMinutes || 0} minutes`, inline: true },
      { name: 'Recent shifts', value: recent },
    )
    .setFooter({ text: 'Only you can see this.' })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function showReport(interaction, weeksAgo = 0) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  if (!isApproved(interaction)) {
    await interaction.reply({ content: 'You do not have permission to view duty reports.', flags: MessageFlags.Ephemeral });
    return;
  }
  const nowIso = new Date().toISOString();
  const summary = weeksAgo ? store.weeklySummary(interaction.guildId, nowIso, weeksAgo)
    : store.currentPeriodSummary(interaction.guildId, nowIso);
  await interaction.reply({ embeds: buildWeeklyReport(summary, presentationConfig(settings), weeksAgo), flags: MessageFlags.Ephemeral });
}

async function showOnDuty(interaction) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  const nowIso = new Date().toISOString();
  const active = store.activeInGuild(interaction.guildId);
  await interaction.reply({ embeds: [buildOnDutyEmbed(active, presentationConfig(settings), nowIso)], flags: MessageFlags.Ephemeral });
}

function adjustmentMemberPicker() {
  const member = new UserSelectMenuBuilder()
    .setCustomId(buttonIds.adjustMember)
    .setPlaceholder('Type a name or choose a member')
    .setMinValues(1)
    .setMaxValues(1);
  return {
    content: 'Choose the person whose duty time you want to adjust. You can type in the list to filter names.',
    components: [new ActionRowBuilder().addComponents(member)],
    flags: MessageFlags.Ephemeral,
  };
}

function adjustmentModal(targetUserId) {
  const minutes = new TextInputBuilder().setCustomId('minutes').setLabel('Minutes: + to add or - to remove')
    .setPlaceholder('Example: 30 or -15').setStyle(TextInputStyle.Short).setRequired(true);
  const reason = new TextInputBuilder().setCustomId('reason').setLabel('Reason').setPlaceholder('Forgot to clock off')
    .setStyle(TextInputStyle.Short).setMaxLength(150).setRequired(true);
  return new ModalBuilder().setCustomId(`${buttonIds.adjustTimeModal}:${targetUserId}`)
    .setTitle('Adjust Duty Time').addComponents(
      new ActionRowBuilder().addComponents(minutes),
      new ActionRowBuilder().addComponents(reason),
    );
}

async function applyTimeAdjustment(interaction, targetUserId, minutes, reason, knownName = null) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  if (!isApproved(interaction)) {
    await interaction.reply({ content: 'You do not have permission to adjust duty time.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 10080) {
    await interaction.reply({ content: 'Minutes must be a whole number from -10080 to 10080, and cannot be zero.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
  const discordUser = guildMember ? null : await client.users.fetch(targetUserId).catch(() => null);
  if (guildMember?.user.bot || discordUser?.bot) {
    await interaction.editReply('A bot cannot have duty time adjusted.');
    return;
  }
  const targetName = guildMember?.displayName || knownName || discordUser?.globalName || discordUser?.username;
  if (!targetName) {
    await interaction.editReply('I could not find that Discord user. Check the user ID and try again.');
    return;
  }
  const nowIso = new Date().toISOString();
  store.adjustTime({ guildId: interaction.guildId, userId: targetUserId, displayName: targetName,
    minutes, reason, createdAt: nowIso, createdBy: interaction.user.id });
  const summary = store.currentPeriodSummary(interaction.guildId, new Date().toISOString());
  const person = summary.people.find((entry) => entry.userId === targetUserId);
  const action = minutes > 0 ? 'added to' : 'removed from';
  await sendLog(interaction.guildId,
    `🛠️ **${Math.abs(minutes)} minutes** ${action} <@${targetUserId}> by <@${interaction.user.id}>.\n**Reason:** ${reason}\n**New total:** ${formatDuration(person?.milliseconds || 0)}`)
    .catch((error) => console.error('Could not send adjustment log:', error));
  await interaction.editReply(
    `Updated <@${targetUserId}> by **${minutes > 0 ? '+' : ''}${minutes} minutes**. Their current total is **${formatDuration(person?.milliseconds || 0)}**.`,
  );
}

function exportResetConfirmation() {
  const embed = new EmbedBuilder().setColor(0xED4245).setTitle('Export and reset all totals?')
    .setDescription('This sends a CSV of everyone’s minutes, then starts a new period at zero. Active staff remain clocked on. Full history is retained.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buttonIds.confirmReset).setLabel('Confirm Export & Reset').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(buttonIds.cancelReset).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row], flags: MessageFlags.Ephemeral };
}

async function exportAndReset(interaction) {
  const settings = guildSettings(interaction);
  if (!settings) return await replyNotConfigured(interaction);
  if (!isApproved(interaction)) {
    await interaction.reply({ content: 'You do not have permission to export or reset duty totals.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const nowIso = new Date().toISOString();
  const summary = store.currentPeriodSummary(interaction.guildId, nowIso);
  const date = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(settings.timezone).toISODate();
  const attachment = new AttachmentBuilder(Buffer.from(buildSummaryText(summary), 'utf8'),
    { name: `duty-report-${date}.txt` });
  await interaction.editReply({
    content: `Duty report ready for **${summary.people.length} people**.`,
    embeds: [],
    components: [],
    files: [attachment],
  });
  store.resetPeriod({ guildId: interaction.guildId, resetBy: interaction.user.id, nowIso });
  await sendLog(interaction.guildId,
    `📤 <@${interaction.user.id}> exported the duty report and reset all totals. **${summary.people.length} people** were included.`)
    .catch((error) => console.error('Could not send reset log:', error));
  await interaction.followUp({ content: '✅ Everyone’s totals are now zero for the new pay period.', flags: MessageFlags.Ephemeral });
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} server(s).`);
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    const route = config.developmentGuildId
      ? Routes.applicationGuildCommands(config.clientId, config.developmentGuildId)
      : Routes.applicationCommands(config.clientId);
    await rest.put(route, { body: commands });
    console.log(`Registered ${commands.length} ${config.developmentGuildId ? 'test-server' : 'global'} commands.`);
  } catch (error) { console.error('Could not register slash commands:', error); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === buttonIds.clockOn) return await clockOn(interaction);
      if (interaction.customId === buttonIds.clockOff) return await completeClockOff(interaction, interaction.user.id);
      if (interaction.customId === buttonIds.myTime) return await showMyTime(interaction);
      if (interaction.customId === buttonIds.onDuty) return await showOnDuty(interaction);
      if (interaction.customId === buttonIds.report) return await showReport(interaction);
      if (interaction.customId === buttonIds.adjustTime) {
        if (!guildSettings(interaction)) return await replyNotConfigured(interaction);
        if (!isApproved(interaction)) return await interaction.reply({ content: 'You do not have permission to adjust duty time.', flags: MessageFlags.Ephemeral });
        return await interaction.reply(adjustmentMemberPicker());
      }
      if (interaction.customId === buttonIds.exportReset) {
        if (!guildSettings(interaction)) return await replyNotConfigured(interaction);
        if (!isApproved(interaction)) return await interaction.reply({ content: 'You do not have permission to export or reset totals.', flags: MessageFlags.Ephemeral });
        return await interaction.reply(exportResetConfirmation());
      }
      if (interaction.customId === buttonIds.confirmReset) return await exportAndReset(interaction);
      if (interaction.customId === buttonIds.cancelReset) return await interaction.update({ content: 'Export and reset cancelled.', embeds: [], components: [] });
      return;
    }
    if (interaction.isUserSelectMenu() && interaction.customId === buttonIds.adjustMember) {
      if (!guildSettings(interaction)) return await replyNotConfigured(interaction);
      if (!isApproved(interaction)) return await interaction.reply({ content: 'You do not have permission to adjust duty time.', flags: MessageFlags.Ephemeral });
      return await interaction.showModal(adjustmentModal(interaction.values[0]));
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${buttonIds.adjustTimeModal}:`)) {
      const targetUserId = interaction.customId.slice(buttonIds.adjustTimeModal.length + 1);
      const minutesText = interaction.fields.getTextInputValue('minutes').trim();
      const minutes = /^[-+]?\d+$/.test(minutesText) ? Number.parseInt(minutesText, 10) : Number.NaN;
      const reason = interaction.fields.getTextInputValue('reason').trim();
      if (!/^\d{17,20}$/.test(targetUserId)) {
        return await interaction.reply({ content: 'That Discord member selection is no longer valid. Please press Adjust Time again.', flags: MessageFlags.Ephemeral });
      }
      return await applyTimeAdjustment(interaction, targetUserId, minutes, reason);
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'setup') return await configureServer(interaction);
    if (interaction.commandName === 'setup-status') return await showSetupStatus(interaction);
    if (interaction.commandName === 'add-manager') return await changeManager(interaction, false);
    if (interaction.commandName === 'remove-manager') return await changeManager(interaction, true);
    if (interaction.commandName === 'list-managers') return await listManagers(interaction);
    if (interaction.commandName === 'on-duty') return await showOnDuty(interaction);
    if (interaction.commandName === 'my-time') return await showMyTime(interaction);
    if (interaction.commandName === 'duty-report') return await showReport(interaction, interaction.options.getInteger('weeks-ago') || 0);
    if (interaction.commandName === 'refresh-duty-panel') {
      if (!guildSettings(interaction)) return await replyNotConfigured(interaction);
      if (!isApproved(interaction)) return await interaction.reply({ content: 'You do not have permission to refresh the duty panel.', flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await ensureDutyPanel(interaction.guildId);
      return await interaction.editReply(result.created ? 'The duty button panel has been posted.' : 'The duty button panel has been refreshed.');
    }
    if (interaction.commandName === 'force-clock-off') {
      if (!guildSettings(interaction)) return await replyNotConfigured(interaction);
      if (!isApproved(interaction)) return await interaction.reply({ content: 'You do not have permission to clock off other members.', flags: MessageFlags.Ephemeral });
      return await completeClockOff(interaction, interaction.options.getUser('member', true).id, true);
    }
    if (interaction.commandName === 'adjust-time') {
      const member = interaction.options.getUser('member', true);
      return await applyTimeAdjustment(interaction, member.id, interaction.options.getInteger('minutes', true),
        interaction.options.getString('reason', true), member.globalName || member.username);
    }
  } catch (error) {
    console.error('Interaction failed:', error);
    const response = { content: 'Something went wrong. The error has been written to the bot console.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
});

process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));
client.login(config.token);
