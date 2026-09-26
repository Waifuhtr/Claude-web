(function () {
  const sessionListEl = document.getElementById('sessionList');
  const newSessionForm = document.getElementById('newSessionForm');
  const newSessionName = document.getElementById('newSessionName');
  const activeSessionLabel = document.getElementById('activeSessionLabel');
  const emptyState = document.getElementById('emptyState');
  const terminalEl = document.getElementById('terminal');
  const logoutBtn = document.getElementById('logoutBtn');

  let term = null;
  let fitAddon = null;
  let socket = null;
  let activeName = null;
  let resizeObserver = null;

  function redirectToLogin() {
    window.location.href = '/login.html';
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      redirectToLogin();
      throw new Error('unauthorized');
    }
    return res;
  }

  async function loadSessions() {
    const res = await api('/api/sessions');
    const sessions = await res.json();
    renderSessionList(sessions);
  }

  function renderSessionList(sessions) {
    sessionListEl.innerHTML = '';
    sessions.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.name === activeName ? ' active' : '');
      const label = document.createElement('span');
      label.textContent = s.name;
      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = 'sil';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`"${s.name}" oturumu tmux'tan sonlandirilsin mi?`)) return;
        await api(`/api/sessions/${encodeURIComponent(s.name)}`, { method: 'DELETE' });
        if (activeName === s.name) {
          closeTerminal();
        }
        loadSessions();
      });
      item.appendChild(label);
      item.appendChild(del);
      item.addEventListener('click', () => openSession(s.name));
      sessionListEl.appendChild(item);
    });
  }

  function closeTerminal() {
    if (socket) {
      socket.close();
      socket = null;
    }
    if (term) {
      term.dispose();
      term = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    activeName = null;
    terminalEl.style.display = 'none';
    emptyState.style.display = 'flex';
    activeSessionLabel.textContent = 'Bir oturum secin veya olusturun';
  }

  function openSession(name) {
    if (activeName === name) return;
    if (socket) {
      socket.close();
      socket = null;
    }
    if (term) {
      term.dispose();
      term = null;
    }

    activeName = name;
    activeSessionLabel.textContent = name;
    emptyState.style.display = 'none';
    terminalEl.style.display = 'block';

    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Consolas, "Courier New", monospace',
      theme: { background: '#0d1117', foreground: '#c9d1d9' },
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalEl);
    fitAddon.fit();
    term.focus();

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${window.location.host}/ws/${encodeURIComponent(name)}`);
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      sendResize();
      loadSessions();
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        term.write(new Uint8Array(event.data));
      }
    });

    socket.addEventListener('close', () => {
      if (term) {
        term.write('\r\n\r\n[baglanti kapandi]\r\n');
      }
    });

    term.onData((data) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(new TextEncoder().encode(data));
      }
    });

    function sendResize() {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      fitAddon.fit();
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }

    resizeObserver = new ResizeObserver(() => sendResize());
    resizeObserver.observe(terminalEl);
  }

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
      await loadSessions();
      openSession(name);
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Oturum olusturulamadi');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    redirectToLogin();
  });

  loadSessions().catch(() => {});
})();
