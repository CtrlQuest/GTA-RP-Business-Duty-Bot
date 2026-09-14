function isGuildOwner(ownerId, userId) {
  return Boolean(ownerId && userId && ownerId === userId);
}

module.exports = { isGuildOwner };
