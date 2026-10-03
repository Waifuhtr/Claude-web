'use strict';
// Paths in folders that do not survive a Space restart: /tmp, /var/tmp and
// /dev/shm (and every other folder outside HOME, but those are the ones
// tools pick for "just put it somewhere"). The bare folder (TMPDIR=/tmp) is
// fine; something inside it (/tmp/my-mcp) is not.
// Shared by the MCP guard hook, setup-mcp.js and the chat server.

const TEMP_PATH = /(?:^|[\s'"`=:,;([{])((?:\/var)?\/tmp\/[^\s'"`,;|&<>()[\]{}]+|\/dev\/shm\/[^\s'"`,;|&<>()[\]{}]+)/;

// First such path in a piece of text (a command line, an argument...).
function tempPathIn(text) {
  const match = TEMP_PATH.exec(String(text || ''));
  return match ? match[1] : '';
}

// First such path an MCP server configuration uses (command, arguments,
// working directory or environment values).
function tempPathOf(config) {
  if (!config || typeof config !== 'object') return '';
  const env = config.env && typeof config.env === 'object' ? Object.values(config.env) : [];
  const args = Array.isArray(config.args) ? config.args : [];
  for (const value of [config.command, config.cwd, ...args, ...env]) {
    if (typeof value !== 'string') continue;
    const found = tempPathIn(value);
    if (found) return found;
  }
  return '';
}

module.exports = { tempPathIn, tempPathOf };
