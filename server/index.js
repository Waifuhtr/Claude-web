const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const auth = require('./auth');
const { SessionManager, isValidName } = require('./sessions');
const { ChatManager } = require('./chat');
const { DisplayManager } = require('./display');

const PORT = parseInt(process.env.PORT || '7860', 10);
const HOME = process.env.HOME || '/home/node';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(HOME, 'workspace');
const META_FILE = path.join(HOME, '.cc-web-sessions.json');
const DEFAULT_SHELL_CMD = process.env.DEFAULT_SHELL_CMD || 'bash -l';
const NODE_MODULES = path.join(__dirname, '..', 'node_modules');

if (!auth.APP_PASSWORD) {
  console.error('[fatal] APP_PASSWORD ortam degiskeni (Secret) tanimli degil. Sunucu baslatilamiyor.');
  process.exit(1);
}

// Claude'un Bash araci ve terminal kabugu kendi ortamini okuyabilir; web
// arayuzunun parolasi ve cookie imza anahtari oraya sizmamali.
const baseEnv = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-web/1.0' };
delete baseEnv.APP_PASSWORD;
delete baseEnv.SESSION_SECRET;

// Sanal ekran (Ekran sekmesi): Claude'un ve terminalin actigi pencereler
// (Roblox Studio, tarayici...) DISPLAY uzerinden buraya cizilir.
const display = new DisplayManager({ env: baseEnv });
const childEnv = { ...baseEnv, ...display.childEnv() };

const sessionManager = new SessionManager({
  workspaceRoot: WORKSPACE_ROOT,
  metaFile: META_FILE,
  defaultShellCmd: DEFAULT_SHELL_CMD,
  env: childEnv,
});

const chatManager = new ChatManager({
  home: HOME,
  workspaceRoot: WORKSPACE_ROOT,
  childEnv,
  ensureWorkspace: (name) => sessionManager.ensureWorkspace(name),
  displayAvailable: display.available,
});

const VENDOR_FILES = {
  'marked.js': 'marked/lib/marked.umd.js',
  'purify.js': 'dompurify/dist/purify.js',
  'highlight.js': '@highlightjs/cdn-assets/highlight.min.js',
  'highlight.css': '@highlightjs/cdn-assets/styles/github-dark.min.css',
};

const app = express();
app.disable('x-powered-by');

app.use('/vendor/xterm', express.static(path.join(NODE_MODULES, '@xterm', 'xterm')));
app.use('/vendor/xterm-addon-fit', express.static(path.join(NODE_MODULES, '@xterm', 'addon-fit')));
// noVNC ships plain ES modules (core/rfb.js and what it imports).
app.use('/vendor/novnc/core', express.static(path.join(NODE_MODULES, '@novnc', 'novnc', 'core')));
app.use('/vendor/novnc/vendor', express.static(path.join(NODE_MODULES, '@novnc', 'novnc', 'vendor')));
app.get('/vendor/lib/:file', (req, res) => {
  const rel = VENDOR_FILES[req.params.file];
  if (!rel) return res.sendStatus(404);
  res.sendFile(path.join(NODE_MODULES, rel));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Chat attachments stream straight to disk, so this route sits before the JSON
// body parser (an uploaded .json file must not be parsed).
app.post('/api/upload/:name', auth.requireAuth, async (req, res) => {
  const { name } = req.params;
  if (!isValidName(name)) {
    return res.status(400).json({ error: 'gecersiz isim' });
  }
  let fileName = '';
  try {
    fileName = decodeURIComponent(req.get('X-File-Name') || '');
  } catch {
    fileName = '';
  }
  try {
    res.json(await chatManager.upload(name, req, fileName, req.get('X-File-Type') || ''));
  } catch (err) {
    if (!err.status) console.error('[upload]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Dosya kaydedilemedi.' });
  }
});

app.use(express.json());

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!auth.checkPassword(password)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  auth.setAuthCookie(res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  auth.clearAuthCookie(res);
  res.json({ ok: true });
});

app.use('/api', auth.requireAuth);

app.get('/api/sessions', (req, res) => {
  res.json(sessionManager.list().map((s) => ({ ...s, running: chatManager.isRunning(s.name) })));
});

app.post('/api/sessions', (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!isValidName(name)) {
    return res.status(400).json({ error: 'gecersiz isim (sadece harf, sayi, - ve _, en fazla 32 karakter)' });
  }
  sessionManager.ensureWorkspace(name);
  sessionManager.touch(name);
  res.json({ ok: true, name });
});

app.delete('/api/upload/:name/:id', (req, res) => {
  res.json({ ok: chatManager.deleteUpload(req.params.name, req.params.id) });
});

// Screenshots and attached images; only sniffed raster images are ever stored.
app.get('/api/media/:name/:file', (req, res) => {
  const file = chatManager.mediaPath(req.params.name, req.params.file);
  if (!file) return res.sendStatus(404);
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' });
  res.sendFile(file);
});

// Files Claude shared with share_file. Always a download (never rendered as
// a page); ?view=1 returns a text file as plain text for the in-chat preview.
app.get('/api/files/:name/:id', (req, res) => {
  const file = chatManager.sharedFile(req.params.name, req.params.id);
  if (!file) return res.sendStatus(404);
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-cache',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  if (req.query.view === '1') {
    if (!file.text) return res.sendStatus(415);
    res.type('text/plain; charset=utf-8');
    res.set('Content-Disposition', 'inline');
    return res.sendFile(file.abs);
  }
  res.attachment(file.name);
  res.type('application/octet-stream');
  res.sendFile(file.abs);
});

app.get('/api/display', (req, res) => {
  res.json(display.status());
});

app.post('/api/display/start', async (req, res) => {
  try {
    await display.ensure();
    res.json(display.status());
  } catch (err) {
    res.status(503).json({ ...display.status(), error: err.message });
  }
});

app.post('/api/display/restart', async (req, res) => {
  try {
    res.json(await display.restart());
  } catch (err) {
    res.status(503).json({ ...display.status(), error: err.message });
  }
});

app.post('/api/display/launch', async (req, res) => {
  try {
    res.json(await display.launch(String((req.body || {}).app || '')));
  } catch (err) {
    res.status(err.status || 503).json({ error: err.message });
  }
});

app.delete('/api/sessions/:name', (req, res) => {
  const { name } = req.params;
  if (!isValidName(name)) {
    return res.status(400).json({ error: 'gecersiz isim' });
  }
  sessionManager.killTmux(name);
  chatManager.dispose(name);
  sessionManager.remove(name);
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
// noVNC may ask for the "binary" subprotocol (websockify convention).
const vncWss = new WebSocketServer({
  noServer: true,
  maxPayload: 4 * 1024 * 1024,
  handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
});

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://placeholder').pathname;
  } catch {
    socket.destroy();
    return;
  }
  // Two path segments, so it can never collide with a session called "display".
  if (pathname === '/ws/display/vnc') {
    if (!auth.isAuthenticated(req) || !display.available) {
      socket.write(`HTTP/1.1 ${display.available ? '401 Unauthorized' : '503 Service Unavailable'}\r\n\r\n`);
      socket.destroy();
      return;
    }
    vncWss.handleUpgrade(req, socket, head, (ws) => display.attachVnc(ws));
    return;
  }
  const match = pathname.match(/^\/ws\/(chat\/)?([A-Za-z0-9_-]{1,32})$/);
  if (!match || !auth.isAuthenticated(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const isChat = !!match[1];
  const name = match[2];
  wss.handleUpgrade(req, socket, head, (ws) => {
    sessionManager.touch(name);
    if (isChat) chatManager.attach(ws, name);
    else attachTerminal(ws, name);
  });
});

function attachTerminal(ws, name) {
  const ptyProcess = sessionManager.spawnPty(name, 80, 24);

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      ptyProcess.write(Buffer.from(data).toString('utf8'));
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
        ptyProcess.resize(msg.cols, msg.rows);
      }
    } catch {
      // JSON degilse yok say
    }
  });

  ws.on('close', () => {
    try {
      ptyProcess.kill();
    } catch {
      // pty zaten kapanmis olabilir
    }
  });

  ws.on('error', () => {
    try {
      ptyProcess.kill();
    } catch {
      // yok say
    }
  });
}

server.listen(PORT, () => {
  console.log(`[server] Agent Web ${PORT} portunda dinliyor`);
  console.log(`[server] HOME=${HOME} WORKSPACE_ROOT=${WORKSPACE_ROOT}`);
  if (display.available) {
    // Started right away so GUI programs Claude opens always have a screen;
    // VNC itself only starts when someone opens the Ekran tab.
    display
      .ensure()
      .then(() => console.log(`[display] Sanal ekran hazir (DISPLAY=${display.display}, ${display.resolution})`))
      .catch((err) => console.error('[display]', err.message));
  } else {
    console.log('[display] Sanal ekran kapali ya da Xvfb kurulu degil; Ekran sekmesi kullanilamaz.');
  }
});
