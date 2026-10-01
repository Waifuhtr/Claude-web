const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pty = require('node-pty');

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

// Earlier versions copied claude-config/mcp.example.json into every new
// session folder as .mcp.json. Its filesystem MCP server only duplicates
// Claude Code's built-in file tools (and its tool list costs tokens on every
// request), so an untouched copy is removed.
const OLD_MCP_TEMPLATE = JSON.stringify({
  mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] } },
});

function isValidName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

function removeOldMcpTemplate(dir) {
  const file = path.join(dir, '.mcp.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  if (JSON.stringify(parsed) === OLD_MCP_TEMPLATE) fs.rmSync(file, { force: true });
}

class SessionManager {
  constructor({ workspaceRoot, metaFile, defaultShellCmd, env }) {
    this.workspaceRoot = workspaceRoot;
    this.metaFile = metaFile;
    this.defaultShellCmd = defaultShellCmd || 'bash -l';
    this.env = env || process.env;
  }

  workdirFor(name) {
    return path.join(this.workspaceRoot, name);
  }

  loadMeta() {
    try {
      const raw = fs.readFileSync(this.metaFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveMeta(list) {
    try {
      fs.mkdirSync(path.dirname(this.metaFile), { recursive: true });
      fs.writeFileSync(this.metaFile, JSON.stringify(list, null, 2));
    } catch (err) {
      console.error('[sessions] meta yazilamadi:', err.message);
    }
  }

  list() {
    return this.loadMeta().sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  }

  touch(name) {
    const list = this.loadMeta();
    const existing = list.find((s) => s.name === name);
    const now = Date.now();
    if (existing) {
      existing.lastOpened = now;
    } else {
      list.push({ name, createdAt: now, lastOpened: now });
    }
    this.saveMeta(list);
  }

  remove(name) {
    this.saveMeta(this.loadMeta().filter((s) => s.name !== name));
  }

  ensureWorkspace(name) {
    const dir = this.workdirFor(name);
    fs.mkdirSync(dir, { recursive: true });
    removeOldMcpTemplate(dir);
    return dir;
  }

  spawnPty(name, cols, rows) {
    const cwd = this.ensureWorkspace(name);
    return pty.spawn(
      'tmux',
      ['new-session', '-A', '-s', name, '-c', cwd, this.defaultShellCmd],
      {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd,
        env: this.env,
      }
    );
  }

  killTmux(name) {
    try {
      execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
    } catch {
      // oturum zaten yoksa hata verir, yok sayiyoruz
    }
  }
}

module.exports = { SessionManager, isValidName };
