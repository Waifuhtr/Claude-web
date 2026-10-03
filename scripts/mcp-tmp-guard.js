#!/usr/bin/env node
// Claude Code PreToolUse hook for the Bash tool (see scripts/mcp-tmp-guard):
// refuses `claude mcp add ...` when the MCP server would run from /tmp, which
// is wiped every time the Space restarts, and tells Claude where to put it.
'use strict';

const path = require('path');
const { tempPathIn } = require(path.join(__dirname, 'temp-paths.js'));

const MCP_ADD = /\bmcp\s+add(?:-json)?\b/;
const CD = /^\s*(?:builtin\s+)?(?:cd|pushd)\s+["']?([^\s"']+)/;
const TEMP_DIR = /^(?:\/var)?\/tmp(?:\/|$)|^\/dev\/shm(?:\/|$)/;
const PWD = /\$\(pwd\)|`pwd`|\$\{?PWD\b/;

// Only the `mcp add` part of a command line counts (`mv /tmp/x ~/mcp-servers/x
// && claude mcp add ...` is the fix, not the problem), plus a `cd` into a temp
// folder that the add part then refers to through $(pwd) / $PWD.
function tempPathAdded(command) {
  let cwd = '';
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const cd = CD.exec(part);
    if (cd) cwd = TEMP_DIR.test(cd[1]) ? cd[1] : '';
    if (!MCP_ADD.test(part)) continue;
    const found = tempPathIn(part) || (cwd && PWD.test(part) ? cwd : '');
    if (found) return found;
  }
  return '';
}

function decide(event, home) {
  if (!event || event.tool_name !== 'Bash') return null;
  const command = event.tool_input && typeof event.tool_input.command === 'string' ? event.tool_input.command : '';
  if (!MCP_ADD.test(command)) return null;
  const found = tempPathAdded(command);
  if (!found) return null;
  const target = `${home ? String(home).replace(/\/+$/, '') : '~'}/mcp-servers/<name>`;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Agent Web stopped this command: it registers an MCP server that uses ${found}. ` +
        '/tmp is wiped every time this Space restarts, so the server would stop working. ' +
        `Put the server's files in ${target} instead (move them there if they are already built) ` +
        'and register it with that absolute path.',
    },
  };
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    const answer = decide(event, process.env.HOME);
    if (answer) process.stdout.write(JSON.stringify(answer));
  });
}

module.exports = { decide, tempPathAdded };
