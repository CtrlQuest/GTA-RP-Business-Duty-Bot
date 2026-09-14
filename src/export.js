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

function csvDateTime(iso, timezone) {
  if (!iso) return '';
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .toFormat('yyyy-LL-dd hh:mm a ZZZZ');
}

function buildShiftCsv(shifts, timezone) {
  const header = [
    'Discord User ID',
    'Display Name',
    'Clocked On',
    'Clocked Off',
    'Minutes In Pay Period',
    'Status At Export',
    'Clocked Off By User ID',
    'Counted From',
    'Counted Until',
  ];
  const rows = shifts.map((shift) => [
    shift.userId,
    shift.displayName,
    csvDateTime(shift.startedAt, timezone),
    csvDateTime(shift.endedAt, timezone),
    durationMinutes(shift.countedMilliseconds),
    shift.endedAt ? 'Clocked Off' : 'On Duty',
    shift.endedBy || '',
    csvDateTime(shift.countedStartedAt, timezone),
    csvDateTime(shift.countedEndedAt, timezone),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { buildShiftCsv, buildSummaryCsv };
