"use strict";

const { issueToken } = require("../lib/tokens");

function login(userId) {
  return issueToken(userId);
}

module.exports = { login };
