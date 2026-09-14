const { DateTime } = require('luxon');
const { durationMinutes } = require('./time');

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildSummaryCsv(summary, timezone) {
  const header = [
    'Discord User ID',
    'Display Name',
    'Total Minutes',
    'Number of Shifts',
    'Manual Adjustment Minutes',
    'Currently On Duty',
    'Period Start',
    'Period End',
  ];
  const start = DateTime.fromMillis(summary.startMs, { zone: timezone }).toISO();
  const end = DateTime.fromMillis(summary.endMs, { zone: timezone }).toISO();
  const rows = summary.people.map((person) => [
    person.userId,
    person.displayName,
    durationMinutes(person.milliseconds),
    person.shiftCount,
    person.adjustmentMinutes,
    person.isActive ? 'Yes' : 'No',
    start,
    end,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { buildSummaryCsv };
