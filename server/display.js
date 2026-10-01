// Virtual X display for GUI programs (a browser, ...). Off unless
// AGENTWEB_DISPLAY=1: screenshots of it cost many tokens. Claude draws on it
// through DISPLAY; the user watches and controls it from the "Ekran" tab,
// where noVNC talks to x11vnc through an authenticated WebSocket bridge (the
// VNC port itself only listens on localhost).
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_RESOLUTION = '1440x900';
const START_TIMEOUT_MS = 15000;
const MAX_VNC_CLIENTS = 4;
// Pending WebSocket frames before the VNC socket is paused (slow phone links).
const WS_HIGH_WATER = 64;
const WS_LOW_WATER = 16;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const RESTART_DELAY_MS = 2000;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const MAX_RESTARTS = 5;

// Programs the "Uygulamalar" menu may start. Nothing else can be launched
// from the browser.
const APPS = {
  browser: { title: 'Tarayıcı', command: 'agentweb-browser', args: [] },
};

function findBinary(name, envPath) {
  for (const dir of String(envPath || '').split(':')) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // bu dizinde yok
    }
  }
  return null;
}

function parseResolution(value) {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(String(value || '').trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 800 || height < 600 || width > 3840 || height > 2160) return null;
  return `${width}x${height}`;
}

function errMessage(err) {
  return err && err.message ? err.message : String(err);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(options) {
  return new Promise((resolve) => {
    const sock = net.connect(options);
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(1000, () => done(false));
  });
}

async function waitFor(check, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await delay(150);
  }
  return false;
}

function openLog(file) {
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.truncateSync(file, 0);
  } catch {
    // henuz yok
  }
  return fs.openSync(file, 'a');
}

class DisplayManager {
  constructor({ env } = {}) {
    this.env = env || process.env;
    const setting = String(this.env.AGENTWEB_DISPLAY || '').trim().toLowerCase();
    this.disabled = !['1', 'on', 'true', 'yes'].includes(setting);
    const number = Number(this.env.AGENTWEB_DISPLAY_NUMBER);
    this.number = Number.isInteger(number) && number >= 1 && number <= 999 ? number : 99;
    this.display = `:${this.number}`;
    this.socketPath = `/tmp/.X11-unix/X${this.number}`;
    this.resolution = parseResolution(this.env.SCREEN_RESOLUTION) || DEFAULT_RESOLUTION;
    const port = Number(this.env.AGENTWEB_VNC_PORT);
    this.vncPort = Number.isInteger(port) && port > 1024 && port < 65536 ? port : 5900;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
    this.runtimeDir = this.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `agentweb-runtime-${uid}`);
    this.logDir = path.join(os.tmpdir(), 'agentweb-logs');
    this.bins = {
      xvfb: findBinary('Xvfb', this.env.PATH),
      vnc: findBinary('x11vnc', this.env.PATH),
      wm: findBinary('openbox', this.env.PATH),
      dbus: findBinary('dbus-daemon', this.env.PATH),
    };
    this.procs = {};
    this.adopted = false;
    this.starting = null;
    this.vncStarting = null;
    this.stopping = false;
    this.vncClients = new Set();
    this.restarts = [];
    this.lastError = '';
  }

  get available() {
    return !this.disabled && !!this.bins.xvfb;
  }

  // Added to the environment of Claude, the terminal and MCP servers so that
  // whatever they open lands on this display.
  childEnv() {
    if (!this.available) return {};
    const env = { DISPLAY: this.display, XDG_RUNTIME_DIR: this.runtimeDir };
    if (this.bins.dbus) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${path.join(this.runtimeDir, 'bus')}`;
    return env;
  }

  alive(name) {
    const child = this.procs[name];
    return !!(child && child.exitCode === null && child.signalCode === null);
  }

  isUp() {
    return this.alive('xvfb') || (this.adopted && fs.existsSync(this.socketPath));
  }

  status() {
    return {
      available: this.available,
      disabled: this.disabled,
      running: this.available && this.isUp(),
      display: this.display,
      resolution: this.resolution,
      vnc: !!this.bins.vnc,
      vncRunning: this.alive('vnc'),
      clients: this.vncClients.size,
      apps: Object.entries(APPS).map(([id, app]) => ({
        id,
        title: app.title,
        available: !!findBinary(app.command, this.env.PATH),
      })),
      error: this.lastError,
    };
  }

  spawnProc(name, bin, args) {
    // A log that cannot be written (e.g. a folder left by another user) must
    // not keep the screen from starting.
    let log = null;
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      log = openLog(path.join(this.logDir, `${name}.log`));
    } catch (err) {
      console.error(`[display] ${name} gunlugu acilamadi: ${errMessage(err)}`);
    }
    let child;
    try {
      child = spawn(bin, args, {
        env: { ...this.env, ...this.childEnv() },
        stdio: log === null ? 'ignore' : ['ignore', log, log],
      });
    } finally {
      if (log !== null) fs.closeSync(log);
    }
    this.procs[name] = child;
    child.on('error', (err) => {
      this.lastError = `${name}: ${errMessage(err)}`;
    });
    child.on('exit', (code, signal) => {
      if (this.procs[name] === child) delete this.procs[name];
      if (!this.stopping) this.onUnexpectedExit(name, code, signal);
    });
    return child;
  }

  onUnexpectedExit(name, code, signal) {
    console.error(`[display] ${name} kapandi (kod=${code}, sinyal=${signal})`);
    if (name === 'vnc') {
      for (const ws of this.vncClients) ws.close(1011, 'vnc-exited');
      return;
    }
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.lastError = `${name} tekrar tekrar kapandı; Ekran sekmesinden yeniden başlatın.`;
      return;
    }
    this.restarts.push(now);
    setTimeout(() => {
      this.ensure().catch((err) => {
        this.lastError = errMessage(err);
      });
    }, RESTART_DELAY_MS).unref();
  }

  ensure() {
    if (!this.available) {
      return Promise.reject(new Error(this.disabled ? 'Sanal ekran kapalı (açmak için AGENTWEB_DISPLAY=1).' : 'Sanal ekran için Xvfb kurulu değil.'));
    }
    if (this.isUp() && (!this.bins.wm || this.alive('wm')) && (!this.bins.dbus || this.alive('dbus'))) {
      return Promise.resolve();
    }
    if (!this.starting) {
      this.starting = this.startAll().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  async startAll() {
    this.stopping = false;
    fs.mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 });
    if (!this.isUp()) {
      if (await canConnect({ path: this.socketPath })) {
        // Already served (e.g. started by hand before the server restarted).
        this.adopted = true;
      } else {
        this.adopted = false;
        this.spawnProc('xvfb', this.bins.xvfb, [
          this.display,
          '-screen', '0', `${this.resolution}x24`,
          '-nolisten', 'tcp',
          '-dpi', '96',
          '-br',
        ]);
        const ready = await waitFor(() => canConnect({ path: this.socketPath }), START_TIMEOUT_MS);
        if (!ready) {
          this.lastError = 'Sanal ekran (Xvfb) başlatılamadı.';
          throw new Error(this.lastError);
        }
      }
    }
    if (this.bins.dbus && !this.alive('dbus')) {
      fs.rmSync(path.join(this.runtimeDir, 'bus'), { force: true });
      this.spawnProc('dbus', this.bins.dbus, [
        '--session',
        `--address=unix:path=${path.join(this.runtimeDir, 'bus')}`,
        '--nofork',
        '--nopidfile',
        '--nosyslog',
      ]);
    }
    // A window manager gives windows borders, focus and stacking; without one
    // dialogs can open behind the main window and never get focus.
    if (this.bins.wm && !this.alive('wm')) {
      this.spawnProc('wm', this.bins.wm, ['--sm-disable']);
    }
    this.lastError = '';
  }

  ensureVnc() {
    if (this.alive('vnc')) return Promise.resolve(this.vncPort);
    if (!this.vncStarting) {
      this.vncStarting = this.startVnc().finally(() => {
        this.vncStarting = null;
      });
    }
    return this.vncStarting;
  }

  async startVnc() {
    if (!this.bins.vnc) throw new Error('x11vnc kurulu değil.');
    await this.ensure();
    if (await canConnect({ host: '127.0.0.1', port: this.vncPort })) return this.vncPort;
    this.spawnProc('vnc', this.bins.vnc, [
      '-display', this.display,
      '-rfbport', String(this.vncPort),
      '-localhost',
      '-forever',
      '-shared',
      '-nopw',
      '-xkb',
      '-noxrecord',
      '-ncache', '0',
      '-quiet',
    ]);
    const ready = await waitFor(() => canConnect({ host: '127.0.0.1', port: this.vncPort }), START_TIMEOUT_MS);
    if (!ready) {
      this.lastError = 'VNC sunucusu (x11vnc) başlatılamadı.';
      throw new Error(this.lastError);
    }
    return this.vncPort;
  }

  // WebSocket <-> VNC TCP bridge (raw RFB in binary frames, as noVNC expects).
  attachVnc(ws) {
    if (this.vncClients.size >= MAX_VNC_CLIENTS) {
      ws.close(1013, 'too-many-clients');
      return;
    }
    this.vncClients.add(ws);
    const queued = [];
    let sock = null;
    let closed = false;
    let pending = 0;
    let paused = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      this.vncClients.delete(ws);
      if (sock) sock.destroy();
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
    };

    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (sock && !sock.connecting && sock.writable) sock.write(buf);
      else queued.push(buf);
    });
    ws.on('close', cleanup);
    ws.on('error', cleanup);

    this.ensureVnc()
      .then((port) => {
        if (closed) return;
        sock = net.connect({ host: '127.0.0.1', port });
        sock.setNoDelay(true);
        sock.on('connect', () => {
          for (const buf of queued.splice(0)) sock.write(buf);
        });
        sock.on('data', (chunk) => {
          if (ws.readyState !== ws.OPEN) return;
          pending += 1;
          ws.send(chunk, { binary: true }, () => {
            pending -= 1;
            if (paused && pending <= WS_LOW_WATER && !closed) {
              paused = false;
              sock.resume();
            }
          });
          if (!paused && pending >= WS_HIGH_WATER) {
            paused = true;
            sock.pause();
          }
        });
        sock.on('close', cleanup);
        sock.on('error', cleanup);
      })
      .catch((err) => {
        this.lastError = errMessage(err);
        if (ws.readyState === ws.OPEN) ws.close(1011, 'vnc-unavailable');
        cleanup();
      });
  }

  // Starts one of the known programs, detached, with its output in a log file.
  async launch(id) {
    const app = Object.prototype.hasOwnProperty.call(APPS, id) ? APPS[id] : null;
    if (!app) throw Object.assign(new Error('Bilinmeyen uygulama.'), { status: 400 });
    const bin = findBinary(app.command, this.env.PATH);
    if (!bin) throw Object.assign(new Error(`${app.title} bu kurulumda yok.`), { status: 404 });
    await this.ensure();
    const logFile = path.join(this.logDir, `${id}.log`);
    let log = null;
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      log = openLog(logFile);
    } catch (err) {
      console.error(`[display] ${app.title} gunlugu acilamadi: ${errMessage(err)}`);
    }
    try {
      const child = spawn(bin, app.args, {
        env: { ...this.env, ...this.childEnv() },
        stdio: log === null ? 'ignore' : ['ignore', log, log],
        detached: true,
      });
      child.on('error', (err) => {
        this.lastError = `${app.title}: ${errMessage(err)}`;
      });
      child.unref();
    } finally {
      if (log !== null) fs.closeSync(log);
    }
    return { ok: true, title: app.title, log: log === null ? '' : logFile };
  }

  async stopAll() {
    this.stopping = true;
    const children = Object.values(this.procs);
    for (const child of children) {
      try {
        child.kill('SIGTERM');
      } catch {
        // zaten kapanmis
      }
    }
    if (this.adopted) {
      // Not our child; the X server's lock file names its pid.
      try {
        const pid = Number(fs.readFileSync(`/tmp/.X${this.number}-lock`, 'utf8').trim());
        if (pid > 1) process.kill(pid, 'SIGTERM');
      } catch {
        // kilit dosyasi yok
      }
      this.adopted = false;
    }
    await waitFor(async () => children.every((c) => c.exitCode !== null || c.signalCode !== null), 5000);
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          // yok say
        }
      }
    }
    await waitFor(async () => !fs.existsSync(this.socketPath) || !(await canConnect({ path: this.socketPath })), 3000);
    this.procs = {};
    for (const ws of this.vncClients) ws.close(1012, 'display-restart');
  }

  async restart() {
    await this.stopAll();
    this.restarts = [];
    this.stopping = false;
    await this.ensure();
    return this.status();
  }
}

module.exports = { DisplayManager, APPS, parseResolution };
