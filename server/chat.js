const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const SDK_MODULE = '@anthropic-ai/claude-agent-sdk';

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];
const MODEL_RE = /^[A-Za-z0-9._[\]-]{1,64}$/;

const MAX_HISTORY = 3000;
const MAX_TOOL_TEXT = 20000;
const MAX_INPUT_TEXT = 20000;
const MAX_PROMPT_CHARS = 100000;
const MAX_ANSWER_CHARS = 2000;
const IDLE_CLOSE_MS = 30 * 60 * 1000;
const DRAFT_FLUSH_MS = 60;
const STOP_KILL_MS = 8000;
const MCP_STATUS_TIMEOUT_MS = 10000;
const USAGE_FLUSH_MS = 400;

// Signing in to remote MCP servers (OAuth) from the chat.
const MCP_AUTH_TIMEOUT_MS = 45000;
const MCP_CALLBACK_TIMEOUT_MS = 60000;
// Removing MCP servers for good (Claude Code's own `claude mcp remove`) and
// switching them off (claude.ai connectors cannot be removed from here).
const MCP_REMOVE_TIMEOUT_MS = 60000;
const MCP_TOGGLE_TIMEOUT_MS = 30000;
const REMOVABLE_SCOPES = new Set(['user', 'local', 'project']);
const OAUTH_FLOW_TTL_MS = 15 * 60 * 1000;
const MAX_OAUTH_FLOWS = 50;
const MAX_CALLBACK_URL = 8192;

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
// The API rejects larger images; bigger ones are still saved as plain files.
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_FILES = 300;
const MAX_IMAGES_PER_RESULT = 8;
const SESSION_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MEDIA_FILE_RE = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;
const MEDIA_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// Files Claude hands to the user with Agent Web's own MCP tool (scripts/agentweb-mcp.js).
const SHARE_TOOL = 'mcp__agentweb__share_file';
const FILE_ID_RE = /^[0-9a-f-]{36}$/;
const MAX_SHARE_BYTES = 50 * 1024 * 1024;
const MAX_SHARE_TOTAL = 100 * 1024 * 1024;
const MAX_SHARED_FILES = 200;
const MAX_SHARED_DISK = 1024 * 1024 * 1024;
const MAX_TEXT_PREVIEW = 512 * 1024;
const MAX_TOOL_NAMES = 500;
// Look like regular files, but hold live process state (environment, memory).
const SYSTEM_PATH_RE = /^\/(proc|sys|dev)(\/|$)/;
// Harmless Agent Web tools (they only read, or hand a file to this same
// user); asking every time would just be noise.
const AUTO_ALLOW_TOOLS = new Set([SHARE_TOOL, 'mcp__agentweb__screenshot', 'mcp__agentweb__list_windows']);

const NO_XHIGH = ['low', 'medium', 'high', 'max'];

// Anthropic's current model ids. Replaced by the CLI's own supportedModels()
// list (which reflects what this account can actually use) once a session
// has started at least once.
const FALLBACK_MODELS = [
  { value: '', displayName: 'Varsayılan', description: "Claude Code'un bu hesap için seçtiği model", supportedEffortLevels: EFFORT_LEVELS, group: 'main' },
  { value: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Zorlu işler için en yetenekli', supportedEffortLevels: EFFORT_LEVELS, group: 'main' },
  { value: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'En yeni Sonnet: hızlı ve güçlü, günlük işler için', supportedEffortLevels: EFFORT_LEVELS, group: 'main', pinned: true },
  { value: 'claude-sonnet-5', displayName: 'Sonnet 5', description: 'Günlük işler için verimli', supportedEffortLevels: EFFORT_LEVELS, group: 'main' },
  { value: 'claude-fable-5-1', displayName: 'Fable 5.1', description: 'En zor problemler için (kullanım kredisi gerektirebilir)', supportedEffortLevels: EFFORT_LEVELS, group: 'main' },
  { value: 'claude-haiku-4-5', displayName: 'Haiku 4.5', description: 'Hızlı, kısa cevaplar için', supportedEffortLevels: [], supportsAdaptiveThinking: false, group: 'main' },
  { value: 'claude-opus-5', displayName: 'Opus 5', description: '', supportedEffortLevels: EFFORT_LEVELS, group: 'other' },
  { value: 'claude-fable-5', displayName: 'Fable 5', description: 'Kullanım kredisi gerektirebilir', supportedEffortLevels: EFFORT_LEVELS, group: 'other' },
  { value: 'claude-opus-4-8', displayName: 'Opus 4.8', description: '', supportedEffortLevels: EFFORT_LEVELS, group: 'other' },
  { value: 'claude-opus-4-7', displayName: 'Opus 4.7', description: '', supportedEffortLevels: EFFORT_LEVELS, group: 'other' },
  { value: 'claude-opus-4-6', displayName: 'Opus 4.6', description: '', supportedEffortLevels: NO_XHIGH, group: 'other' },
  { value: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: '', supportedEffortLevels: NO_XHIGH, group: 'other' },
];

// The CLI only lists its own picker entries (often aliases such as "opus");
// model ids it does not list still work by name. Pinned ones (new releases)
// join the main list, the older ones go under "Diğer modeller".
function mergeFallbackModels(models) {
  const listed = new Set(models.map((m) => m.value));
  const pinned = [];
  const older = [];
  for (const m of FALLBACK_MODELS) {
    if (!m.value || listed.has(m.value)) continue;
    if (m.pinned) pinned.push({ ...m, group: 'main' });
    else if (m.group === 'other') older.push({ ...m });
  }
  const main = models.filter((m) => m.group !== 'other');
  const rest = models.filter((m) => m.group === 'other');
  return [...main, ...pinned, ...rest, ...older];
}

const ASSISTANT_ERRORS = {
  authentication_failed:
    'Kimlik doğrulama başarısız. Terminal sekmesinde `claude` çalıştırıp giriş yapın ya da ANTHROPIC_API_KEY secret\'ı tanımlayın.',
  oauth_org_not_allowed: 'Bu hesabın organizasyonu bu kullanıma izin vermiyor.',
  account_on_hold: 'Hesap askıya alınmış görünüyor.',
  verification_required: 'Hesap doğrulaması gerekiyor.',
  billing_error: 'Faturalandırma hatası (kredi veya ödeme yöntemi gerekiyor olabilir).',
  rate_limit: 'Kullanım limitine ulaşıldı.',
  overloaded: 'Servis şu an çok yoğun, biraz sonra tekrar deneyin.',
  model_not_found: 'Seçilen model bu hesapta kullanılamıyor, başka bir model seçin.',
  max_output_tokens: 'Yanıt maksimum uzunluğa ulaştığı için kesildi.',
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[chat] yazilamadi:', file, err.message);
  }
}

function errMessage(err) {
  return err && err.message ? err.message : String(err);
}

function truncate(text, max) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} karakter kırpıldı)`;
}

// Tool inputs can carry whole files (Write/Edit); keep the stored history light.
function capInput(input) {
  if (!input || typeof input !== 'object') return {};
  const out = Array.isArray(input) ? [] : {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === 'string' ? truncate(value, MAX_INPUT_TEXT) : value;
  }
  return out;
}

// Images in tool results are stored and shown separately (see extractImages).
function toolResultText(content) {
  if (typeof content === 'string') return truncate(content, MAX_TOOL_TEXT);
  if (!Array.isArray(content)) return '';
  const parts = content.map((block) => (block && block.type === 'text' ? block.text || '' : ''));
  return truncate(parts.filter(Boolean).join('\n'), MAX_TOOL_TEXT);
}

// Trust the bytes, not the declared type: only real raster images are shown
// or sent to Claude as images (never SVG/HTML that merely claims to be one).
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const six = buf.toString('ascii', 0, 6);
  if (six === 'GIF87a' || six === 'GIF89a') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Small UTF-8 files without NUL bytes can be previewed as text in the chat.
function looksLikeText(buf) {
  if (!buf || !buf.length || buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

// Appended to Claude Code's own system prompt for chat sessions.
function webUiPrompt(displayAvailable) {
  const lines = [
    `You are running inside Agent Web, a self-hosted web app (chat, terminal${displayAvailable ? ' and a virtual screen' : ''}) on a Linux container. The user reads your replies in the chat, often on a phone.`,
    '- To give the user a file (text, code, logs, CSV, documents, archives, images...), save it to disk and call the mcp__agentweb__share_file tool with its path: it shows up in the chat as a download card. Do this whenever the user asks you to send, share or give them a file, and prefer it over pasting very long content.',
  ];
  if (displayAvailable) {
    lines.push(
      '- A virtual X display is available (DISPLAY is already set). The user watches and controls it in the "Ekran" tab. GUI programs you start appear there; drive them with the mcp__agentweb__ screen tools (screenshot, click, type_text, press_keys, scroll, drag, list_windows, focus_window, launch_app). Screenshots are large; take one only when you need to see the screen.'
    );
  }
  return lines.join('\n');
}

function safeFileName(raw) {
  let name = String(raw || '').normalize('NFC');
  name = name.split(/[\\/]/).pop();
  name = name.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_').trim().replace(/^\.+/, '');
  if (!name) name = 'dosya';
  if (name.length > 120) {
    const ext = path.extname(name).slice(0, 16);
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name;
}

function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i += 1) candidate = `${base} (${i})${ext}`;
  return candidate;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const USAGE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cost'];

function tokenSum(u) {
  return u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0;
}

// modelUsage is a running total per model for the whole query() call.
function totalsFromModelUsage(modelUsage) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, models: {} };
  if (!modelUsage || typeof modelUsage !== 'object') return totals;
  for (const [model, u] of Object.entries(modelUsage)) {
    if (!u || typeof u !== 'object') continue;
    const entry = {
      input: num(u.inputTokens),
      output: num(u.outputTokens),
      cacheRead: num(u.cacheReadInputTokens),
      cacheWrite: num(u.cacheCreationInputTokens),
      cost: num(u.costUSD),
    };
    totals.models[model] = entry;
    for (const key of USAGE_KEYS) totals[key] += entry[key];
  }
  return totals;
}

// This turn's share of a running total; null when the totals went backwards
// (e.g. a /clear or compaction reset them), so the caller falls back.
function usageDelta(current, base) {
  const delta = { models: [] };
  for (const key of USAGE_KEYS) {
    delta[key] = current[key] - num(base[key]);
    if (delta[key] < -1e-9) return null;
  }
  const baseModels = base.models || {};
  for (const [model, entry] of Object.entries(current.models)) {
    const before = baseModels[model] || {};
    const beforeSum = num(before.input) + num(before.output) + num(before.cacheRead) + num(before.cacheWrite);
    if (tokenSum(entry) > beforeSum) delta.models.push(model);
  }
  return delta;
}

function serverHost(config) {
  if (!config || typeof config.url !== 'string') return '';
  try {
    return new URL(config.url).hostname;
  } catch {
    return '';
  }
}

function summarizeMcp(server) {
  const s = server || {};
  return {
    name: String(s.name || ''),
    status: String(s.status || ''),
    error: s.error ? truncate(String(s.error), 600) : '',
    scope: String(s.scope || s.source || ''),
    tools: Array.isArray(s.tools) ? s.tools.length : null,
    host: serverHost(s.config),
    // Where the definition lives (user, local, project, claudeai, plugin...);
    // decides whether it can be removed from here.
    source: String(s.source || s.scope || ''),
  };
}

function validServerName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name);
}

// "https://host[:port]" for a browser origin, or '' for anything else.
function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch {
    return '';
  }
}

// The sign-in page comes from the MCP server's metadata: only ever hand the
// browser a plain web address (never javascript: or data: URLs).
function safeAuthUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_CALLBACK_URL) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function hasAuthCode(value) {
  try {
    const url = new URL(value);
    return url.searchParams.has('code') || url.searchParams.has('error');
  } catch {
    return false;
  }
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeSettings(s) {
  const src = s || {};
  return {
    model: typeof src.model === 'string' && MODEL_RE.test(src.model) ? src.model : '',
    effort: EFFORT_LEVELS.includes(src.effort) ? src.effort : '',
    permissionMode: PERMISSION_MODES.includes(src.permissionMode) ? src.permissionMode : 'default',
  };
}

// Only accept answers for the questions Claude actually asked, all of them non-empty.
function cleanAnswers(answers, input) {
  if (!answers || typeof answers !== 'object') return null;
  const questions = Array.isArray(input && input.questions) ? input.questions : [];
  if (!questions.length) return null;
  const out = {};
  for (const q of questions) {
    const value = answers[q.question];
    if (typeof value !== 'string' || !value.trim()) return null;
    out[q.question] = value.trim().slice(0, MAX_ANSWER_CHARS);
  }
  return out;
}

class InputQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }

  push(item) {
    if (this.closed) return false;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
    return true;
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

class ChatSession {
  constructor(manager, name) {
    this.manager = manager;
    this.name = name;
    this.cwd = manager.workdirFor(name);
    this.dir = path.join(manager.chatsRoot, name);
    this.stateFile = path.join(this.dir, 'state.json');
    this.eventsFile = path.join(this.dir, 'events.jsonl');
    this.clients = new Set();
    this.run = null;
    this.starting = null;
    this.running = false;
    this.stopRequested = false;
    this.unanswered = [];
    this.pending = new Map();
    this.deferredPerms = new Map();
    this.seenToolIds = new Set();
    this.drafts = new Map();
    this.dirtyDrafts = new Set();
    this.draftTimer = null;
    this.currentMessageId = null;
    this.lastInit = null;
    // Where each MCP server is defined, from the last live list: the list
    // kept while Claude is stopped still says what can be removed.
    this.mcpScopes = new Map();
    this.idleTimer = null;
    this.mediaDir = path.join(this.dir, 'media');
    this.filesDir = path.join(this.dir, 'files');
    this.toolNames = new Map();
    this.uploads = new Map();
    // MCP server name -> the Claude process its sign-in was started in.
    this.authRuns = new Map();
    // An MCP server was removed while Claude was answering.
    this.restartPending = false;
    this.turn = null;
    this.usageTimer = null;
    this.seq = 0;
    this.state = this.loadState();
    this.events = this.loadEvents();
  }

  loadState() {
    const saved = readJson(this.stateFile, null);
    if (!saved) return { sessionId: null, settings: { ...this.manager.defaults }, usageBase: null };
    return {
      sessionId: typeof saved.sessionId === 'string' ? saved.sessionId : null,
      settings: this.manager.normalize(saved.settings),
      usageBase: saved.usageBase && typeof saved.usageBase === 'object' ? saved.usageBase : null,
    };
  }

  saveState() {
    writeJson(this.stateFile, this.state);
  }

  loadEvents() {
    let lines;
    try {
      lines = fs.readFileSync(this.eventsFile, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
    const events = [];
    for (const line of lines.slice(-MAX_HISTORY)) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // yarim yazilmis satir, atla
      }
    }
    if (lines.length > MAX_HISTORY * 2) {
      try {
        fs.writeFileSync(this.eventsFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      } catch (err) {
        console.error('[chat] gecmis sikistirilamadi:', err.message);
      }
    }
    this.seq = events.length ? events[events.length - 1].seq || events.length : 0;
    // A server restart kills the Claude process, so permission prompts left
    // open in the log can never be answered anymore.
    const done = new Set(events.filter((e) => e.t === 'perm_done').map((e) => e.id));
    const stale = events.filter((e) => e.t === 'perm' && !done.has(e.id));
    for (const e of stale) {
      const closed = { t: 'perm_done', id: e.id, decision: 'cancelled', seq: ++this.seq, ts: Date.now() };
      events.push(closed);
      this.appendToDisk(closed);
    }
    return events;
  }

  appendToDisk(event) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.eventsFile, JSON.stringify(event) + '\n');
    } catch (err) {
      console.error('[chat] olay yazilamadi:', err.message);
    }
  }

  addEvent(ev) {
    const event = { ...ev, seq: ++this.seq, ts: Date.now() };
    this.events.push(event);
    if (this.events.length > MAX_HISTORY) this.events.splice(0, this.events.length - MAX_HISTORY);
    this.appendToDisk(event);
    this.broadcast({ type: 'event', event });
    return event;
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  status() {
    return {
      running: this.running,
      settings: this.state.settings,
      hasSession: !!this.state.sessionId,
      models: this.manager.getModels(),
      modelsSource: this.manager.models ? 'cli' : 'fallback',
      init: this.lastInit,
      rateLimit: this.manager.rateLimit,
      canBypass: this.manager.canBypass,
      cwd: this.cwd,
      turn: this.running ? this.publicTurn() : null,
      now: Date.now(),
    };
  }

  broadcastStatus() {
    this.broadcast({ type: 'status', status: this.status() });
  }

  // origin: the page's origin as the browser reported it; OAuth sign-ins
  // redirect back to it.
  attach(ws, origin) {
    ws.agentwebOrigin = normalizeOrigin(origin);
    this.clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', history: this.events, status: this.status() }));
    for (const [key, draft] of this.drafts) {
      ws.send(JSON.stringify({ type: 'draft', key, kind: draft.kind, text: draft.text }));
    }
    ws.on('message', (raw) => this.handleClientMessage(raw, ws));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  handleClientMessage(raw, ws) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const fail = (err) => this.addEvent({ t: 'error', message: errMessage(err) });
    switch (msg.type) {
      case 'send':
        this.send(typeof msg.text === 'string' ? msg.text : '', msg.attachments).catch(fail);
        break;
      case 'stop':
        this.stop().catch(fail);
        break;
      case 'perm':
        this.answerPermission(String(msg.id || ''), msg);
        break;
      case 'settings':
        this.applySettings(msg.settings || {}).catch(fail);
        break;
      case 'new_chat':
        this.newChat();
        break;
      case 'mcp_status':
        this.sendMcpStatus(ws, null, msg.start === true).catch(() => {});
        break;
      case 'mcp_reconnect':
        this.reconnectMcp(ws, msg.name).catch(() => {});
        break;
      case 'mcp_auth':
        this.authenticateMcp(ws, msg.name).catch(() => {});
        break;
      case 'mcp_auth_url':
        this.submitMcpCallback(msg.name, msg.url).catch(() => {});
        break;
      case 'mcp_remove':
        this.removeMcp(ws, msg.name, msg.scope).catch(() => {});
        break;
      case 'mcp_toggle':
        this.toggleMcp(ws, msg.name, msg.enabled).catch(() => {});
        break;
      case 'restart':
        this.restart(ws);
        break;
      default:
        break;
    }
  }

  async send(text, attachmentIds) {
    const prompt = text.trim();
    if (prompt.length > MAX_PROMPT_CHARS) {
      this.addEvent({ t: 'error', message: 'Mesaj çok uzun.' });
      return;
    }
    const files = this.takeUploads(attachmentIds);
    if (!prompt && !files.length) return;
    const uuid = crypto.randomUUID();
    const event = { t: 'user', text: prompt, uuid };
    if (files.length) {
      event.attachments = files.map((f) => ({ name: f.name, path: f.path, size: f.size, image: f.image, mediaId: f.mediaId }));
    }
    this.addEvent(event);
    const content = this.buildUserContent(prompt, files);
    const message = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid };
    this.unanswered.push(message);
    if (!this.running) this.startTurn();
    this.running = true;
    this.clearIdle();
    this.broadcastStatus();
    try {
      await this.ensureQuery();
      this.run.input.push(message);
    } catch (err) {
      this.unanswered = [];
      this.running = false;
      this.addEvent({ t: 'error', message: `Claude başlatılamadı: ${errMessage(err)}` });
      this.broadcastStatus();
    }
  }

  ensureQuery() {
    if (this.run) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.startQuery().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  async startQuery() {
    const { query } = await this.manager.loadSdk();
    this.manager.ensureWorkspace(this.name);
    const settings = this.state.settings;
    const run = {
      input: new InputQueue(),
      abortController: new AbortController(),
      query: null,
      resumedFrom: this.state.sessionId,
      sawInit: false,
      closing: false,
      stderr: [],
    };
    const options = {
      cwd: this.cwd,
      abortController: run.abortController,
      env: this.manager.childEnv,
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', snapshot: true, append: this.manager.systemPromptAppend },
      permissionMode: settings.permissionMode,
      canUseTool: (toolName, toolInput, opts) => this.requestPermission(toolName, toolInput, opts),
      stderr: (data) => this.captureStderr(run, data),
    };
    // Claude Code refuses to start as root with this flag; there bypass mode is simply unavailable.
    if (this.manager.canBypass) options.allowDangerouslySkipPermissions = true;
    if (settings.model) options.model = settings.model;
    if (settings.effort) options.effort = settings.effort;
    if (this.manager.supportsAdaptive(settings.model)) {
      options.thinking = { type: 'adaptive', display: 'summarized' };
    }
    if (this.state.sessionId) options.resume = this.state.sessionId;

    run.query = query({ prompt: run.input, options });
    this.run = run;
    // A fresh process reads the current MCP configuration.
    this.restartPending = false;
    this.consume(run);
    // Refreshed on every start: a newer Claude Code may list new models.
    run.query.supportedModels().then((models) => this.manager.setModels(models)).catch(() => {});
  }

  captureStderr(run, data) {
    for (const line of String(data).split('\n')) {
      if (line.trim()) run.stderr.push(line);
    }
    if (run.stderr.length > 30) run.stderr.splice(0, run.stderr.length - 30);
  }

  async consume(run) {
    let failure = null;
    try {
      for await (const msg of run.query) {
        // After a new chat / forced stop the old process may still flush a
        // few buffered frames; they must not leak into the next conversation.
        if (run.closing) continue;
        if (msg && msg.type === 'system' && msg.subtype === 'init') run.sawInit = true;
        this.handleSdkMessage(msg, run);
      }
    } catch (err) {
      if (!run.closing) failure = err;
    }

    if (this.run === run) this.run = null;
    this.cancelPendingPermissions();
    this.clearDrafts(!run.closing);

    // A resume that dies before the first init almost always means the old
    // transcript is gone (e.g. HOME was not persistent); retry as a fresh chat.
    if (!run.closing && !run.sawInit && run.resumedFrom && this.unanswered.length) {
      this.state.sessionId = null;
      this.saveState();
      this.addEvent({ t: 'notice', text: 'Önceki konuşma devam ettirilemedi, yeni bir konuşma başlatıldı.' });
      const retry = this.unanswered.splice(0);
      try {
        await this.ensureQuery();
        this.unanswered.push(...retry);
        for (const message of retry) this.run.input.push(message);
        return;
      } catch (err) {
        failure = err;
      }
    }

    if (!run.closing && (failure || this.running)) {
      const tail = run.stderr.slice(-5).join('\n');
      const reason = failure ? errMessage(failure) : 'Claude süreci beklenmedik şekilde kapandı.';
      this.addEvent({ t: 'error', message: tail ? `${reason}\n${tail}` : reason });
    }
    this.unanswered = [];
    if (this.running) {
      this.running = false;
      this.turn = null;
      this.broadcastStatus();
    }
  }

  handleSdkMessage(msg, run) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'system':
        this.handleSystem(msg);
        break;
      case 'stream_event':
        this.handleStreamEvent(msg);
        break;
      case 'assistant':
        this.handleAssistant(msg);
        break;
      case 'user':
        this.handleUser(msg);
        break;
      case 'result':
        this.handleResult(msg, run);
        break;
      case 'rate_limit_event':
        this.manager.setRateLimit(msg.rate_limit_info || null);
        break;
      case 'auth_status':
        if (msg.error) this.addEvent({ t: 'error', message: `Kimlik doğrulama: ${msg.error}` });
        break;
      default:
        break;
    }
  }

  handleSystem(msg) {
    if (msg.subtype === 'init') {
      if (msg.session_id && msg.session_id !== this.state.sessionId) {
        this.state.sessionId = msg.session_id;
        this.saveState();
      }
      this.lastInit = {
        model: msg.model || '',
        permissionMode: msg.permissionMode || '',
        effort: msg.effort === undefined ? undefined : msg.effort,
        mcp: Array.isArray(msg.mcp_servers) ? msg.mcp_servers.map((s) => ({ name: s.name, status: s.status })) : [],
        version: msg.claude_code_version || '',
        auth: msg.apiKeySource || '',
      };
      this.syncPermissionMode(msg.permissionMode);
      this.broadcastStatus();
    } else if (msg.subtype === 'status') {
      this.syncPermissionMode(msg.permissionMode);
    } else if (msg.subtype === 'compact_boundary') {
      this.addEvent({ t: 'notice', text: 'Konuşma bağlamı sıkıştırıldı.' });
    } else if (msg.subtype === 'api_retry') {
      this.broadcast({
        type: 'live',
        text: `API hatası, yeniden deneniyor (${msg.attempt}/${msg.max_retries})…`,
      });
    }
  }

  syncPermissionMode(mode) {
    if (!PERMISSION_MODES.includes(mode) || mode === this.state.settings.permissionMode) return;
    this.state.settings = { ...this.state.settings, permissionMode: mode };
    this.saveState();
    this.broadcastStatus();
  }

  handleStreamEvent(msg) {
    this.trackUsage(msg);
    if (msg.parent_tool_use_id) return;
    const ev = msg.event;
    if (!ev) return;
    if (ev.type === 'message_start') {
      this.currentMessageId = ev.message && ev.message.id;
    } else if (ev.type === 'content_block_start') {
      const block = ev.content_block || {};
      if (block.type !== 'text' && block.type !== 'thinking') return;
      const key = `${this.currentMessageId}:${ev.index}`;
      this.drafts.set(key, { kind: block.type, text: '', messageId: this.currentMessageId });
      this.broadcast({ type: 'draft', key, kind: block.type, text: '' });
    } else if (ev.type === 'content_block_delta') {
      const key = `${this.currentMessageId}:${ev.index}`;
      const draft = this.drafts.get(key);
      if (!draft || !ev.delta) return;
      if (ev.delta.type === 'text_delta') draft.text += ev.delta.text || '';
      else if (ev.delta.type === 'thinking_delta') draft.text += ev.delta.thinking || '';
      else return;
      this.dirtyDrafts.add(key);
      if (!this.draftTimer) this.draftTimer = setTimeout(() => this.flushDrafts(), DRAFT_FLUSH_MS);
    }
  }

  flushDrafts() {
    this.draftTimer = null;
    for (const key of this.dirtyDrafts) {
      const draft = this.drafts.get(key);
      if (draft) this.broadcast({ type: 'draft', key, kind: draft.kind, text: draft.text });
    }
    this.dirtyDrafts.clear();
  }

  // The CLI emits one assistant message per completed block, in block order,
  // so the oldest open draft of the same kind is the one that just finished.
  // Returns its key so the client can swap that exact draft for the final block.
  finishDraft(messageId, kind) {
    for (const [key, draft] of this.drafts) {
      if (draft.messageId === messageId && draft.kind === kind) {
        this.drafts.delete(key);
        this.dirtyDrafts.delete(key);
        this.broadcast({ type: 'draft_done', key });
        return key;
      }
    }
    return null;
  }

  // Blocks still streaming when a turn ends (stop, crash) never get a final
  // assistant message; with keepText what was already shown stays in history.
  clearDrafts(keepText) {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    this.dirtyDrafts.clear();
    const open = [...this.drafts];
    this.drafts.clear();
    for (const [key, draft] of open) {
      this.broadcast({ type: 'draft_done', key });
      if (keepText && draft.text.trim()) {
        this.addEvent({ t: draft.kind, text: draft.text, parent: null, partial: true, draftKey: key });
      }
    }
  }

  handleAssistant(msg) {
    const message = msg.message || {};
    const parent = msg.parent_tool_use_id || null;
    // For API-level failures the CLI's text block is a synthetic English error
    // ("Invalid API key · Please run /login"); the Turkish explanation replaces it.
    // A max_output_tokens message still carries real (truncated) content.
    const replaced = !!(msg.error && ASSISTANT_ERRORS[msg.error]) && msg.error !== 'max_output_tokens';
    if (msg.error && ASSISTANT_ERRORS[msg.error]) {
      this.addEvent({ t: 'error', code: msg.error, message: ASSISTANT_ERRORS[msg.error] });
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (!block) continue;
      if (block.type === 'text') {
        const draftKey = parent ? null : this.finishDraft(message.id, 'text');
        if (block.text && !replaced) this.addEvent({ t: 'text', text: block.text, parent, draftKey });
      } else if (block.type === 'thinking') {
        const draftKey = parent ? null : this.finishDraft(message.id, 'thinking');
        if (block.thinking) this.addEvent({ t: 'thinking', text: block.thinking, parent, draftKey });
      } else if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') {
        this.addEvent({ t: 'tool', id: block.id, name: block.name, input: capInput(block.input), parent });
        this.seenToolIds.add(block.id);
        this.rememberToolName(block.id, block.name);
        this.releaseDeferredPerm(block.id);
      } else if (typeof block.type === 'string' && block.type.endsWith('_tool_result') && block.tool_use_id) {
        const content = typeof block.content === 'object' ? JSON.stringify(block.content) : block.content;
        this.addEvent({ t: 'tool_result', id: block.tool_use_id, content: truncate(String(content || ''), MAX_TOOL_TEXT), isError: false, parent });
      }
    }
  }

  handleUser(msg) {
    if (msg.isReplay) return;
    const content = msg.message && msg.message.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block && block.type === 'tool_result') {
        const event = {
          t: 'tool_result',
          id: block.tool_use_id,
          content: toolResultText(block.content),
          isError: !!block.is_error,
          parent: msg.parent_tool_use_id || null,
        };
        const images = this.extractImages(block.content);
        if (images.length) event.images = images;
        if (this.toolNames.get(block.tool_use_id) === SHARE_TOOL && !block.is_error) {
          const shared = this.collectSharedFiles(block.content);
          event.content = shared.text;
          if (shared.files.length) event.files = shared.files;
          if (shared.errors.length) event.content = [event.content, ...shared.errors].filter(Boolean).join('\n');
        }
        this.addEvent(event);
      }
    }
  }

  rememberToolName(id, name) {
    if (typeof id !== 'string' || typeof name !== 'string') return;
    this.toolNames.set(id, name);
    if (this.toolNames.size > MAX_TOOL_NAMES) this.toolNames.delete(this.toolNames.keys().next().value);
  }

  // ---- files Claude shares with the user (share_file) ----

  // The MCP tool validated the paths and lists them in a JSON text block;
  // copies are kept with the chat, so later edits or deletes in the working
  // directory do not change what was shared.
  collectSharedFiles(content) {
    const blocks = Array.isArray(content) ? content : typeof content === 'string' ? [{ type: 'text', text: content }] : [];
    const notes = [];
    let list = null;
    for (const block of blocks) {
      if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
      const raw = block.text.trim();
      if (raw.startsWith('{"agentwebShare"')) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.agentwebShare)) list = parsed.agentwebShare;
        } catch {
          // bozuk liste; asagida hata olarak raporlanir
        }
      } else if (raw) {
        notes.push(raw);
      }
    }
    const result = { text: truncate(notes.join('\n'), MAX_TOOL_TEXT), files: [], errors: [] };
    if (!list) {
      result.errors.push('Paylaşılan dosya listesi okunamadı.');
      return result;
    }
    let total = 0;
    for (const item of list.slice(0, MAX_ATTACHMENTS)) {
      const src = item && typeof item.path === 'string' ? item.path : '';
      const label = safeFileName(item && item.name ? item.name : path.basename(src));
      try {
        if (!path.isAbsolute(src) || src.includes('\0')) throw new Error('geçersiz yol');
        const stat = fs.statSync(src);
        if (!stat.isFile()) throw new Error('normal bir dosya değil');
        if (SYSTEM_PATH_RE.test(fs.realpathSync(src))) throw new Error('sistem dosyası');
        if (stat.size > MAX_SHARE_BYTES) throw new Error('50 MB sınırını aşıyor');
        total += stat.size;
        if (total > MAX_SHARE_TOTAL) throw new Error('toplam 100 MB sınırı aşıldı');
        result.files.push(this.storeSharedFile(src, label, stat.size));
      } catch (err) {
        result.errors.push(`${label} paylaşılamadı: ${errMessage(err)}`);
      }
    }
    this.pruneSharedFiles();
    return result;
  }

  storeSharedFile(src, name, size) {
    const id = crypto.randomUUID();
    const dir = path.join(this.filesDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, 'content');
    try {
      fs.copyFileSync(src, dest);
      const head = Buffer.alloc(16);
      const fd = fs.openSync(dest, 'r');
      try {
        fs.readSync(fd, head, 0, 16, 0);
      } finally {
        fs.closeSync(fd);
      }
      const imageType = sniffImage(head);
      let mediaId = null;
      if (imageType && size <= MAX_MEDIA_BYTES) mediaId = this.saveMedia(fs.readFileSync(dest), imageType);
      const text = !imageType && size <= MAX_TEXT_PREVIEW && looksLikeText(fs.readFileSync(dest));
      const meta = { id, name, size, image: !!imageType, mediaId, text, createdAt: Date.now() };
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
      return { id, name, size, image: meta.image, mediaId, text };
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  }

  pruneSharedFiles() {
    let entries;
    try {
      entries = fs.readdirSync(this.filesDir).filter((f) => FILE_ID_RE.test(f));
    } catch {
      return;
    }
    const metas = entries
      .map((id) => readJson(path.join(this.filesDir, id, 'meta.json'), null) || { id, size: 0, createdAt: 0 })
      .sort((a, b) => num(a.createdAt) - num(b.createdAt));
    let bytes = metas.reduce((sum, m) => sum + num(m.size), 0);
    let count = metas.length;
    for (const meta of metas) {
      if (count <= MAX_SHARED_FILES && bytes <= MAX_SHARED_DISK) break;
      fs.rmSync(path.join(this.filesDir, meta.id), { recursive: true, force: true });
      count -= 1;
      bytes -= num(meta.size);
    }
  }

  handleResult(msg, run) {
    this.clearDrafts(true);
    const ok = msg.subtype === 'success' && !msg.is_error;
    const event = {
      t: 'result',
      ok,
      subtype: msg.subtype,
      durationMs: msg.duration_ms,
      numTurns: msg.num_turns,
    };
    const usage = this.turnUsage(msg, run);
    // The cost estimate only means money when an API key pays for the calls.
    if (this.lastInit && this.lastInit.auth && this.lastInit.auth !== 'none') event.apiKey = true;
    if (usage) {
      event.usage = { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite };
      if (usage.cost > 0) event.cost = Math.round(usage.cost * 1e6) / 1e6;
      if (usage.models && usage.models.length) event.models = usage.models;
    }
    if (this.stopRequested) {
      event.stopped = true;
      this.stopRequested = false;
    } else if (!ok) {
      const errors = Array.isArray(msg.errors) ? msg.errors.join('\n') : '';
      event.error = errors || (msg.subtype === 'success' ? '' : msg.subtype);
      if (msg.api_error_status) event.apiErrorStatus = msg.api_error_status;
    }
    this.addEvent(event);
    if (!msg.queued_turn_count) {
      this.running = false;
      this.turn = null;
      this.unanswered = [];
      this.seenToolIds.clear();
      this.scheduleIdle();
      // An MCP server was removed during the turn: the next message starts
      // a Claude without it.
      if (this.restartPending && this.run && this.pending.size === 0) {
        this.restartPending = false;
        this.closeRun(this.run, false);
        this.authRuns.clear();
        this.broadcastMcpStatus().catch(() => {});
      }
    } else {
      this.startTurn();
    }
    this.broadcastStatus();
  }

  // ---- per-turn time and token accounting ----

  startTurn() {
    this.turn = {
      startedAt: Date.now(),
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      outputs: new Map(),
      current: new Map(),
      chars: new Map(),
      exact: new Set(),
    };
  }

  publicTurn() {
    const t = this.turn;
    if (!t) return null;
    return { startedAt: t.startedAt, input: t.input, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, output: t.output };
  }

  // Live counter from the stream: every API call starts with its input usage
  // (message_start) and ends with its exact output count (message_delta); in
  // between the output is estimated from the streamed text (~4 chars a token).
  trackUsage(msg) {
    const t = this.turn;
    const ev = msg.event;
    if (!t || !ev) return;
    const stream = msg.parent_tool_use_id || 'main';
    if (ev.type === 'message_start' && ev.message) {
      const u = ev.message.usage || {};
      t.input += num(u.input_tokens);
      t.cacheRead += num(u.cache_read_input_tokens);
      t.cacheWrite += num(u.cache_creation_input_tokens);
      const id = ev.message.id || `${stream}:${t.outputs.size}`;
      t.current.set(stream, id);
      t.outputs.set(id, num(u.output_tokens));
    } else if (ev.type === 'content_block_delta' && ev.delta) {
      const id = t.current.get(stream);
      if (id === undefined || t.exact.has(id)) return;
      const d = ev.delta;
      const chars = String(d.text || d.thinking || d.partial_json || '').length;
      if (!chars) return;
      t.chars.set(id, (t.chars.get(id) || 0) + chars);
      t.outputs.set(id, Math.max(t.outputs.get(id) || 0, Math.ceil(t.chars.get(id) / 4)));
    } else if (ev.type === 'message_delta' && ev.usage && typeof ev.usage.output_tokens === 'number') {
      const id = t.current.get(stream);
      if (id === undefined) return;
      t.outputs.set(id, ev.usage.output_tokens);
      t.exact.add(id);
    } else {
      return;
    }
    let output = 0;
    for (const value of t.outputs.values()) output += value;
    t.output = output;
    if (!this.usageTimer) {
      this.usageTimer = setTimeout(() => {
        this.usageTimer = null;
        if (this.turn) this.broadcast({ type: 'usage', turn: this.publicTurn(), now: Date.now() });
      }, USAGE_FLUSH_MS);
    }
  }

  // Final numbers for a turn: the change in the SDK's running per-model totals
  // (covers subagents too). A resumed session starts from the totals saved in
  // its transcript, so the last totals we saw are kept in state.json as the
  // baseline. Falls back to the main-loop usage, then to the live counter.
  turnUsage(msg, run) {
    const cumulative = totalsFromModelUsage(msg.modelUsage);
    let turn = null;
    if (tokenSum(cumulative) > 0) {
      let base = run ? run.usageBase : undefined;
      if (base === undefined) base = run && run.resumedFrom ? this.state.usageBase : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, models: {} };
      if (base) turn = usageDelta(cumulative, base);
      if (run) run.usageBase = cumulative;
      this.state.usageBase = cumulative;
      this.saveState();
    }
    if (tokenSum(turn) > 0) return turn;
    const main = msg.usage || {};
    const fromMain = {
      input: num(main.input_tokens),
      output: num(main.output_tokens),
      cacheRead: num(main.cache_read_input_tokens),
      cacheWrite: num(main.cache_creation_input_tokens),
      cost: 0,
      models: [],
    };
    if (tokenSum(fromMain) > 0) return fromMain;
    const live = this.publicTurn();
    return tokenSum(live) > 0 ? { ...live, cost: 0, models: [] } : null;
  }

  // ---- images and uploads ----

  saveMedia(buffer, mediaType) {
    const ext = MEDIA_EXT[mediaType];
    if (!ext) return null;
    try {
      fs.mkdirSync(this.mediaDir, { recursive: true });
      const id = `${crypto.randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(this.mediaDir, id), buffer);
      this.pruneMedia();
      return id;
    } catch (err) {
      console.error('[chat] gorsel kaydedilemedi:', err.message);
      return null;
    }
  }

  pruneMedia() {
    let files;
    try {
      files = fs.readdirSync(this.mediaDir);
    } catch {
      return;
    }
    if (files.length <= MAX_MEDIA_FILES) return;
    const dated = files.map((f) => {
      try {
        return { f, t: fs.statSync(path.join(this.mediaDir, f)).mtimeMs };
      } catch {
        return { f, t: 0 };
      }
    });
    dated.sort((a, b) => a.t - b.t);
    for (const { f } of dated.slice(0, dated.length - MAX_MEDIA_FILES)) {
      fs.rmSync(path.join(this.mediaDir, f), { force: true });
    }
  }

  // Screenshots (e.g. Playwright's browser_take_screenshot) and images read
  // by tools arrive as base64 blocks; keep them as files, not in the history.
  extractImages(content) {
    const images = [];
    if (!Array.isArray(content)) return images;
    for (const block of content) {
      if (images.length >= MAX_IMAGES_PER_RESULT) break;
      if (!block || block.type !== 'image' || !block.source || block.source.type !== 'base64') continue;
      const data = block.source.data;
      if (typeof data !== 'string') continue;
      if (data.length > Math.ceil((MAX_MEDIA_BYTES * 4) / 3) + 4) {
        images.push({ error: 'too-large' });
        continue;
      }
      const buffer = Buffer.from(data, 'base64');
      const type = sniffImage(buffer);
      if (!type) continue;
      const id = this.saveMedia(buffer, type);
      if (id) images.push({ id, type });
    }
    return images;
  }

  async saveUpload(req, fileName, declaredType) {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_UPLOAD_BYTES) throw httpError(413, 'Dosya çok büyük (en fazla 50 MB).');
    this.manager.ensureWorkspace(this.name);
    const dir = path.join(this.cwd, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.yukleniyor-${crypto.randomUUID()}`);
    let size = 0;
    let head = Buffer.alloc(0);
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) {
          callback(httpError(413, 'Dosya çok büyük (en fazla 50 MB).'));
          return;
        }
        if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(req, meter, fs.createWriteStream(tmp, { flags: 'wx' }));
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err.status ? err : httpError(400, 'Yükleme yarıda kesildi.');
    }
    if (!size) {
      fs.rmSync(tmp, { force: true });
      throw httpError(400, 'Dosya boş.');
    }
    const name = uniqueName(dir, safeFileName(fileName));
    const abs = path.join(dir, name);
    fs.renameSync(tmp, abs);
    const imageType = sniffImage(head);
    let mediaId = null;
    if (imageType && size <= MAX_MEDIA_BYTES) {
      try {
        mediaId = this.saveMedia(fs.readFileSync(abs), imageType);
      } catch {
        mediaId = null;
      }
    }
    const typeOk = typeof declaredType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(declaredType);
    const info = {
      id: crypto.randomUUID(),
      name,
      path: `uploads/${name}`,
      size,
      mediaType: imageType || (typeOk ? declaredType : 'application/octet-stream'),
      image: !!imageType,
      mediaId,
    };
    this.pruneUploads();
    this.uploads.set(info.id, { ...info, abs, createdAt: Date.now() });
    return info;
  }

  pruneUploads() {
    const cutoff = Date.now() - UPLOAD_TTL_MS;
    for (const [id, upload] of this.uploads) {
      if (upload.createdAt < cutoff) this.uploads.delete(id);
    }
  }

  // Removing a chip before sending also removes the file it uploaded.
  deleteUpload(id) {
    const upload = this.uploads.get(id);
    if (!upload) return false;
    this.uploads.delete(id);
    fs.rmSync(upload.abs, { force: true });
    if (upload.mediaId) fs.rmSync(path.join(this.mediaDir, upload.mediaId), { force: true });
    return true;
  }

  takeUploads(ids) {
    const files = [];
    if (!Array.isArray(ids)) return files;
    for (const id of ids.slice(0, MAX_ATTACHMENTS)) {
      const upload = typeof id === 'string' ? this.uploads.get(id) : null;
      if (!upload) continue;
      this.uploads.delete(id);
      files.push(upload);
    }
    return files;
  }

  // Images go to Claude as image blocks; every file is also in the working
  // directory, and the note tells Claude where, so tools can open it.
  buildUserContent(prompt, files) {
    if (!files.length) return prompt;
    const blocks = [];
    const notes = [];
    for (const file of files) {
      let inline = false;
      if (file.image && file.size <= MAX_INLINE_IMAGE_BYTES) {
        try {
          const data = fs.readFileSync(file.abs).toString('base64');
          blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data } });
          inline = true;
        } catch {
          inline = false;
        }
      }
      notes.push(`${file.path} (${inline ? 'image, attached above' : formatBytes(file.size)})`);
    }
    const note = `[Attached files, saved in the working directory: ${notes.join(', ')}]`;
    blocks.push({ type: 'text', text: prompt ? `${prompt}\n\n${note}` : note });
    return blocks;
  }

  requestPermission(toolName, toolInput, opts) {
    const options = opts || {};
    if (AUTO_ALLOW_TOOLS.has(toolName)) {
      return Promise.resolve({ behavior: 'allow', updatedInput: toolInput || {} });
    }
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const kind = toolName === 'AskUserQuestion' ? 'question' : toolName === 'ExitPlanMode' ? 'plan' : 'tool';
      const suggestions = Array.isArray(options.suggestions) ? options.suggestions : [];
      const canAlways = kind === 'tool' && suggestions.length > 0 && !options.suppressAlwaysAllowRule;
      this.pending.set(id, { resolve, kind, input: toolInput || {}, suggestions, canAlways });
      const event = {
        t: 'perm',
        id,
        kind,
        toolName,
        toolUseId: options.toolUseID || null,
        input: capInput(toolInput),
        title: options.title || '',
        displayName: options.displayName || '',
        description: options.description || '',
        reason: options.decisionReason || '',
        blockedPath: options.blockedPath || '',
        mcpServer: options.mcpServer ? options.mcpServer.name : '',
        canAlways,
        defaultToNo: !!options.defaultToNo,
      };
      // The SDK dispatches control requests as soon as they are read, while the
      // assistant/tool_use frames before them may still sit in its message
      // queue. Hold the prompt until its tool card exists so history reads in order.
      const toolUseId = options.toolUseID;
      if (toolUseId && !this.seenToolIds.has(toolUseId)) {
        const timer = setTimeout(() => this.releaseDeferredPerm(toolUseId), 500);
        this.deferredPerms.set(toolUseId, { event, timer });
      } else {
        this.addEvent(event);
      }
      const signal = options.signal;
      if (signal) {
        const onAbort = () => this.settlePermission(id, { behavior: 'deny', message: 'İstek iptal edildi.' }, 'cancelled');
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  releaseDeferredPerm(toolUseId) {
    const deferred = this.deferredPerms.get(toolUseId);
    if (!deferred) return;
    clearTimeout(deferred.timer);
    this.deferredPerms.delete(toolUseId);
    this.addEvent(deferred.event);
  }

  settlePermission(id, result, decision, extra) {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    pending.resolve(result);
    for (const [toolUseId, deferred] of this.deferredPerms) {
      if (deferred.event.id === id) {
        // Settled (cancelled) before the prompt was ever shown: nothing to close in the UI.
        clearTimeout(deferred.timer);
        this.deferredPerms.delete(toolUseId);
        return true;
      }
    }
    this.addEvent({ t: 'perm_done', id, decision, ...(extra || {}) });
    return true;
  }

  answerPermission(id, msg) {
    const pending = this.pending.get(id);
    if (!pending) return;
    if (msg.decision === 'deny') {
      this.settlePermission(id, { behavior: 'deny', message: 'Kullanıcı bu işlemi reddetti.' }, 'deny');
      return;
    }
    if (pending.kind === 'question') {
      const answers = cleanAnswers(msg.answers, pending.input);
      if (!answers) return;
      this.settlePermission(id, { behavior: 'allow', updatedInput: { ...pending.input, answers } }, 'allow', { answers });
      return;
    }
    if (pending.kind === 'plan') {
      const mode = msg.planMode === 'acceptEdits' ? 'acceptEdits' : 'default';
      const settled = this.settlePermission(
        id,
        { behavior: 'allow', updatedInput: pending.input, updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }] },
        'allow',
        { planMode: mode }
      );
      if (settled) this.syncPermissionMode(mode);
      return;
    }
    const always = msg.decision === 'always' && pending.canAlways;
    const result = { behavior: 'allow', updatedInput: pending.input };
    if (always) result.updatedPermissions = pending.suggestions;
    this.settlePermission(id, result, always ? 'always' : 'allow');
  }

  cancelPendingPermissions() {
    for (const id of [...this.pending.keys()]) {
      this.settlePermission(id, { behavior: 'deny', message: 'Oturum sona erdi.' }, 'cancelled');
    }
  }

  async applySettings(patch) {
    const before = this.state.settings;
    const next = this.manager.normalize({ ...before, ...patch });
    this.state.settings = next;
    this.saveState();
    this.manager.rememberDefaults(next);
    this.broadcastStatus();
    const run = this.run;
    if (!run) return;
    if (next.model !== before.model) await run.query.setModel(next.model || undefined);
    if (next.effort !== before.effort) await run.query.applyFlagSettings({ effortLevel: next.effort || null });
    if (next.permissionMode !== before.permissionMode) await run.query.setPermissionMode(next.permissionMode);
  }

  async stop() {
    const run = this.run;
    if (!run || !this.running) return;
    this.stopRequested = true;
    const kill = () => {
      this.closeRun(run, true);
      this.clearDrafts(true);
      const event = { t: 'result', ok: false, stopped: true, subtype: 'stopped' };
      const live = this.publicTurn();
      if (live) {
        event.durationMs = Date.now() - live.startedAt;
        if (tokenSum(live) > 0) event.usage = { input: live.input, output: live.output, cacheRead: live.cacheRead, cacheWrite: live.cacheWrite };
      }
      this.running = false;
      this.turn = null;
      this.unanswered = [];
      this.addEvent(event);
      this.broadcastStatus();
    };
    try {
      await run.query.interrupt();
    } catch {
      kill();
      return;
    }
    setTimeout(() => {
      if (this.run === run && this.running) kill();
    }, STOP_KILL_MS).unref();
  }

  closeRun(run, force) {
    run.closing = true;
    run.input.close();
    if (force) {
      run.abortController.abort();
    } else {
      setTimeout(() => run.abortController.abort(), 5000).unref();
    }
    if (this.run === run) this.run = null;
  }

  // Live MCP status needs a running Claude process; otherwise the list from the
  // last start is all there is (start: launch Claude to get the live list).
  async mcpStatusReply(start) {
    let startError = '';
    if (start && !this.run) {
      try {
        await this.ensureLiveRun();
      } catch (err) {
        startError = `Claude başlatılamadı: ${errMessage(err)}`;
      }
    }
    const run = this.run;
    const last = this.lastInit ? this.lastInit.mcp : [];
    const reply = { type: 'mcp', live: false, servers: last.map((s) => ({ ...this.mcpScopes.get(s.name), ...s })) };
    if (startError) reply.error = startError;
    if (run && !run.closing) {
      try {
        const list = await withTimeout(run.query.mcpServerStatus(), MCP_STATUS_TIMEOUT_MS, 'MCP durumu alınamadı (zaman aşımı).');
        reply.live = true;
        reply.servers = Array.isArray(list) ? list.map(summarizeMcp) : [];
        this.mcpScopes = new Map(reply.servers.map((s) => [s.name, { scope: s.scope, source: s.source }]));
      } catch (err) {
        reply.error = errMessage(err);
      }
    }
    return reply;
  }

  async sendMcpStatus(ws, extra, start) {
    const reply = await this.mcpStatusReply(start);
    sendTo(ws, { ...reply, ...(extra || {}) });
  }

  async broadcastMcpStatus() {
    this.broadcast(await this.mcpStatusReply(false));
  }

  async reconnectMcp(ws, name) {
    const run = this.run;
    if (!run || run.closing || !validServerName(name)) {
      await this.sendMcpStatus(ws);
      return;
    }
    let error = null;
    try {
      await withTimeout(run.query.reconnectMcpServer(name), MCP_STATUS_TIMEOUT_MS * 3, 'Yeniden bağlanma zaman aşımına uğradı.');
    } catch (err) {
      error = errMessage(err);
    }
    await this.sendMcpStatus(ws, error ? { error } : null);
  }

  // A Claude process for control requests (MCP status, sign-in) even when no
  // message is being answered; an idle one closes itself like after a turn.
  async ensureLiveRun() {
    await this.ensureQuery();
    const run = this.run;
    if (!run || run.closing) throw new Error('Claude süreci hazır değil.');
    if (!this.running) this.scheduleIdle();
    return run;
  }

  // Remote MCP servers that need a login (OAuth). Claude Code's own flow
  // redirects to http://localhost:<port>/callback, which a phone cannot
  // reach; here the provider sends the browser back to this app's public
  // /oauth/callback instead, and Claude Code finishes the sign-in. Servers
  // that only accept a localhost address (or a fixed client id) still work:
  // the user pastes the address the browser could not open.
  async authenticateMcp(ws, name) {
    if (!validServerName(name)) return;
    const reply = (extra) => sendTo(ws, { type: 'mcp_auth', name, ...extra });
    let run;
    try {
      run = await this.ensureLiveRun();
    } catch (err) {
      reply({ error: `Claude başlatılamadı: ${errMessage(err)}` });
      return;
    }
    const redirectUri = this.manager.oauthRedirectUri(ws.agentwebOrigin);
    let res;
    try {
      res = await withTimeout(
        run.query.mcpAuthenticate(name, redirectUri || undefined),
        MCP_AUTH_TIMEOUT_MS,
        'Giriş başlatılamadı (zaman aşımı).'
      );
    } catch (err) {
      reply({ error: errMessage(err) });
      return;
    }
    const r = res || {};
    if (!r.requiresUserAction) {
      // Stored credentials still work; a reconnect picks them up.
      await this.reconnectQuietly(run, name);
      reply({ done: true });
      await this.broadcastMcpStatus();
      return;
    }
    const authUrl = safeAuthUrl(r.authUrl);
    if (!authUrl) {
      reply({ error: 'Sunucu geçerli bir giriş adresi vermedi.' });
      return;
    }
    let mode = 'paste';
    if (r.callbackExpected === false) {
      mode = 'external';
    } else if (r.redirectScheme === 'custom' && redirectUri && typeof r.state === 'string' && r.state) {
      mode = 'redirect';
      this.manager.addOAuthFlow(r.state, { session: this, run, server: name, redirectUri });
    }
    this.authRuns.set(name, run);
    reply({ authUrl, mode });
  }

  // The address the browser landed on after signing in, pasted by the user.
  async submitMcpCallback(name, rawUrl) {
    if (!validServerName(name)) return;
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url || url.length > MAX_CALLBACK_URL || !hasAuthCode(url)) {
      this.broadcast({
        type: 'mcp_auth_done',
        name,
        ok: false,
        error: 'Bu adreste giriş kodu yok. Girişten sonra açılan sayfanın adresinin tamamını yapıştır.',
      });
      return;
    }
    await this.finishOAuth(name, url, this.authRuns.get(name));
  }

  // Shared by the paste box and the /oauth/callback route.
  async finishOAuth(name, url, run) {
    let result;
    if (!run || run !== this.run || run.closing) {
      result = { ok: false, error: 'Bu giriş denemesi artık geçerli değil (Claude yeniden başladı). "Giriş yap"a yeniden dokun.' };
    } else {
      try {
        await withTimeout(run.query.mcpSubmitOAuthCallbackUrl(name, url), MCP_CALLBACK_TIMEOUT_MS, 'Giriş tamamlanamadı (zaman aşımı).');
        result = { ok: true };
      } catch (err) {
        result = { ok: false, error: errMessage(err) };
      }
    }
    if (result.ok) {
      if (this.authRuns.get(name) === run) this.authRuns.delete(name);
      // Claude Code leaves reconnecting to the client when the callback
      // arrives this way.
      await this.reconnectQuietly(run, name);
    }
    this.broadcast({ type: 'mcp_auth_done', name, ...result });
    if (result.ok) await this.broadcastMcpStatus();
    return result;
  }

  // Removes a server from Claude Code's configuration for good (user scope:
  // every session; local or project scope: this session's folder). Running
  // Claude processes read their MCP list at start: an idle one is restarted
  // right away (the conversation is kept), a busy one after its turn.
  async removeMcp(ws, name, scope) {
    if (!validServerName(name)) return;
    const reply = (extra) => sendTo(ws, { type: 'mcp_removed', name, ...extra });
    if (!REMOVABLE_SCOPES.has(scope)) {
      reply({ ok: false, error: 'Bu sunucu buradan kaldırılamaz.' });
      return;
    }
    this.manager.ensureWorkspace(this.name);
    const result = await this.manager.removeMcpServer(name, scope, this.cwd);
    // Already gone from the config (removed elsewhere) while Claude still
    // lists it: only the restart is left to do.
    const already = !result.ok && result.notFound && this.listsMcp(name);
    if (!result.ok && !already) {
      reply({ ok: false, error: result.error });
      return;
    }
    const hadRun = !!this.run;
    const sessions = scope === 'user' ? this.manager.allSessions() : [this];
    let pending = false;
    for (const session of sessions) {
      const deferred = session.dropMcpServer(name);
      if (session === this) pending = deferred;
      else if (session.clients.size) session.broadcastMcpStatus().catch(() => {});
    }
    reply({ ok: true, pending, ...(already ? { already: true } : {}) });
    if (hadRun && !pending) {
      // Restarted: show the live list without the removed server.
      await this.ensureLiveRun().catch(() => {});
    }
    await this.broadcastMcpStatus();
  }

  listsMcp(name) {
    return this.mcpScopes.has(name) || !!(this.lastInit && this.lastInit.mcp.some((s) => s.name === name));
  }

  // Forgets a removed MCP server; returns true when the Claude process is
  // busy and restarts only after its turn.
  dropMcpServer(name) {
    this.mcpScopes.delete(name);
    if (this.lastInit && Array.isArray(this.lastInit.mcp)) {
      this.lastInit = { ...this.lastInit, mcp: this.lastInit.mcp.filter((s) => s.name !== name) };
    }
    if (!this.run) return false;
    if (this.running || this.pending.size) {
      this.restartPending = true;
      return true;
    }
    this.closeRun(this.run, true);
    this.authRuns.clear();
    return false;
  }

  // claude.ai connectors (and any server) switched off or back on for this
  // session's folder; Claude Code keeps the choice in its project settings.
  async toggleMcp(ws, name, enabled) {
    if (!validServerName(name) || typeof enabled !== 'boolean') return;
    const reply = (extra) => sendTo(ws, { type: 'mcp_toggled', name, enabled, ...extra });
    let run;
    try {
      run = await this.ensureLiveRun();
    } catch (err) {
      reply({ ok: false, error: `Claude başlatılamadı: ${errMessage(err)}` });
      return;
    }
    try {
      await withTimeout(run.query.toggleMcpServer(name, enabled), MCP_TOGGLE_TIMEOUT_MS, 'İşlem zaman aşımına uğradı.');
    } catch (err) {
      reply({ ok: false, error: errMessage(err) });
      return;
    }
    reply({ ok: true });
    await this.broadcastMcpStatus();
  }

  async reconnectQuietly(run, name) {
    try {
      await withTimeout(run.query.reconnectMcpServer(name), MCP_STATUS_TIMEOUT_MS * 3, 'Yeniden bağlanma zaman aşımına uğradı.');
    } catch {
      // the status list shows what went wrong
    }
  }

  // MCP servers and settings are read when the Claude process starts. Closing
  // an idle process makes the next message start a fresh one that resumes the
  // same conversation with the current ~/.claude.json and .mcp.json.
  restart(ws) {
    if (this.running || this.pending.size) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'live', text: 'Claude çalışırken yeniden başlatılamaz; yanıtın bitmesini bekle ya da durdur.' }));
      }
      return;
    }
    if (this.run) this.closeRun(this.run, true);
    this.clearIdle();
    this.authRuns.clear();
    this.restartPending = false;
    this.lastInit = null;
    this.addEvent({ t: 'notice', text: 'Claude yeniden başlatıldı; MCP ve ayar değişiklikleri bir sonraki mesajla yüklenecek.' });
    this.broadcastStatus();
  }

  newChat() {
    if (this.run) this.closeRun(this.run, true);
    this.cancelPendingPermissions();
    this.clearDrafts(false);
    this.clearIdle();
    this.running = false;
    this.turn = null;
    this.stopRequested = false;
    this.unanswered = [];
    this.seenToolIds.clear();
    this.toolNames.clear();
    this.uploads.clear();
    this.authRuns.clear();
    this.restartPending = false;
    this.state.sessionId = null;
    this.state.usageBase = null;
    this.saveState();
    this.events = [];
    fs.rmSync(this.mediaDir, { recursive: true, force: true });
    fs.rmSync(this.filesDir, { recursive: true, force: true });
    try {
      fs.unlinkSync(this.eventsFile);
    } catch {
      // dosya yoksa sorun degil
    }
    this.broadcast({ type: 'reset' });
    this.broadcastStatus();
  }

  scheduleIdle() {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      if (this.run && !this.running && this.pending.size === 0) this.closeRun(this.run, false);
    }, IDLE_CLOSE_MS);
    this.idleTimer.unref();
  }

  clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  shutdown() {
    this.clearIdle();
    if (this.run) this.closeRun(this.run, true);
    this.cancelPendingPermissions();
    for (const ws of this.clients) ws.close();
    this.clients.clear();
  }
}

class ChatManager {
  constructor({ home, workspaceRoot, childEnv, ensureWorkspace, displayAvailable, publicUrl, spaceHost }) {
    this.workspaceRoot = workspaceRoot;
    this.childEnv = childEnv;
    this.ensureWorkspace = ensureWorkspace;
    this.systemPromptAppend = webUiPrompt(!!displayAvailable);
    // Where OAuth providers send the browser back to: an explicit public URL,
    // else the origin the page was opened from, else the Space's own host.
    this.publicUrl = normalizeOrigin(publicUrl);
    this.spaceHost = typeof spaceHost === 'string' && /^[A-Za-z0-9.-]+$/.test(spaceHost) ? spaceHost : '';
    // OAuth state -> sign-in waiting for its redirect to /oauth/callback.
    this.oauthFlows = new Map();
    this.root = path.join(home, '.cc-web');
    this.chatsRoot = path.join(this.root, 'chats');
    this.modelsFile = path.join(this.root, 'models.json');
    this.defaultsFile = path.join(this.root, 'defaults.json');
    this.sessions = new Map();
    this.canBypass = !(typeof process.getuid === 'function' && process.getuid() === 0);
    this.models = readJson(this.modelsFile, null);
    const saved = readJson(this.defaultsFile, {}) || {};
    this.defaults = this.normalize({ model: saved.model, effort: saved.effort });
    this.rateLimit = null;
    this.sdkPromise = null;
  }

  normalize(settings) {
    const s = normalizeSettings(settings);
    if (s.permissionMode === 'bypassPermissions' && !this.canBypass) s.permissionMode = 'default';
    return s;
  }

  loadSdk() {
    if (!this.sdkPromise) {
      this.sdkPromise = import(SDK_MODULE).catch((err) => {
        this.sdkPromise = null;
        throw err;
      });
    }
    return this.sdkPromise;
  }

  workdirFor(name) {
    return path.join(this.workspaceRoot, name);
  }

  get(name) {
    let session = this.sessions.get(name);
    if (!session) {
      session = new ChatSession(this, name);
      this.sessions.set(name, session);
    }
    return session;
  }

  attach(ws, name, origin) {
    this.get(name).attach(ws, origin);
  }

  oauthRedirectUri(origin) {
    const base = this.publicUrl || normalizeOrigin(origin) || (this.spaceHost ? `https://${this.spaceHost}` : '');
    return base ? `${base}/oauth/callback` : null;
  }

  addOAuthFlow(state, flow) {
    this.pruneOAuthFlows();
    while (this.oauthFlows.size >= MAX_OAUTH_FLOWS) this.oauthFlows.delete(this.oauthFlows.keys().next().value);
    this.oauthFlows.set(state, { ...flow, createdAt: Date.now() });
  }

  pruneOAuthFlows() {
    const cutoff = Date.now() - OAUTH_FLOW_TTL_MS;
    for (const [state, flow] of this.oauthFlows) {
      if (flow.createdAt < cutoff) this.oauthFlows.delete(state);
    }
  }

  // GET /oauth/callback. The request is not logged in (the auth cookie is
  // SameSite=Strict, so a redirect from another site does not carry it); the
  // one-time state of a sign-in started from the app is what authorizes it.
  // search: the raw query string ("?code=...&state=..."), passed on as is.
  async completeOAuth(query, search) {
    this.pruneOAuthFlows();
    const state = query && typeof query.state === 'string' ? query.state : '';
    const flow = state ? this.oauthFlows.get(state) : null;
    if (!flow || typeof search !== 'string' || search.length > MAX_CALLBACK_URL) {
      return {
        ok: false,
        unknown: true,
        error: 'Bu giriş bağlantısı tanınmadı ya da süresi doldu.',
      };
    }
    this.oauthFlows.delete(state);
    const result = await flow.session.finishOAuth(flow.server, `${flow.redirectUri}${search}`, flow.run);
    return { ...result, server: flow.server };
  }

  upload(name, req, fileName, declaredType) {
    return this.get(name).saveUpload(req, fileName, declaredType);
  }

  deleteUpload(name, id) {
    const session = this.sessions.get(name);
    return !!(session && session.deleteUpload(String(id)));
  }

  // Absolute path of a stored image, or null for anything that is not one.
  mediaPath(name, file) {
    if (!SESSION_NAME_RE.test(String(name)) || !MEDIA_FILE_RE.test(String(file))) return null;
    const abs = path.join(this.chatsRoot, name, 'media', file);
    return fs.existsSync(abs) ? abs : null;
  }

  // A file shared with share_file: its stored copy and metadata, or null.
  sharedFile(name, id) {
    if (!SESSION_NAME_RE.test(String(name)) || !FILE_ID_RE.test(String(id))) return null;
    const dir = path.join(this.chatsRoot, name, 'files', id);
    const meta = readJson(path.join(dir, 'meta.json'), null);
    const abs = path.join(dir, 'content');
    if (!meta || !fs.existsSync(abs)) return null;
    return { abs, name: safeFileName(meta.name), size: num(meta.size), text: meta.text === true };
  }

  allSessions() {
    return [...this.sessions.values()];
  }

  // Claude Code's CLI: the one bundled with the Agent SDK (the same version
  // the chat runs), else `claude` on PATH.
  claudeBin() {
    if (this.claudeBinPath === undefined) {
      this.claudeBinPath = null;
      for (const pkg of [`claude-agent-sdk-${process.platform}-${process.arch}`, `claude-agent-sdk-${process.platform}-${process.arch}-musl`]) {
        try {
          this.claudeBinPath = require.resolve(`@anthropic-ai/${pkg}/claude`);
          break;
        } catch {
          // bu platform paketi yok
        }
      }
      if (!this.claudeBinPath) {
        for (const dir of String((this.childEnv && this.childEnv.PATH) || process.env.PATH || '').split(':')) {
          const candidate = dir ? path.join(dir, 'claude') : '';
          if (!candidate) continue;
          try {
            fs.accessSync(candidate, fs.constants.X_OK);
            this.claudeBinPath = candidate;
            break;
          } catch {
            // bu dizinde yok
          }
        }
      }
    }
    return this.claudeBinPath;
  }

  // `claude mcp remove`: Claude Code edits its own configuration (it keeps
  // other Claude processes' writes to ~/.claude.json consistent).
  // One at a time: two removals tapped in a row edit the same file.
  removeMcpServer(name, scope, cwd) {
    const job = (this.mcpRemoveQueue || Promise.resolve()).then(() => this.runMcpRemove(name, scope, cwd));
    this.mcpRemoveQueue = job;
    return job;
  }

  runMcpRemove(name, scope, cwd) {
    const bin = this.claudeBin();
    if (!bin) return Promise.resolve({ ok: false, error: 'Claude Code komutu bulunamadı.' });
    const env = { ...this.childEnv, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
    return new Promise((resolve) => {
      execFile(
        bin,
        ['mcp', 'remove', '--scope', scope, '--', name],
        { cwd, env, timeout: MCP_REMOVE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          const output = `${stdout || ''}\n${stderr || ''}`.trim();
          if (err) {
            const reason = output || (err.killed ? 'Zaman aşımı.' : errMessage(err));
            resolve({ ok: false, notFound: /No MCP server (named|found)/i.test(output), error: truncate(reason, 1000) });
          } else {
            console.log(`[mcp] "${name}" kaldirildi (${scope})`);
            resolve({ ok: true, output: truncate(output, 1000) });
          }
        }
      );
    });
  }

  isRunning(name) {
    const session = this.sessions.get(name);
    return !!(session && session.running);
  }

  dispose(name) {
    const session = this.sessions.get(name);
    if (!session) return;
    session.shutdown();
    this.sessions.delete(name);
  }

  getModels() {
    return this.models ? mergeFallbackModels(this.models) : FALLBACK_MODELS;
  }

  setModels(list) {
    if (!Array.isArray(list) || !list.length) return;
    const models = list
      .filter((m) => m && typeof m.value === 'string' && (m.value === 'default' || MODEL_RE.test(m.value)))
      .map((m) => ({
        value: m.value === 'default' ? '' : m.value,
        displayName: String(m.displayName || m.value),
        description: String(m.description || ''),
        supportedEffortLevels: Array.isArray(m.supportedEffortLevels)
          ? m.supportedEffortLevels.filter((e) => EFFORT_LEVELS.includes(e))
          : m.supportsEffort
            ? EFFORT_LEVELS
            : [],
        supportsAdaptiveThinking: m.supportsAdaptiveThinking,
        supportsAutoMode: !!m.supportsAutoMode,
        group: 'main',
      }));
    if (!models.length) return;
    if (!models.some((m) => m.value === '')) {
      models.unshift({ ...FALLBACK_MODELS[0] });
    }
    if (this.models && JSON.stringify(this.models) === JSON.stringify(models)) return;
    this.models = models;
    writeJson(this.modelsFile, models);
    for (const session of this.sessions.values()) session.broadcastStatus();
  }

  supportsAdaptive(model) {
    if (/haiku/i.test(model || '')) return false;
    const info = this.getModels().find((m) => m.value === (model || ''));
    return !(info && info.supportsAdaptiveThinking === false);
  }

  setRateLimit(info) {
    this.rateLimit = info;
    for (const session of this.sessions.values()) session.broadcast({ type: 'rate', info });
  }

  // New sessions reuse the last model/effort, but always start in the default
  // permission mode: a bypass or auto-accept choice should never carry over silently.
  rememberDefaults(settings) {
    this.defaults = this.normalize({ model: settings.model, effort: settings.effort });
    writeJson(this.defaultsFile, this.defaults);
  }
}

module.exports = { ChatManager, EFFORT_LEVELS, PERMISSION_MODES };
