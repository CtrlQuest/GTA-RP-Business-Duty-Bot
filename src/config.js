const path = require('node:path');
const { IANAZone } = require('luxon');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseColour(value = '5F713B') {
  const cleaned = value.replace(/^#/, '');
  if (!/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
    throw new Error('EMBED_COLOUR must be a six-character hex colour, such as 5F713B.');
  }
  return Number.parseInt(cleaned, 16);
}

function loadConfig() {
  const timezone = process.env.DEFAULT_TIMEZONE?.trim() || 'America/New_York';
  if (!IANAZone.isValidZone(timezone)) {
    throw new Error(`DEFAULT_TIMEZONE is not a valid IANA time zone: ${timezone}`);
  }

  return {
    token: required('DISCORD_TOKEN'),
    clientId: required('CLIENT_ID'),
    developmentGuildId: process.env.DEVELOPMENT_GUILD_ID?.trim() || null,
    defaultBusinessName: process.env.DEFAULT_BUSINESS_NAME?.trim() || 'GTA RP Business',
    defaultTimezone: timezone,
    colour: parseColour(process.env.EMBED_COLOUR),
    dataFile: path.resolve(process.env.DATA_FILE?.trim() || './data/shifts.json'),
  };
}

module.exports = { loadConfig };
