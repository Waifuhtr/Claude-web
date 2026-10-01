(function () {
  const $ = (id) => document.getElementById(id);
  const sessionListEl = $('sessionList');
  const newSessionForm = $('newSessionForm');
  const newSessionName = $('newSessionName');
  const activeSessionLabel = $('activeSessionLabel');
  const runDot = $('runDot');
  const emptyState = $('emptyState');
  const chatView = $('chatView');
  const terminalView = $('terminalView');
  const screenView = $('screenView');
  const terminalEl = $('terminal');
  const logoutBtn = $('logoutBtn');
  const sidebarEl = $('sidebar');
  const sidebarBackdrop = $('sidebarBackdrop');
  const menuBtn = $('menuBtn');
  const closeSidebarBtn = $('closeSidebarBtn');
  const keyToolbar = $('keyToolbar');
  const viewSwitch = $('viewSwitch');
  const newChatBtn = $('newChatBtn');

  const KEY_SEQUENCES = {
    esc: '\x1b',
    tab: '\t',
    ctrlc: '\x03',
    up: '\x1b[A',
    down: '\x1b[B',
    left: '\x1b[D',
    right: '\x1b[C',
    enter: '\r',
  };
  const VIEW_KEY = 'agentweb.view';
  const SESSION_KEY = 'agentweb.session';

  const VIEWS = ['chat', 'terminal', 'screen'];

  let activeName = null;
  let activeView = VIEWS.includes(readPref(VIEW_KEY)) ? readPref(VIEW_KEY) : 'chat';
  let sessions = [];
  // The Ekran tab lives in a module script (screen.js) that loads after this
  // file; it reads this when it is ready.
  let screenWanted = false;

  // Terminal state (only alive while the terminal tab is shown).
  let term = null;
  let fitAddon = null;
  let socket = null;
  let resizeObserver = null;

  function readPref(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writePref(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // gizli sekme vb.; tercih hatirlanmaz, sorun degil
    }
  }

  // Mobile browsers disagree about what 100vh/100dvh means while the on-screen
  // keyboard is open; the visual viewport is the only reliable measure.
  function syncAppHeight() {
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    if (vv && vv.offsetTop) window.scrollTo(0, 0);
  }

  syncAppHeight();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncAppHeight);
    window.visualViewport.addEventListener('scroll', syncAppHeight);
  }
  window.addEventListener('resize', syncAppHeight);
  window.addEventListener('orientationchange', () => setTimeout(syncAppHeight, 300));

  function redirectToLogin() {
    window.location.href = '/login.html';
  }

  async function api(url, options) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      redirectToLogin();
      throw new Error('unauthorized');
    }
    return res;
  }

  // ---- drawer ----

  function openSidebarDrawer() {
    sidebarEl.classList.add('open');
    sidebarBackdrop.classList.add('open');
    loadSessions().catch(() => {});
  }

  function closeSidebarDrawer() {
    sidebarEl.classList.remove('open');
    sidebarBackdrop.classList.remove('open');
  }

  menuBtn.addEventListener('click', openSidebarDrawer);
  closeSidebarBtn.addEventListener('click', closeSidebarDrawer);
  sidebarBackdrop.addEventListener('click', closeSidebarDrawer);

  // ---- sessions ----

  async function loadSessions() {
    const res = await api('/api/sessions');
    sessions = await res.json();
    renderSessionList();
    return sessions;
  }

  function renderSessionList() {
    sessionListEl.replaceChildren();
    if (!sessions.length) {
      const hint = document.createElement('div');
      hint.className = 'session-hint';
      hint.textContent = 'Henüz oturum yok. Aşağıya bir isim yazıp + ile oluşturun.';
      sessionListEl.appendChild(hint);
      return;
    }
    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = `session-item${s.name === activeName ? ' active' : ''}`;
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      const dot = document.createElement('span');
      dot.className = 'session-dot';
      dot.hidden = !s.running;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = s.name;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = 'sil';
      del.setAttribute('aria-label', `${s.name} oturumunu sil`);
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!window.confirm(`"${s.name}" oturumu kapatılsın mı? Sohbet süreci ve terminal sonlandırılır; klasördeki dosyalar silinmez.`)) return;
        await api(`/api/sessions/${encodeURIComponent(s.name)}`, { method: 'DELETE' });
        if (activeName === s.name) closeSession();
        loadSessions().catch(() => {});
      });
      item.append(dot, label, del);
      item.addEventListener('click', () => openSession(s.name));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openSession(s.name);
        }
      });
      sessionListEl.appendChild(item);
    }
  }

  function openSession(name) {
    closeSidebarDrawer();
    if (activeName === name) return;
    closeTerminal();
    window.ChatView.close();
    activeName = name;
    writePref(SESSION_KEY, name);
    activeSessionLabel.textContent = name;
    runDot.hidden = true;
    emptyState.hidden = true;
    viewSwitch.hidden = false;
    renderSessionList();
    // The chat socket stays open on both tabs so the running indicator and
    // history keep updating while the terminal is shown.
    window.ChatView.open(name);
    showView(activeView, true);
  }

  function closeSession() {
    closeTerminal();
    setScreen(false);
    window.ChatView.close();
    activeName = null;
    writePref(SESSION_KEY, null);
    activeSessionLabel.textContent = 'Bir oturum seçin';
    runDot.hidden = true;
    viewSwitch.hidden = true;
    newChatBtn.hidden = true;
    chatView.hidden = true;
    terminalView.hidden = true;
    screenView.hidden = true;
    emptyState.hidden = false;
    renderSessionList();
  }

  // ---- views ----

  function setScreen(on) {
    screenWanted = on;
    if (window.ScreenView) window.ScreenView.setVisible(on);
  }

  window.addEventListener('screenview-ready', () => {
    if (window.ScreenView) window.ScreenView.setVisible(screenWanted);
  });

  function showView(view, force) {
    if (!activeName) return;
    if (!VIEWS.includes(view)) view = 'chat';
    if (view === activeView && !force) return;
    activeView = view;
    writePref(VIEW_KEY, view);
    for (const b of viewSwitch.querySelectorAll('button[data-view]')) {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    chatView.hidden = view !== 'chat';
    terminalView.hidden = view !== 'terminal';
    screenView.hidden = view !== 'screen';
    newChatBtn.hidden = view !== 'chat';
    if (view === 'terminal') openTerminal(activeName);
    else closeTerminal();
    // The virtual screen is shared by all sessions; it only streams while shown.
    setScreen(view === 'screen');
    if (view === 'chat') window.ChatView.open(activeName);
  }

  viewSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) showView(b.dataset.view);
  });

  newChatBtn.addEventListener('click', () => {
    if (!activeName) return;
    if (window.ChatView.hasMessages() && !window.confirm('Yeni sohbet başlatılsın mı? Bu konuşma ekrandan kaldırılır.')) return;
    window.ChatView.newChat();
  });

  window.ChatView.onStatus((status) => {
    const running = !!(status && status.running);
    runDot.hidden = !running;
    const entry = sessions.find((s) => s.name === activeName);
    if (entry && entry.running !== running) {
      entry.running = running;
      renderSessionList();
    }
  });

  // ---- terminal ----

  function sendRaw(str) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(new TextEncoder().encode(str));
    }
    if (term) term.focus();
  }

  keyToolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (!b) return;
    const seq = KEY_SEQUENCES[b.dataset.key];
    if (seq) sendRaw(seq);
  });

  // Keep the soft keyboard up: toolbar taps must not steal focus from xterm.
  keyToolbar.addEventListener('mousedown', (e) => e.preventDefault());

  terminalEl.addEventListener('click', () => {
    if (term) term.focus();
  });

  function sendResize() {
    if (!term || !fitAddon || terminalView.hidden) return;
    try {
      fitAddon.fit();
    } catch {
      return;
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  function openTerminal(name) {
    closeTerminal();
    const small = window.matchMedia('(max-width: 600px)').matches;
    term = new Terminal({
      cursorBlink: true,
      fontSize: small ? 13 : 14,
      fontFamily: 'Menlo, Consolas, "Courier New", monospace',
      theme: { background: '#0d1117', foreground: '#c9d1d9' },
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalEl);
    sendResize();
    if (!window.matchMedia('(pointer: coarse)').matches) term.focus();

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${window.location.host}/ws/${encodeURIComponent(name)}`);
    sock.binaryType = 'arraybuffer';
    socket = sock;
    const current = term;

    sock.addEventListener('open', sendResize);
    sock.addEventListener('message', (event) => {
      if (socket !== sock) return;
      current.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data));
    });
    sock.addEventListener('close', () => {
      if (socket === sock) current.write('\r\n\r\n[bağlantı kapandı — yeniden bağlanmak için sekmeyi değiştirip geri gelin]\r\n');
    });

    current.onData((data) => {
      if (sock.readyState === WebSocket.OPEN) sock.send(new TextEncoder().encode(data));
    });

    resizeObserver = new ResizeObserver(() => sendResize());
    resizeObserver.observe(terminalEl);
  }

  function closeTerminal() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (socket) {
      const sock = socket;
      socket = null;
      sock.close();
    }
    if (term) {
      term.dispose();
      term = null;
    }
    fitAddon = null;
  }

  // ---- forms ----

  newSessionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newSessionName.value.trim();
    if (!name) return;
    const res = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      newSessionName.value = '';
      newSessionName.blur();
      await loadSessions();
      openSession(name);
    } else {
      const body = await res.json().catch(() => ({}));
      window.alert(body.error || 'Oturum oluşturulamadı');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    redirectToLogin();
  });

  // ---- startup: reopen the last session, or the only one ----

  loadSessions()
    .then((list) => {
      const saved = readPref(SESSION_KEY);
      const target = list.find((s) => s.name === saved) || (list.length === 1 ? list[0] : null);
      if (target) openSession(target.name);
      else if (!list.length && window.matchMedia('(max-width: 768px)').matches) openSidebarDrawer();
    })
    .catch(() => {});
})();
