const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const auth = require('./auth');
const { SessionManager, isValidName } = require('./sessions');
const { ChatManager } = require('./chat');

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
const childEnv = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-web/1.0' };
delete childEnv.APP_PASSWORD;
delete childEnv.SESSION_SECRET;

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
app.get('/vendor/lib/:file', (req, res) => {
  const rel = VENDOR_FILES[req.params.file];
  if (!rel) return res.sendStatus(404);
  res.sendFile(path.join(NODE_MODULES, rel));
});
app.use(express.static(path.join(__dirname, '..', 'public')));
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

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://placeholder').pathname;
  } catch {
    socket.destroy();
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
});
