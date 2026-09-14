const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DateTime } = require('luxon');
const { weekWindow } = require('./time');

class ShiftStore {
  constructor(filePath, defaultTimezone) {
    this.filePath = filePath;
    this.defaultTimezone = defaultTimezone;
    this.data = { version: 3, guilds: {}, shifts: [], adjustments: [], resets: [] };
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.shifts)) {
      throw new Error(`Invalid shift data file: ${this.filePath}`);
    }
    parsed.version = 3;
    parsed.guilds ||= {};
    parsed.adjustments ||= [];
    parsed.resets ||= [];
    this.data = parsed;
  }

  save() {
    const tempFile = `${this.filePath}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    fs.renameSync(tempFile, this.filePath);
  }

  activeFor(guildId, userId) {
    return this.data.shifts.find(
      (shift) => shift.guildId === guildId && shift.userId === userId && !shift.endedAt,
    );
  }

  activeInGuild(guildId) {
    return this.data.shifts.filter((shift) => shift.guildId === guildId && !shift.endedAt);
  }

  configuredGuildIds() {
    return Object.keys(this.data.guilds);
  }

  guildConfig(guildId) {
    return this.data.guilds[guildId] || null;
  }

  configureGuild(guildId, settings) {
    const existing = this.guildConfig(guildId) || {};
    this.data.guilds[guildId] = {
      ...existing,
      ...settings,
      managers: existing.managers || [],
    };
    this.save();
    return this.data.guilds[guildId];
  }

  panelMessage(guildId) {
    return this.guildConfig(guildId)?.panelMessage || null;
  }

  setPanelMessage(guildId, channelId, messageId) {
    const settings = this.guildConfig(guildId);
    if (!settings) throw new Error('This server has not been configured.');
    settings.panelMessage = { channelId, messageId };
    this.save();
  }

  addManager(guildId, userId) {
    const settings = this.guildConfig(guildId);
    if (!settings) throw new Error('This server has not been configured.');
    settings.managers ||= [];
    if (settings.managers.includes(userId)) return false;
    settings.managers.push(userId);
    this.save();
    return true;
  }

  removeManager(guildId, userId) {
    const settings = this.guildConfig(guildId);
    if (!settings) throw new Error('This server has not been configured.');
    const before = settings.managers?.length || 0;
    settings.managers = (settings.managers || []).filter((id) => id !== userId);
    this.save();
    return settings.managers.length !== before;
  }

  clockOn({ guildId, userId, displayName, nowIso }) {
    const existing = this.activeFor(guildId, userId);
    if (existing) return { status: 'already_active', shift: existing };

    const shift = {
      id: crypto.randomUUID(),
      guildId,
      userId,
      displayName,
      startedAt: nowIso,
      endedAt: null,
      endedBy: null,
    };
    this.data.shifts.push(shift);
    this.save();
    return { status: 'started', shift };
  }

  clockOff({ guildId, userId, nowIso, endedBy = userId }) {
    const shift = this.activeFor(guildId, userId);
    if (!shift) return { status: 'not_active' };

    shift.endedAt = nowIso;
    shift.endedBy = endedBy;
    this.save();
    return { status: 'ended', shift };
  }

  adjustTime({ guildId, userId, displayName, minutes, reason, createdAt, createdBy }) {
    const adjustment = {
      id: crypto.randomUUID(),
      guildId,
      userId,
      displayName,
      minutes,
      reason,
      createdAt,
      createdBy,
    };
    this.data.adjustments.push(adjustment);
    this.save();
    return adjustment;
  }

  latestReset(guildId, nowIso) {
    const nowMs = Date.parse(nowIso);
    return this.data.resets
      .filter((reset) => reset.guildId === guildId && Date.parse(reset.at) <= nowMs)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null;
  }

  resetPeriod({ guildId, resetBy, nowIso }) {
    const reset = { id: crypto.randomUUID(), guildId, at: nowIso, resetBy };
    this.data.resets.push(reset);
    this.save();
    return reset;
  }

  summaryBetween(guildId, nowIso, startMs, endMs, label, includeCurrentActive = true) {
    const nowMs = Date.parse(nowIso);
    const people = new Map();

    const personFor = (userId, displayName) => {
      const person = people.get(userId) || {
        userId,
        displayName,
        shiftMilliseconds: 0,
        adjustmentMinutes: 0,
        milliseconds: 0,
        shiftCount: 0,
        isActive: false,
      };
      person.displayName = displayName || person.displayName;
      people.set(userId, person);
      return person;
    };

    for (const shift of this.data.shifts) {
      if (shift.guildId !== guildId) continue;

      const startedMs = Date.parse(shift.startedAt);
      const actualEndMs = shift.endedAt ? Date.parse(shift.endedAt) : nowMs;
      const overlapStart = Math.max(startedMs, startMs);
      const overlapEnd = Math.min(actualEndMs, endMs);
      if (overlapEnd <= overlapStart) continue;

      const person = personFor(shift.userId, shift.displayName);
      person.shiftMilliseconds += overlapEnd - overlapStart;
      person.shiftCount += 1;
      person.isActive ||= includeCurrentActive && !shift.endedAt;
    }

    for (const adjustment of this.data.adjustments) {
      if (adjustment.guildId !== guildId) continue;
      const createdMs = Date.parse(adjustment.createdAt);
      if (createdMs < startMs || createdMs >= endMs) continue;
      const person = personFor(adjustment.userId, adjustment.displayName);
      person.adjustmentMinutes += adjustment.minutes;
    }

    for (const person of people.values()) {
      person.milliseconds = Math.max(
        0,
        person.shiftMilliseconds + person.adjustmentMinutes * 60_000,
      );
    }

    return {
      startMs,
      endMs,
      label,
      active: includeCurrentActive ? this.activeInGuild(guildId) : [],
      people: [...people.values()].sort((a, b) => b.milliseconds - a.milliseconds),
    };
  }

  currentPeriodSummary(guildId, nowIso) {
    const timezone = this.guildConfig(guildId)?.timezone || this.defaultTimezone;
    const nowMs = Date.parse(nowIso);
    const latestReset = this.latestReset(guildId, nowIso);
    const startMs = latestReset
      ? Date.parse(latestReset.at)
      : weekWindow(nowIso, timezone, 0).startMs;
    const start = DateTime.fromMillis(startMs, { zone: timezone });
    const end = DateTime.fromMillis(nowMs, { zone: timezone });
    const label = `${start.toFormat('dd LLL yyyy, HH:mm')} – ${end.toFormat('dd LLL yyyy, HH:mm')}`;
    return this.summaryBetween(guildId, nowIso, startMs, nowMs, label, true);
  }

  currentPeriodShifts(guildId, nowIso) {
    const summary = this.currentPeriodSummary(guildId, nowIso);
    const nowMs = Date.parse(nowIso);
    return this.data.shifts
      .filter((shift) => shift.guildId === guildId)
      .map((shift) => {
        const startedMs = Date.parse(shift.startedAt);
        const actualEndMs = shift.endedAt ? Date.parse(shift.endedAt) : nowMs;
        const countedStartMs = Math.max(startedMs, summary.startMs);
        const countedEndMs = Math.min(actualEndMs, summary.endMs);
        return {
          ...shift,
          countedStartedAt: new Date(countedStartMs).toISOString(),
          countedEndedAt: new Date(countedEndMs).toISOString(),
          countedMilliseconds: Math.max(0, countedEndMs - countedStartMs),
        };
      })
      .filter((shift) => shift.countedMilliseconds > 0)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  weeklySummary(guildId, nowIso, weeksAgo = 0) {
    const timezone = this.guildConfig(guildId)?.timezone || this.defaultTimezone;
    const window = weekWindow(nowIso, timezone, weeksAgo);
    return this.summaryBetween(
      guildId,
      nowIso,
      window.startMs,
      window.endMs,
      window.label,
      weeksAgo === 0,
    );
  }
}

module.exports = { ShiftStore };
