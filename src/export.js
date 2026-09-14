const { durationMinutes } = require('./time');

function oneLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function buildSummaryText(summary) {
  if (!summary.people.length) return 'No duty time recorded.\r\n';
  return summary.people.map((person) => [
    `Username: ${oneLine(person.displayName)}`,
    `Shifts Worked: ${person.shiftCount}`,
    `Minutes Worked: ${durationMinutes(person.milliseconds)}`,
  ].join(', ')).join('\r\n') + '\r\n';
}

module.exports = { buildSummaryText };
