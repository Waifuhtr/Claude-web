#!/usr/bin/env node
// Agent Web's own MCP server (stdio, newline-delimited JSON-RPC 2.0).
//  - share_file: hands files to the user; the web server sees the result and
//    shows them in the chat as download cards (see server/chat.js).
//  - screen tools: look at and drive the virtual X display (Roblox Studio,
//    browser, ...) that the user watches in the "Ekran" tab.
// No dependencies on purpose: it starts fast and needs nothing from npm.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');

const SERVER_INFO = { name: 'agentweb', version: '1.0.0' };
const DISPLAY = process.env.DISPLAY || ':99';
const MAX_SHARE_FILES = 10;
const MAX_SHARE_BYTES = 50 * 1024 * 1024;
const MAX_SHARE_TOTAL = 100 * 1024 * 1024;
const SYSTEM_PATH_RE = /^\/(proc|sys|dev)(\/|$)/;
// Screenshots are scaled to fit WXGA; coordinates in every tool are in the
// pixels of that (scaled) image and are mapped back to the real screen.
const SHOT_MAX_W = 1280;
const SHOT_MAX_H = 800;
const MAX_PNG_BYTES = 3 * 1024 * 1024;
const MAX_TYPE_CHARS = 5000;
const LOG_DIR = path.join(os.tmpdir(), 'agentweb-logs');

const APPS = {
  roblox_studio: { title: 'Roblox Studio', command: 'roblox-studio', args: ['--foreground'] },
  vinegar_settings: { title: 'Vinegar ayarları', command: 'vinegar', args: ['manage'] },
  browser: { title: 'Tarayıcı', command: 'agentweb-browser', args: [] },
};

const COORD = { type: 'integer', minimum: 0, description: 'Pixel in the screenshot image.' };

const TOOLS = [
  {
    name: 'share_file',
    title: 'Dosya paylaş',
    description:
      'Send files from this machine to the user: they appear in the Agent Web chat as download cards ' +
      '(images also get a preview). Use it whenever the user asks you to send, share or give them a file, ' +
      'or when a result is better delivered as a file than as pasted text (long code, logs, CSV, documents, ' +
      'archives, images). Write the file first, then call this with its path. Folders cannot be shared; ' +
      'archive them first (zip/tar). At most 10 files, 50 MB each.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_SHARE_FILES,
          description: 'File paths, absolute or relative to the current working directory.',
        },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    annotations: { title: 'Dosya paylaş', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'screenshot',
    title: 'Ekran görüntüsü',
    description:
      'Screenshot of the virtual screen (X display) that the user sees in the "Ekran" tab, where GUI apps ' +
      'such as Roblox Studio and the browser run. Every screen tool takes coordinates in the pixels of this image.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Ekran görüntüsü', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'click',
    title: 'Tıkla',
    description: 'Move the mouse to (x, y) on the virtual screen and click.',
    inputSchema: {
      type: 'object',
      properties: {
        x: COORD,
        y: COORD,
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        double: { type: 'boolean', default: false, description: 'Double-click.' },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    annotations: { title: 'Tıkla', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'drag',
    title: 'Sürükle',
    description: 'Press a mouse button at (from_x, from_y), move to (to_x, to_y) and release.',
    inputSchema: {
      type: 'object',
      properties: {
        from_x: COORD,
        from_y: COORD,
        to_x: COORD,
        to_y: COORD,
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
      additionalProperties: false,
    },
    annotations: { title: 'Sürükle', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'type_text',
    title: 'Yaz',
    description:
      'Enter text into the focused window of the virtual screen. ASCII text is typed key by key ("\\n" presses ' +
      'Enter). Text with other characters (Turkish letters, emoji...) is pasted through the clipboard with Ctrl+V, ' +
      'because typing those key by key is unreliable; method "type" or "paste" forces one way.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: MAX_TYPE_CHARS },
        method: { type: 'string', enum: ['auto', 'type', 'paste'], default: 'auto' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { title: 'Yaz', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'press_keys',
    title: 'Tuşa bas',
    description:
      'Press keys on the virtual screen, xdotool style: "Return", "Escape", "Tab", "BackSpace", "Delete", ' +
      '"F5", "ctrl+s", "ctrl+shift+p", "alt+F4". Several space-separated combos are pressed in order.',
    inputSchema: {
      type: 'object',
      properties: { keys: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['keys'],
      additionalProperties: false,
    },
    annotations: { title: 'Tuşa bas', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'scroll',
    title: 'Kaydır',
    description: 'Scroll the mouse wheel at (x, y) on the virtual screen.',
    inputSchema: {
      type: 'object',
      properties: {
        x: COORD,
        y: COORD,
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'integer', minimum: 1, maximum: 20, default: 3 },
      },
      required: ['x', 'y', 'direction'],
      additionalProperties: false,
    },
    annotations: { title: 'Kaydır', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_windows',
    title: 'Pencereler',
    description: 'List the visible windows on the virtual screen: title, position and size (in screenshot pixels).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Pencereler', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'focus_window',
    title: 'Pencereyi öne al',
    description: 'Bring the first visible window whose title contains the given text to the front and focus it.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['title'],
      additionalProperties: false,
    },
    annotations: { title: 'Pencereyi öne al', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'launch_app',
    title: 'Uygulama başlat',
    description:
      'Start a GUI app on the virtual screen: "roblox_studio" (Roblox Studio through Vinegar/Wine; the first ' +
      'start downloads Wine and Studio and takes several minutes), "vinegar_settings" (Vinegar\'s settings ' +
      'window) or "browser" (Chrome, optionally opening url). Check progress with screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', enum: Object.keys(APPS) },
        url: { type: 'string', maxLength: 2000, description: 'Only for "browser": an http(s) address to open.' },
      },
      required: ['app'],
      additionalProperties: false,
    },
    annotations: { title: 'Uygulama başlat', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
];

class ToolError extends Error {}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function text(value) {
  return { type: 'text', text: value };
}

function run(cmd, args, { input, timeout = 20000, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      // xdotool decodes typed text with the locale; under C/POSIX it rejects
      // anything that is not ASCII (Turkish letters, emoji...).
      const env = { ...process.env, DISPLAY, LC_ALL: 'C.UTF-8' };
      child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    const out = [];
    const errOut = [];
    let size = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new ToolError(`${cmd} zaman aşımına uğradı.`));
    }, timeout);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill('SIGKILL');
        finish(reject, new ToolError(`${cmd} çıktısı çok büyük.`));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (errOut.length < 50) errOut.push(chunk);
    });
    child.on('error', (err) => {
      finish(reject, err.code === 'ENOENT' ? new ToolError(`${cmd} kurulu değil.`) : err);
    });
    child.on('close', (code) => {
      const stderr = Buffer.concat(errOut).toString('utf8').trim();
      if (code === 0) finish(resolve, { stdout: Buffer.concat(out), stderr });
      else finish(reject, new ToolError(`${cmd} başarısız oldu (kod ${code})${stderr ? `: ${stderr.slice(0, 400)}` : ''}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input || undefined);
  });
}

function requireDisplay() {
  const match = /^:(\d+)/.exec(DISPLAY);
  if (match && !fs.existsSync(`/tmp/.X11-unix/X${match[1]}`)) {
    throw new ToolError(
      `Sanal ekran (${DISPLAY}) çalışmıyor. Kullanıcıdan Agent Web'de "Ekran" sekmesini açmasını isteyin; ekran orada başlatılır.`
    );
  }
}

let geometryCache = null;

async function screenGeometry() {
  if (geometryCache && Date.now() - geometryCache.at < 30000) return geometryCache;
  const { stdout } = await run('xdotool', ['getdisplaygeometry']);
  const [width, height] = stdout.toString().trim().split(/\s+/).map(Number);
  if (!(width > 0 && height > 0)) throw new ToolError('Ekran boyutu okunamadı.');
  const scale = Math.min(1, SHOT_MAX_W / width, SHOT_MAX_H / height);
  geometryCache = {
    at: Date.now(),
    width,
    height,
    scale,
    shotWidth: Math.round(width * scale),
    shotHeight: Math.round(height * scale),
  };
  return geometryCache;
}

async function toScreen(x, y) {
  const g = await screenGeometry();
  for (const [name, v] of [['x', x], ['y', y]]) {
    if (!Number.isInteger(v) || v < 0) throw new ToolError(`${name} sıfır ya da pozitif bir tam sayı olmalı.`);
  }
  if (x >= g.shotWidth || y >= g.shotHeight) {
    throw new ToolError(`(${x}, ${y}) ekranın dışında; görüntü ${g.shotWidth}x${g.shotHeight} piksel.`);
  }
  return [Math.min(g.width - 1, Math.round(x / g.scale)), Math.min(g.height - 1, Math.round(y / g.scale))];
}

function toShot(g, value) {
  return Math.round(value * g.scale);
}

const BUTTONS = { left: '1', middle: '2', right: '3' };

async function screenshot() {
  requireDisplay();
  const g = await screenGeometry();
  const resize = g.scale < 1 ? ['-resize', `${g.shotWidth}x${g.shotHeight}!`] : [];
  let image;
  try {
    image = (await run('import', ['-silent', '-window', 'root', ...resize, 'png:-'])).stdout;
  } catch (err) {
    if (!/kurulu değil/.test(err.message)) throw err;
    image = (await run('magick', ['import', '-silent', '-window', 'root', ...resize, 'png:-'])).stdout;
  }
  let mimeType = 'image/png';
  if (image.length > MAX_PNG_BYTES) {
    try {
      image = (await run('convert', ['png:-', '-quality', '85', 'jpg:-'], { input: image })).stdout;
      mimeType = 'image/jpeg';
    } catch {
      // PNG olarak kalsin
    }
  }
  return [
    { type: 'image', data: image.toString('base64'), mimeType },
    text(
      `Ekran ${g.width}x${g.height}` +
        (g.scale < 1 ? `, görüntü ${g.shotWidth}x${g.shotHeight} olarak küçültüldü` : '') +
        '. Araçlardaki koordinatlar bu görüntünün pikselleridir.'
    ),
  ];
}

async function click(args) {
  requireDisplay();
  const [x, y] = await toScreen(args.x, args.y);
  const button = BUTTONS[args.button || 'left'];
  if (!button) throw new ToolError('button left, right ya da middle olmalı.');
  const repeat = args.double ? ['--repeat', '2', '--delay', '120'] : [];
  await run('xdotool', ['mousemove', '--sync', String(x), String(y), 'click', ...repeat, button]);
  return [text(`${args.double ? 'Çift tıklandı' : 'Tıklandı'}: (${args.x}, ${args.y}) ${args.button || 'left'}`)];
}

async function drag(args) {
  requireDisplay();
  const [x1, y1] = await toScreen(args.from_x, args.from_y);
  const [x2, y2] = await toScreen(args.to_x, args.to_y);
  const button = BUTTONS[args.button || 'left'];
  if (!button) throw new ToolError('button left, right ya da middle olmalı.');
  const steps = [];
  for (let i = 1; i <= 10; i += 1) {
    steps.push('mousemove', String(Math.round(x1 + ((x2 - x1) * i) / 10)), String(Math.round(y1 + ((y2 - y1) * i) / 10)), 'sleep', '0.02');
  }
  await run('xdotool', ['mousemove', '--sync', String(x1), String(y1), 'mousedown', button, ...steps, 'mouseup', button]);
  return [text(`Sürüklendi: (${args.from_x}, ${args.from_y}) → (${args.to_x}, ${args.to_y})`)];
}

// xclip keeps serving the selection from a background copy of itself, so only
// the foreground process is waited for (its pipes stay open in the copy).
function setClipboard(value) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('xclip', ['-selection', 'clipboard', '-i'], {
        env: { ...process.env, DISPLAY, LC_ALL: 'C.UTF-8' },
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch (err) {
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ToolError('xclip zaman aşımına uğradı.'));
    }, 5000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new ToolError('xclip kurulu değil.') : err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new ToolError(`xclip başarısız oldu (kod ${code}).`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}

async function typeText(args) {
  requireDisplay();
  const value = args.text;
  if (typeof value !== 'string' || !value) throw new ToolError('text boş olamaz.');
  if (value.length > MAX_TYPE_CHARS) throw new ToolError(`En fazla ${MAX_TYPE_CHARS} karakter yazılabilir.`);
  const method = args.method || 'auto';
  if (!['auto', 'type', 'paste'].includes(method)) throw new ToolError('method auto, type ya da paste olmalı.');
  // xdotool can only type what the keyboard map has: for anything else it maps
  // a spare key for a moment and undoes it before the app reads the key.
  const plain = /^[\x20-\x7e\n\t]*$/.test(value);
  if (method === 'paste' || (method === 'auto' && !plain)) {
    try {
      await setClipboard(value);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
      return [text(`${value.length} karakter pano ile yapıştırıldı (Ctrl+V).`)];
    } catch (err) {
      if (method === 'paste' || !/xclip kurulu değil/.test(err.message)) throw err;
    }
  }
  await run('xdotool', ['type', '--delay', '12', '--', value], { timeout: 120000 });
  return [text(`${value.length} karakter yazıldı.`)];
}

async function pressKeys(args) {
  requireDisplay();
  const combos = String(args.keys || '').trim().split(/\s+/).filter(Boolean);
  if (!combos.length || combos.length > 20) throw new ToolError('keys 1-20 tuş kombinasyonu içermeli.');
  for (const combo of combos) {
    if (!/^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$/.test(combo)) throw new ToolError(`Geçersiz tuş: ${combo}`);
  }
  await run('xdotool', ['key', '--delay', '60', '--', ...combos]);
  return [text(`Basıldı: ${combos.join(' ')}`)];
}

async function scroll(args) {
  requireDisplay();
  const [x, y] = await toScreen(args.x, args.y);
  const button = { up: '4', down: '5', left: '6', right: '7' }[args.direction];
  if (!button) throw new ToolError('direction up, down, left ya da right olmalı.');
  const amount = Number.isInteger(args.amount) ? Math.min(20, Math.max(1, args.amount)) : 3;
  await run('xdotool', ['mousemove', '--sync', String(x), String(y), 'click', '--repeat', String(amount), '--delay', '40', button]);
  return [text(`Kaydırıldı: ${args.direction} × ${amount}`)];
}

async function visibleWindows() {
  let ids;
  try {
    ids = (await run('xdotool', ['search', '--onlyvisible', '--name', '.'])).stdout.toString().split(/\s+/).filter(Boolean);
  } catch (err) {
    // xdotool exits 1 when nothing matches.
    if (/kod 1\)/.test(err.message)) return [];
    throw err;
  }
  const g = await screenGeometry();
  const windows = [];
  for (const id of ids.slice(0, 50)) {
    try {
      const name = (await run('xdotool', ['getwindowname', id])).stdout.toString().trim();
      const geo = (await run('xdotool', ['getwindowgeometry', '--shell', id])).stdout.toString();
      const v = (key) => Number((new RegExp(`^${key}=(-?\\d+)`, 'm').exec(geo) || [])[1] || 0);
      if (!name || v('WIDTH') < 2 || v('HEIGHT') < 2) continue;
      windows.push({ id, title: name, x: toShot(g, v('X')), y: toShot(g, v('Y')), width: toShot(g, v('WIDTH')), height: toShot(g, v('HEIGHT')) });
    } catch {
      // pencere bu arada kapanmis olabilir
    }
  }
  return windows;
}

async function listWindows() {
  requireDisplay();
  const windows = await visibleWindows();
  if (!windows.length) return [text('Ekranda görünür pencere yok.')];
  const lines = windows.map((w) => `- "${w.title}" konum (${w.x}, ${w.y}) boyut ${w.width}x${w.height}`);
  return [text(`Görünür pencereler:\n${lines.join('\n')}`)];
}

async function focusWindow(args) {
  requireDisplay();
  const wanted = String(args.title || '').toLowerCase();
  if (!wanted) throw new ToolError('title boş olamaz.');
  const match = (await visibleWindows()).find((w) => w.title.toLowerCase().includes(wanted));
  if (!match) throw new ToolError(`Başlığında "${args.title}" geçen görünür pencere yok.`);
  await run('xdotool', ['windowactivate', '--sync', match.id]).catch(() => run('xdotool', ['windowfocus', match.id]));
  return [text(`Öne alındı: "${match.title}"`)];
}

function findOnPath(command) {
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // yok
    }
  }
  return null;
}

async function launchApp(args) {
  requireDisplay();
  const app = Object.prototype.hasOwnProperty.call(APPS, args.app) ? APPS[args.app] : null;
  if (!app) throw new ToolError(`app şunlardan biri olmalı: ${Object.keys(APPS).join(', ')}`);
  const bin = findOnPath(app.command);
  if (!bin) throw new ToolError(`${app.title} bu kurulumda yok (${app.command} bulunamadı).`);
  const appArgs = [...app.args];
  if (args.url !== undefined) {
    if (args.app !== 'browser') throw new ToolError('url sadece browser için kullanılabilir.');
    if (!/^https?:\/\/\S+$/i.test(String(args.url))) throw new ToolError('url http:// ya da https:// ile başlamalı.');
    appArgs.push(String(args.url));
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${args.app}.log`);
  const log = fs.openSync(logFile, 'a');
  try {
    const child = spawn(bin, appArgs, { env: { ...process.env, DISPLAY }, stdio: ['ignore', log, log], detached: true });
    child.on('error', () => {});
    child.unref();
  } finally {
    fs.closeSync(log);
  }
  const note =
    args.app === 'roblox_studio'
      ? ' İlk açılışta Wine ve Studio indirilir; birkaç dakika sürebilir. Studio giriş ekranı gelirse kullanıcıdan Ekran sekmesinden Roblox hesabıyla giriş yapmasını isteyin.'
      : '';
  return [text(`${app.title} başlatıldı.${note} Durumu screenshot ile kontrol edin. Günlük: ${logFile}`)];
}

function shareFile(args) {
  let raw = args.paths;
  if (typeof raw === 'string') raw = [raw];
  if (!Array.isArray(raw) || !raw.length) throw new ToolError('paths en az bir dosya yolu içermeli.');
  if (raw.length > MAX_SHARE_FILES) throw new ToolError(`Tek seferde en fazla ${MAX_SHARE_FILES} dosya paylaşılabilir.`);
  const files = [];
  let total = 0;
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new ToolError('Geçersiz dosya yolu.');
    const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
    const abs = path.resolve(process.cwd(), expanded);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new ToolError(`Dosya bulunamadı: ${value}`);
    }
    if (stat.isDirectory()) throw new ToolError(`${value} bir klasör; önce zip ya da tar ile arşivleyip arşivi paylaşın.`);
    if (!stat.isFile()) throw new ToolError(`${value} normal bir dosya değil.`);
    // /proc and friends look like regular files but hold live process state
    // (environment variables, memory maps) that should never leave the box.
    if (SYSTEM_PATH_RE.test(fs.realpathSync(abs))) throw new ToolError(`${value} bir sistem dosyası; paylaşılamaz.`);
    if (stat.size > MAX_SHARE_BYTES) throw new ToolError(`${value} çok büyük (${formatBytes(stat.size)}; en fazla 50 MB).`);
    try {
      fs.accessSync(abs, fs.constants.R_OK);
    } catch {
      throw new ToolError(`${value} okunamıyor (izin yok).`);
    }
    total += stat.size;
    if (total > MAX_SHARE_TOTAL) throw new ToolError('Dosyaların toplamı 100 MB\'ı aşıyor; daha az dosya paylaşın.');
    files.push({ path: fs.realpathSync(abs), name: path.basename(abs), size: stat.size });
  }
  const summary = files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ');
  return [
    text(`Paylaşıldı: ${summary}. Agent Web sohbetinde indirme kartı olarak görünür.`),
    text(JSON.stringify({ agentwebShare: files })),
  ];
}

const HANDLERS = {
  share_file: shareFile,
  screenshot,
  click,
  drag,
  type_text: typeText,
  press_keys: pressKeys,
  scroll,
  list_windows: listWindows,
  focus_window: focusWindow,
  launch_app: launchApp,
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  if (!method) return;
  if (!isRequest) return; // notifications (initialized, cancelled, ...)
  try {
    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: /^\d{4}-\d{2}-\d{2}$/.test(requested || '') ? requested : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              'Agent Web tools. share_file sends files to the user in the chat. The screen tools drive the ' +
              'virtual display the user watches in the "Ekran" tab (Roblox Studio, browser).',
          },
        });
        return;
      }
      case 'ping':
        send({ jsonrpc: '2.0', id, result: {} });
        return;
      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        return;
      case 'tools/call': {
        const name = params && params.name;
        const handler = Object.prototype.hasOwnProperty.call(HANDLERS, name) ? HANDLERS[name] : null;
        if (!handler) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
          return;
        }
        try {
          const content = await handler((params && params.arguments) || {});
          send({ jsonrpc: '2.0', id, result: { content } });
        } catch (err) {
          const messageText = err instanceof ToolError ? err.message : `Hata: ${err && err.message ? err.message : String(err)}`;
          send({ jsonrpc: '2.0', id, result: { content: [text(messageText)], isError: true } });
        }
        return;
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: err && err.message ? err.message : String(err) } });
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    for (const item of Array.isArray(message) ? message : [message]) {
      if (item && typeof item === 'object') handle(item);
    }
  });
  rl.on('close', () => process.exit(0));
}

module.exports = { TOOLS, HANDLERS };
