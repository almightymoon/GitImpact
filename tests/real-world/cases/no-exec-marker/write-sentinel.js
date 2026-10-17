const { writeFileSync } = require("node:fs");
const path = require("node:path");
writeFileSync(
  path.join(__dirname, "GITIMPACT_EXECUTED.sentinel"),
  `executed at ${new Date().toISOString()}\n`,
);
