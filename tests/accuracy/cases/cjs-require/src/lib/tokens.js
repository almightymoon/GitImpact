"use strict";

function issueToken(userId) {
  return `token-${userId}`;
}

module.exports = { issueToken };
