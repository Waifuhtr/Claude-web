#!/usr/bin/env node
// Makes Agent Web's MCP servers available, configured the same way, in every
// session. Claude Code reads MCP servers from ~/.claude.json: the top-level
// "mcpServers" (user scope) applies to every folder, while entries under
// "projects[<folder>].mcpServers" (local scope, the default of `claude mcp add`)
// exist only in that one folder -- which is why a server added in one session
// was missing in another. Runs at container start, before any Claude process,
// so nothing else is writing the file.
'use strict';

const fs = require('fs');
const path = require('path');
const { tempPathOf } = require(path.join(__dirname, 'temp-paths.js'));

// playwright: Google Chrome is installed in the image (see Dockerfile). The
// container has no user namespaces, so the browser runs without Chrome's own
// sandbox (Playwright MCP enables it by default for the chrome channel), and
// headless so it never depends on the virtual screen. --isolated keeps each
// session's browser profile in memory, so parallel sessions never fight over
// one profile directory.
//
// agentweb: Agent Web's own tools (share_file, virtual screen control).
//
// github: GitHub's remote MCP server. It has no OAuth client registration for
// other apps, so a sign-in from Claude Code can never complete; it takes a
// token instead. The headersHelper reads one from GH_TOKEN / GITHUB_TOKEN or
// from `gh auth login` each time Claude connects, so no token is written here.
// An entry that already authenticates on its own (its own Authorization
// header, helper or OAuth client) is kept as it is.
//
// `requires` names a file the entry needs; entries whose file is missing are
// left out.
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
  github: {
    entry: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headersHelper: '/app/scripts/github-mcp-headers',
    },
    detect: /^https:\/\/api\.githubcopilot\.com\//,
    keep: authenticatesOnItsOwn,
    requires: '/app/scripts/github-mcp-headers',
  },
};

// Servers earlier versions added and no longer ship. Removed while they are
// still what was written (or point at a wrapper that no longer exists).
const RETIRED = {
  // Roblox Studio MCP (Roblox Studio through Vinegar is gone).
  robloxstudio: { brokenIf: (entry) => entry && entry.command === '/app/scripts/roblox-mcp' },
};

function authenticatesOnItsOwn(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.headersHelper === 'string' && entry.headersHelper) return true;
  if (entry.oauth && typeof entry.oauth === 'object' && entry.oauth.clientId) return true;
  const headers = entry.headers && typeof entry.headers === 'object' ? entry.headers : {};
  return Object.keys(headers).some((key) => /^authorization$/i.test(key));
}

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
  const parts = [entry.command, entry.url, ...(Array.isArray(entry.args) ? entry.args : [])];
  return parts.some((part) => typeof part === 'string' && detect.test(part));
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

// MCP servers running from /tmp lose their files on every restart; say so in
// the log (the MCP screen offers a permanent install).
function reportTempServers(config) {
  const lists = [['tum oturumlar', config.mcpServers]];
  const projects = config.projects && typeof config.projects === 'object' ? config.projects : {};
  for (const [folder, project] of Object.entries(projects)) {
    if (project && project.mcpServers && typeof project.mcpServers === 'object') lists.push([folder, project.mcpServers]);
  }
  for (const [where, servers] of lists) {
    for (const [name, entry] of Object.entries(servers || {})) {
      const temp = tempPathOf(entry);
      if (!temp) continue;
      const gone = fs.existsSync(temp) ? '' : '; dosyalari silinmis';
      log(`UYARI: "${name}" (${where}) ${temp} icinden calisiyor: /tmp her yeniden baslatmada silinir${gone}. MCP ekranindaki "Kalici kur" ile Claude'a kalici klasore kurdurabilirsin.`);
    }
  }
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
  reportTempServers(config);

  const state = readState(stateFile);
  let configChanged = false;
  let stateChanged = false;

  for (const [name, spec] of Object.entries(managed)) {
    const wanted = spec.entry;
    const current = config.mcpServers[name];
    const previous = state.servers[name];
    const keep = typeof spec.keep === 'function' ? spec.keep : () => false;

    if (previous === undefined) {
      // First run: take over the name. A hand-made entry for the same server
      // (user or per-folder scope) is replaced so every session behaves the same.
      if (current !== undefined && !isSameServer(current, spec.detect)) {
        log(`"${name}" adinda baska bir sunucu tanimli; dokunulmadi.`);
        continue;
      }
      if (current !== undefined && keep(current)) {
        // Works on its own (e.g. a token in its own header): leave it, and
        // from now on treat it as the user's.
        log(`"${name}" icin kendi ayarin korunuyor.`);
        state.servers[name] = { userOwned: true };
        stateChanged = true;
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
        if (servers && isSameServer(servers[name], spec.detect) && !keep(servers[name])) {
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

  for (const [name, spec] of Object.entries(RETIRED)) {
    const previous = state.servers[name];
    if (previous === undefined) continue;
    const current = config.mcpServers[name];
    if (current !== undefined) {
      if (same(current, previous) || spec.brokenIf(current)) {
        delete config.mcpServers[name];
        configChanged = true;
        log(`"${name}" sunucusu kaldirildi (artik Agent Web'de yok).`);
      } else {
        log(`"${name}" elle degistirilmis; dokunulmadi.`);
      }
    }
    delete state.servers[name];
    stateChanged = true;
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

// Brings back a ready-made server that was removed on purpose (from the MCP
// screen or with claude mcp remove):
//   node /app/scripts/setup-mcp.js --restore playwright
function restore(home, name, managed = defaultManaged()) {
  if (!Object.prototype.hasOwnProperty.call(managed, name)) {
    log(`"${name}" hazir sunuculardan biri degil (${Object.keys(managed).join(', ')}).`);
    return false;
  }
  const stateFile = path.join(home, '.cc-web', 'managed-mcp.json');
  const state = readState(stateFile);
  if (state.servers[name] !== undefined) {
    delete state.servers[name];
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`, 0o600);
  }
  apply(home, { [name]: managed[name] });
  return true;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!process.env.HOME) {
    log('HOME tanimli degil; atlandi.');
  } else if (args[0] === '--restore') {
    if (!args[1]) {
      log(`Kullanim: setup-mcp.js --restore <${Object.keys(defaultManaged()).join('|')}>`);
      process.exitCode = 2;
    } else if (restore(process.env.HOME, args[1])) {
      log("Agent Web'de MCP sunuculari ekranindaki \"Claude'u yeniden baslat\" ile yuklenir.");
    } else {
      process.exitCode = 1;
    }
  } else {
    apply(process.env.HOME);
  }
}

module.exports = { apply, restore, MANAGED, RETIRED };
