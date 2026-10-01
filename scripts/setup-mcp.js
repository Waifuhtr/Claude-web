#!/usr/bin/env node
// Makes the Playwright MCP server available, configured the same way, in every
// session. Claude Code reads MCP servers from ~/.claude.json: the top-level
// "mcpServers" (user scope) applies to every folder, while entries under
// "projects[<folder>].mcpServers" (local scope, the default of `claude mcp add`)
// exist only in that one folder -- which is why a server added in one session
// was missing in another. Runs at container start, before any Claude process,
// so nothing else is writing the file.
'use strict';

const fs = require('fs');
const path = require('path');

// Google Chrome is installed in the image (see Dockerfile). The container has
// no user namespaces, so the browser runs without Chrome's own sandbox
// (Playwright MCP enables it by default for the chrome channel), and headless
// so it never depends on the virtual screen. --isolated keeps each session's
// browser profile in memory, so parallel sessions never fight over one
// profile directory.
//
// agentweb: Agent Web's own tools (share_file, virtual screen control).
// robloxstudio: the Roblox Studio MCP, wrapped so its Studio plugin lands in
// the plugin folder of the Studio that Vinegar runs (scripts/roblox-mcp).
//
// `requires` names a file the entry needs; entries whose file is missing (an
// image without Roblox support, say) are left out.
const MANAGED = {
  playwright: {
    entry: {
      type: 'stdio',
      command: 'playwright-mcp',
      args: ['--browser=chrome', '--headless', '--isolated', '--no-sandbox'],
      env: {},
    },
    detect: /@playwright\/mcp|playwright-mcp|mcp-server-playwright/,
  },
  agentweb: {
    entry: {
      type: 'stdio',
      command: 'node',
      args: ['/app/scripts/agentweb-mcp.js'],
      env: {},
    },
    detect: /agentweb-mcp/,
    requires: '/app/scripts/agentweb-mcp.js',
  },
  robloxstudio: {
    entry: {
      type: 'stdio',
      command: '/app/scripts/roblox-mcp',
      args: [],
      env: {},
    },
    // The read-only inspector edition is a deliberate choice; leave it alone.
    detect: /robloxstudio-mcp(?!-inspector)|\/roblox-mcp\b/,
    requires: '/app/scripts/roblox-mcp',
  },
};

function defaultManaged() {
  const out = {};
  for (const [name, spec] of Object.entries(MANAGED)) {
    if (spec.requires && !fs.existsSync(spec.requires)) continue;
    out[name] = spec;
  }
  return out;
}

function log(message) {
  console.log(`[setup-mcp] ${message}`);
}

// Key order must not matter when comparing entries Claude Code rewrote.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

function same(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// A hand-made entry for the same server (e.g. from `claude mcp add`).
function isSameServer(entry, detect) {
  if (!entry || typeof entry !== 'object') return false;
  const parts = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])];
  return parts.some((part) => detect.test(String(part)));
}

function readState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state && typeof state.servers === 'object' && state.servers) return state;
  } catch {
    // ilk calisma
  }
  return { servers: {} };
}

function writeFileAtomic(file, text, mode) {
  const tmp = `${file}.agentweb-tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, mode);
}

function apply(home, managed = defaultManaged()) {
  const configFile = path.join(home, '.claude.json');
  const stateFile = path.join(home, '.cc-web', 'managed-mcp.json');

  let config = {};
  let mode = 0o600;
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      mode = fs.statSync(configFile).mode & 0o777;
    } catch (err) {
      log(`~/.claude.json okunamadi (${err.message}); dokunulmadi.`);
      return;
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      log('~/.claude.json beklenmeyen bicimde; dokunulmadi.');
      return;
    }
  }
  if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {};

  const state = readState(stateFile);
  let configChanged = false;
  let stateChanged = false;

  for (const [name, spec] of Object.entries(managed)) {
    const wanted = spec.entry;
    const current = config.mcpServers[name];
    const previous = state.servers[name];

    if (previous === undefined) {
      // First run: take over the name. A hand-made entry for the same server
      // (user or per-folder scope) is replaced so every session behaves the same.
      if (current !== undefined && !isSameServer(current, spec.detect)) {
        log(`"${name}" adinda baska bir sunucu tanimli; dokunulmadi.`);
        continue;
      }
      if (!same(current, wanted)) {
        config.mcpServers[name] = wanted;
        configChanged = true;
        log(`"${name}" sunucusu tum oturumlar icin (kullanici kapsami) tanimlandi.`);
      }
      const projects = config.projects && typeof config.projects === 'object' ? config.projects : {};
      for (const [folder, project] of Object.entries(projects)) {
        const servers = project && project.mcpServers;
        if (servers && isSameServer(servers[name], spec.detect)) {
          delete servers[name];
          configChanged = true;
          log(`${folder} klasorune ozel eski "${name}" tanimi kaldirildi.`);
        }
      }
      state.servers[name] = wanted;
      stateChanged = true;
    } else if (current === undefined) {
      // Removed on purpose (claude mcp remove); respect that.
    } else if (same(current, previous)) {
      // Still exactly what we wrote last time: move it to the current default.
      if (!same(current, wanted)) {
        config.mcpServers[name] = wanted;
        configChanged = true;
        log(`"${name}" sunucusunun varsayilan ayarlari guncellendi.`);
      }
      if (!same(previous, wanted)) {
        state.servers[name] = wanted;
        stateChanged = true;
      }
    }
    // Otherwise the user customised the entry; it stays as it is.
  }

  if (configChanged) {
    const backup = `${configFile}.agentweb-backup`;
    if (fs.existsSync(configFile) && !fs.existsSync(backup)) fs.copyFileSync(configFile, backup);
    writeFileAtomic(configFile, `${JSON.stringify(config, null, 2)}\n`, mode);
  }
  if (stateChanged) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`, 0o600);
  }
}

if (require.main === module) {
  if (!process.env.HOME) {
    log('HOME tanimli degil; atlandi.');
  } else {
    apply(process.env.HOME);
  }
}

module.exports = { apply, MANAGED };
