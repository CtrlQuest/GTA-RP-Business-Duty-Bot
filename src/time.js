const { DateTime } = require('luxon');

function durationMinutes(milliseconds) {
  return Math.max(0, Math.floor(milliseconds / 60_000));
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
}

function weekWindow(nowIso, timezone, weeksAgo = 0) {
  const now = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(timezone);
  const start = now.startOf('week').minus({ weeks: weeksAgo });
  return {
    startMs: start.toUTC().toMillis(),
    endMs: start.plus({ weeks: 1 }).toUTC().toMillis(),
    label: `${start.toFormat('dd LLL yyyy')} – ${start.plus({ days: 6 }).toFormat('dd LLL yyyy')}`,
  };
}

function discordTimestamp(iso, style = 'f') {
  const seconds = Math.floor(DateTime.fromISO(iso, { zone: 'utc' }).toSeconds());
  return `<t:${seconds}:${style}>`;
}

module.exports = { durationMinutes, formatDuration, weekWindow, discordTimestamp };
