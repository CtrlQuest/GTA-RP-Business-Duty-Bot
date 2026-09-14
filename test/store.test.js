const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ShiftStore } = require('../src/store');
const { formatDuration } = require('../src/time');
const { buildSummaryCsv } = require('../src/export');

function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'duty-bot-'));
  return new ShiftStore(path.join(directory, 'shifts.json'), 'America/New_York');
}

test('clocks a member on only once and then clocks them off', () => {
  const store = temporaryStore();
  const details = {
    guildId: 'guild-1',
    userId: 'user-1',
    displayName: 'Elliott Crane',
    nowIso: '2026-09-14T09:00:00.000Z',
  };

  assert.equal(store.clockOn(details).status, 'started');
  assert.equal(store.clockOn(details).status, 'already_active');
  assert.equal(
    store.clockOff({ ...details, nowIso: '2026-09-14T11:35:00.000Z' }).status,
    'ended',
  );
  assert.equal(store.activeInGuild('guild-1').length, 0);
});

test('calculates weekly time, shift count, and active count', () => {
  const store = temporaryStore();
  store.clockOn({
    guildId: 'guild-1', userId: 'user-1', displayName: 'Elliott', nowIso: '2026-09-14T09:00:00.000Z',
  });
  store.clockOff({
    guildId: 'guild-1', userId: 'user-1', nowIso: '2026-09-14T11:30:00.000Z',
  });
  store.clockOn({
    guildId: 'guild-1', userId: 'user-2', displayName: 'Nancy', nowIso: '2026-09-14T12:00:00.000Z',
  });

  const summary = store.weeklySummary('guild-1', '2026-09-14T13:00:00.000Z');
  assert.equal(summary.active.length, 1);
  assert.equal(summary.people.length, 2);
  assert.equal(summary.people[0].userId, 'user-1');
  assert.equal(summary.people[0].milliseconds, 2.5 * 60 * 60 * 1000);
  assert.equal(summary.people[0].shiftCount, 1);
});

test('formats working durations', () => {
  assert.equal(formatDuration(35 * 60_000), '35 minutes');
  assert.equal(formatDuration(60_000), '1 minute');
  assert.equal(formatDuration((2 * 60 + 15) * 60_000), '135 minutes');
});

test('remembers the permanent button panel message', () => {
  const store = temporaryStore();
  store.configureGuild('guild-1', {
    panelChannelId: 'channel-1', logChannelId: 'channel-2', managerRoleId: 'role-1',
    businessName: 'One of One Autos', timezone: 'America/New_York',
  });
  store.setPanelMessage('guild-1', 'channel-1', 'message-1');
  assert.deepEqual(store.panelMessage('guild-1'), { channelId: 'channel-1', messageId: 'message-1' });
});

test('keeps configuration and approved managers separate for every server', () => {
  const store = temporaryStore();
  store.configureGuild('guild-1', {
    panelChannelId: 'panel-1', logChannelId: 'log-1', managerRoleId: 'role-1',
    businessName: 'Business One', timezone: 'America/New_York',
  });
  store.configureGuild('guild-2', {
    panelChannelId: 'panel-2', logChannelId: 'log-2', managerRoleId: 'role-2',
    businessName: 'Business Two', timezone: 'America/Chicago',
  });
  assert.equal(store.addManager('guild-1', 'user-1'), true);
  assert.equal(store.addManager('guild-1', 'user-1'), false);
  assert.deepEqual(store.guildConfig('guild-1').managers, ['user-1']);
  assert.deepEqual(store.guildConfig('guild-2').managers, []);
  store.configureGuild('guild-1', { businessName: 'Business One Updated' });
  assert.deepEqual(store.guildConfig('guild-1').managers, ['user-1']);
  assert.equal(store.guildConfig('guild-1').managerRoleId, 'role-1');
  assert.equal(store.removeManager('guild-1', 'user-1'), true);
  assert.equal(store.removeManager('guild-1', 'user-1'), false);
});

test('never mixes active shifts between Discord servers', () => {
  const store = temporaryStore();
  const common = { userId: 'user-1', displayName: 'Elliott', nowIso: '2026-09-14T10:00:00.000Z' };
  store.clockOn({ ...common, guildId: 'guild-1' });
  store.clockOn({ ...common, guildId: 'guild-2' });
  store.clockOff({ guildId: 'guild-1', userId: 'user-1', nowIso: '2026-09-14T11:00:00.000Z' });
  assert.equal(store.activeInGuild('guild-1').length, 0);
  assert.equal(store.activeInGuild('guild-2').length, 1);
});

test('applies manual minutes and starts at zero after a reset', () => {
  const store = temporaryStore();
  store.clockOn({
    guildId: 'guild-1', userId: 'user-1', displayName: 'Elliott', nowIso: '2026-09-13T10:00:00.000Z',
  });
  store.adjustTime({
    guildId: 'guild-1', userId: 'user-1', displayName: 'Elliott', minutes: 15,
    reason: 'Correction', createdAt: '2026-09-13T10:30:00.000Z', createdBy: 'admin-1',
  });

  const beforeReset = store.currentPeriodSummary('guild-1', '2026-09-13T11:00:00.000Z');
  assert.equal(beforeReset.people[0].milliseconds, 75 * 60_000);
  assert.equal(beforeReset.people[0].adjustmentMinutes, 15);

  store.resetPeriod({ guildId: 'guild-1', resetBy: 'admin-1', nowIso: '2026-09-13T11:00:00.000Z' });
  const afterReset = store.currentPeriodSummary('guild-1', '2026-09-13T12:00:00.000Z');
  assert.equal(afterReset.people[0].milliseconds, 60 * 60_000);
  assert.equal(afterReset.people[0].adjustmentMinutes, 0);
  assert.equal(afterReset.active.length, 1);
});

test('exports pay-period totals as CSV minutes', () => {
  const store = temporaryStore();
  store.clockOn({
    guildId: 'guild-1', userId: 'user-1', displayName: 'Crane, Elliott', nowIso: '2026-09-14T10:00:00.000Z',
  });
  store.clockOff({ guildId: 'guild-1', userId: 'user-1', nowIso: '2026-09-14T12:15:00.000Z' });
  const summary = store.currentPeriodSummary('guild-1', '2026-09-14T13:00:00.000Z');
  const csv = buildSummaryCsv(summary, 'America/New_York');
  assert.match(csv, /"Crane, Elliott",135,1,0,No/);
});
