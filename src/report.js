const { EmbedBuilder } = require('discord.js');
const { formatDuration, formatShortDateTime } = require('./time');

function escapeMarkdown(text) {
  return String(text).replace(/([\\`*_{}\[\]()<>#+\-.!|])/g, '\\$1');
}

function splitLines(lines, maxLength = 3800) {
  const pages = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLength && current) {
      pages.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) pages.push(current);
  return pages.length ? pages : ['No completed or active shifts were recorded for this pay period.'];
}

function buildWeeklyReport(summary, config, weeksAgo = 0) {
  const lines = summary.people.map((person, index) => {
    const active = person.isActive ? ' • 🟢 On duty' : '';
    const shifts = `${person.shiftCount} shift${person.shiftCount === 1 ? '' : 's'}`;
    const adjustment = person.adjustmentMinutes
      ? ` • Adjusted ${person.adjustmentMinutes > 0 ? '+' : ''}${person.adjustmentMinutes} minutes`
      : '';
    return `**${index + 1}. ${escapeMarkdown(person.displayName)}** — ${formatDuration(person.milliseconds)} • ${shifts}${adjustment}${active}`;
  });
  const pages = splitLines(lines);

  return pages.slice(0, 10).map((description, index) => {
    const suffix = pages.length > 1 ? ` (${index + 1}/${Math.min(pages.length, 10)})` : '';
    return new EmbedBuilder()
      .setColor(config.colour)
      .setTitle(`${config.businessName} — ${weeksAgo ? 'Previous Week' : 'Current Pay Period'}${suffix}`)
      .setDescription(description)
      .addFields(
        { name: 'Week', value: summary.label, inline: true },
        { name: 'Currently On Duty', value: String(summary.active.length), inline: true },
        { name: 'People Recorded', value: String(summary.people.length), inline: true },
      )
      .setFooter({ text: weeksAgo ? 'Historical calendar week.' : 'Totals since the last Export & Reset.' })
      .setTimestamp();
  });
}

function buildOnDutyEmbed(activeShifts, config, nowIso) {
  const description = activeShifts.length
    ? activeShifts
        .map((shift) => {
          const duration = formatDuration(Date.parse(nowIso) - Date.parse(shift.startedAt));
          const started = formatShortDateTime(shift.startedAt, config.timezone);
          return `🟢 <@${shift.userId}> — ${duration} • since ${started}`;
        })
        .join('\n')
    : 'Nobody is currently clocked on.';

  return new EmbedBuilder()
    .setColor(config.colour)
    .setTitle(`${config.businessName} — On Duty (${activeShifts.length})`)
    .setDescription(description)
    .setTimestamp();
}

module.exports = { buildWeeklyReport, buildOnDutyEmbed };
