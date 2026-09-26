const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pty = require('node-pty');

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

function isValidName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

class SessionManager {
  constructor({ workspaceRoot, metaFile, defaultShellCmd }) {
    this.workspaceRoot = workspaceRoot;
    this.metaFile = metaFile;
    this.defaultShellCmd = defaultShellCmd || 'bash -l';
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
    const mcpTemplate = path.join(__dirname, '..', 'claude-config', 'mcp.example.json');
    const mcpTarget = path.join(dir, '.mcp.json');
    if (!fs.existsSync(mcpTarget) && fs.existsSync(mcpTemplate)) {
      fs.copyFileSync(mcpTemplate, mcpTarget);
    }
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
        env: process.env,
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
