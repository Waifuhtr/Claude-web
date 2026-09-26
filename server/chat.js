const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

const NO_XHIGH = ['low', 'medium', 'high', 'max'];

// Anthropic's current model ids. Replaced by the CLI's own supportedModels()
// list (which reflects what this account can actually use) once a session
// has started at least once.
const FALLBACK_MODELS = [
  { value: '', displayName: 'Varsayılan', description: "Claude Code'un bu hesap için seçtiği model", supportedEffortLevels: EFFORT_LEVELS, group: 'main' },
  { value: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Zorlu işler için en yetenekli', supportedEffortLevels: EFFORT_LEVELS, group: 'main' },
  { value: 'claude-sonnet-5', displayName: 'Sonnet 5', description: 'Günlük işler için en verimli', supportedEffortLevels: EFFORT_LEVELS, group: 'main' },
  { value: 'claude-fable-5-1', displayName: 'Fable 5.1', description: 'En zor problemler için (kullanım kredisi gerektirebilir)', supportedEffortLevels: EFFORT_LEVELS, group: 'main' },
  { value: 'claude-haiku-4-5', displayName: 'Haiku 4.5', description: 'Hızlı, kısa cevaplar için', supportedEffortLevels: [], supportsAdaptiveThinking: false, group: 'main' },
  { value: 'claude-opus-5', displayName: 'Opus 5', description: '', supportedEffortLevels: EFFORT_LEVELS, group: 'other' },
  { value: 'claude-fable-5', displayName: 'Fable 5', description: 'Kullanım kredisi gerektirebilir', supportedEffortLevels: EFFORT_LEVELS, group: 'other' },
  { value: 'claude-opus-4-8', displayName: 'Opus 4.8', description: '', supportedEffortLevels: EFFORT_LEVELS, group: 'other' },
  { value: 'claude-opus-4-7', displayName: 'Opus 4.7', description: '', supportedEffortLevels: EFFORT_LEVELS, group: 'other' },
  { value: 'claude-opus-4-6', displayName: 'Opus 4.6', description: '', supportedEffortLevels: NO_XHIGH, group: 'other' },
  { value: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: '', supportedEffortLevels: NO_XHIGH, group: 'other' },
];

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

function toolResultText(content) {
  if (typeof content === 'string') return truncate(content, MAX_TOOL_TEXT);
  if (!Array.isArray(content)) return '';
  const parts = content.map((block) => {
    if (!block) return '';
    if (block.type === 'text') return block.text || '';
    if (block.type === 'image') return '[görsel]';
    return '';
  });
  return truncate(parts.filter(Boolean).join('\n'), MAX_TOOL_TEXT);
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
    this.idleTimer = null;
    this.seq = 0;
    this.state = this.loadState();
    this.events = this.loadEvents();
  }

  loadState() {
    const saved = readJson(this.stateFile, null);
    if (!saved) return { sessionId: null, settings: { ...this.manager.defaults } };
    return {
      sessionId: typeof saved.sessionId === 'string' ? saved.sessionId : null,
      settings: this.manager.normalize(saved.settings),
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
    };
  }

  broadcastStatus() {
    this.broadcast({ type: 'status', status: this.status() });
  }

  attach(ws) {
    this.clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', history: this.events, status: this.status() }));
    for (const [key, draft] of this.drafts) {
      ws.send(JSON.stringify({ type: 'draft', key, kind: draft.kind, text: draft.text }));
    }
    ws.on('message', (raw) => this.handleClientMessage(raw));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  handleClientMessage(raw) {
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
        this.send(typeof msg.text === 'string' ? msg.text : '').catch(fail);
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
      default:
        break;
    }
  }

  async send(text) {
    const prompt = text.trim();
    if (!prompt) return;
    if (prompt.length > MAX_PROMPT_CHARS) {
      this.addEvent({ t: 'error', message: 'Mesaj çok uzun.' });
      return;
    }
    const uuid = crypto.randomUUID();
    this.addEvent({ t: 'user', text: prompt, uuid });
    const message = { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, uuid };
    this.unanswered.push(message);
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
      systemPrompt: { type: 'preset', preset: 'claude_code', snapshot: true },
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
    this.consume(run);
    if (!this.manager.models) {
      run.query.supportedModels().then((models) => this.manager.setModels(models)).catch(() => {});
    }
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
        this.handleSdkMessage(msg);
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
      this.broadcastStatus();
    }
  }

  handleSdkMessage(msg) {
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
        this.handleResult(msg);
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
        this.addEvent({
          t: 'tool_result',
          id: block.tool_use_id,
          content: toolResultText(block.content),
          isError: !!block.is_error,
          parent: msg.parent_tool_use_id || null,
        });
      }
    }
  }

  handleResult(msg) {
    this.clearDrafts(true);
    const ok = msg.subtype === 'success' && !msg.is_error;
    const event = {
      t: 'result',
      ok,
      subtype: msg.subtype,
      durationMs: msg.duration_ms,
      numTurns: msg.num_turns,
    };
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
      this.unanswered = [];
      this.seenToolIds.clear();
      this.scheduleIdle();
    }
    this.broadcastStatus();
  }

  requestPermission(toolName, toolInput, opts) {
    const options = opts || {};
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
      this.running = false;
      this.unanswered = [];
      this.addEvent({ t: 'result', ok: false, stopped: true, subtype: 'stopped' });
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

  newChat() {
    if (this.run) this.closeRun(this.run, true);
    this.cancelPendingPermissions();
    this.clearDrafts(false);
    this.clearIdle();
    this.running = false;
    this.stopRequested = false;
    this.unanswered = [];
    this.seenToolIds.clear();
    this.state.sessionId = null;
    this.saveState();
    this.events = [];
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
  constructor({ home, workspaceRoot, childEnv, ensureWorkspace }) {
    this.workspaceRoot = workspaceRoot;
    this.childEnv = childEnv;
    this.ensureWorkspace = ensureWorkspace;
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

  attach(ws, name) {
    this.get(name).attach(ws);
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
    return this.models || FALLBACK_MODELS;
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
    // The CLI only lists its picker entries; older model ids still work by name.
    const listed = new Set(models.map((m) => m.value));
    for (const m of FALLBACK_MODELS) {
      if (m.group === 'other' && !listed.has(m.value)) models.push({ ...m });
    }
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
