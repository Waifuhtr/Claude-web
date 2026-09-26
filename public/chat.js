(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    scroll: $('chatScroll'),
    list: $('chatList'),
    jump: $('jumpBtn'),
    composer: $('composer'),
    input: $('promptInput'),
    send: $('sendBtn'),
    modelPill: $('modelPill'),
    modePill: $('modePill'),
    rate: $('rateBanner'),
    live: $('liveNote'),
    sheet: $('settingsSheet'),
    sheetBackdrop: $('sheetBackdrop'),
  };

  const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const EFFORT_LABEL = { '': 'Varsayılan', low: 'Düşük', medium: 'Orta', high: 'Yüksek', xhigh: 'Çok yüksek', max: 'Maksimum' };
  const EFFORT_SHORT = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', xhigh: 'Çok yüksek', max: 'Maks' };
  const EFFORT_DESC = {
    '': 'Modelin kendi varsayılan seviyesi',
    low: 'En hızlı; basit işler için',
    medium: 'Hız ve derinlik dengesi',
    high: 'Derin düşünme',
    xhigh: 'Kodlama ve uzun işler için önerilen',
    max: 'Doğruluk maliyetten önemliyse',
  };
  const MODE_LABEL = {
    default: 'Her işlemde sor',
    acceptEdits: 'Düzenlemeleri otomatik kabul et',
    plan: 'Plan modu',
    auto: 'Otomatik (sınıflandırıcı)',
    bypassPermissions: 'Tüm izinleri atla',
  };
  const MODE_SHORT = { default: 'Sor', acceptEdits: 'Oto-düzenle', plan: 'Plan', auto: 'Otomatik', bypassPermissions: 'İzinsiz' };
  const MODE_DESC = {
    default: 'Dosya düzenleme ve komutlardan önce izin ister',
    acceptEdits: 'Dosya düzenlemelerini sormadan yapar, komutlar için sorar',
    plan: 'Hiçbir şeyi değiştirmez; önce plan hazırlayıp onayını ister',
    auto: 'Bir güvenlik sınıflandırıcısı izinleri senin yerine verir veya reddeder',
    bypassPermissions: 'Hiçbir şey sormadan her komutu çalıştırır. Sadece güvendiğin işler için.',
  };
  const TOOL_LABEL = {
    Bash: 'Komut',
    Read: 'Okuma',
    Write: 'Yazma',
    Edit: 'Düzenleme',
    MultiEdit: 'Düzenleme',
    NotebookEdit: 'Notebook',
    Glob: 'Dosya arama',
    Grep: 'İçerik arama',
    WebFetch: 'Web',
    WebSearch: 'Web arama',
    TodoWrite: 'Görevler',
    Task: 'Alt ajan',
    Agent: 'Alt ajan',
    Skill: 'Yetenek',
  };
  const MCP_STATUS = { connected: 'Bağlı', failed: 'Hata', 'needs-auth': 'Giriş gerekli', pending: 'Bağlanıyor', disabled: 'Kapalı' };
  const MCP_SCOPE = {
    user: 'tüm oturumlar',
    project: "bu klasörün .mcp.json'u",
    local: 'sadece bu klasör',
    claudeai: 'claude.ai bağlayıcısı',
    managed: 'yönetilen',
    enterprise: 'yönetilen',
    plugin: 'eklenti',
  };
  const INLINE_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
  const SUGGESTIONS = ['Bu klasörde ne var?', 'Bu projeyi bana özetle', 'Basit bir README yaz'];
  // Model output is untrusted (it can echo prompt-injected file contents):
  // no images (URL-based data exfiltration), no forms/inputs, no inline styles.
  const SANITIZE = {
    FORBID_TAGS: ['img', 'svg', 'math', 'style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'video', 'audio', 'source', 'picture'],
    FORBID_ATTR: ['style', 'srcset'],
  };

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  let ws = null;
  let sessionName = null;
  let status = null;
  let connected = false;
  let closedByUs = true;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let liveTimer = null;
  let stickToBottom = true;
  let sheetView = 'main';
  let confirmBypass = false;
  let mcpState = null;
  let eventCount = 0;
  let dismissedRate = readDismissed();
  let onStatusChange = () => {};
  const toolCards = new Map();
  const permCards = new Map();
  const drafts = new Map();
  let retiredDrafts = [];
  let lastTodo = null;

  if (window.marked) window.marked.use({ gfm: true, breaks: false });
  if (window.DOMPurify) {
    window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  function readDismissed() {
    try {
      return window.localStorage.getItem('agentweb.rateDismissed');
    } catch {
      return null;
    }
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function btn(text, cls, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function iconBtn(text, label, onClick) {
    const b = btn(text, 'icon-btn always', onClick);
    b.setAttribute('aria-label', label);
    return b;
  }

  // Drafts re-render on every streamed chunk; highlighting and copy buttons
  // wait for the final block.
  function renderMarkdown(node, text, draft) {
    node.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text || ''), SANITIZE);
    if (draft) return;
    node.querySelectorAll('pre > code').forEach((code) => {
      if (window.hljs) {
        try {
          window.hljs.highlightElement(code);
        } catch {
          // dil taninmadiysa duz metin kalsin
        }
      }
      addCopyButton(code.parentElement, () => code.textContent);
    });
  }

  function addCopyButton(container, getText) {
    if (!container || container.querySelector(':scope > .copy-btn')) return;
    const b = btn('Kopyala', 'copy-btn', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(getText());
        b.textContent = 'Kopyalandı';
      } catch {
        b.textContent = 'Kopyalanamadı';
      }
      setTimeout(() => {
        b.textContent = 'Kopyala';
      }, 1500);
    });
    container.appendChild(b);
  }

  function shortPath(p) {
    if (!p) return '';
    const parts = String(p).split('/');
    return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : String(p);
  }

  function toolLabel(name) {
    if (!name) return 'Araç';
    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      return `${parts[1]} · ${parts.slice(2).join('__')}`;
    }
    return TOOL_LABEL[name] || name;
  }

  function toolSummary(name, input) {
    const i = input || {};
    switch (name) {
      case 'Bash':
        return i.command || i.description || '';
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
        return shortPath(i.file_path);
      case 'NotebookEdit':
        return shortPath(i.notebook_path);
      case 'Glob':
        return i.pattern || '';
      case 'Grep':
        return `${i.pattern || ''}${i.path ? ` · ${shortPath(i.path)}` : ''}`;
      case 'WebFetch':
        return i.url || '';
      case 'WebSearch':
        return i.query || '';
      case 'TodoWrite': {
        const todos = Array.isArray(i.todos) ? i.todos : [];
        return `${todos.filter((t) => t.status === 'completed').length}/${todos.length} tamamlandı`;
      }
      case 'Task':
      case 'Agent':
        return i.description || i.subagent_type || '';
      default: {
        const first = Object.values(i).find((v) => typeof v === 'string');
        return first || '';
      }
    }
  }

  function renderDiff(oldStr, newStr) {
    const pre = el('pre', 'code diff');
    const add = (text, cls, sign) => {
      if (!text) return;
      for (const line of String(text).split('\n')) pre.appendChild(el('span', cls, `${sign} ${line}\n`));
    };
    add(oldStr, 'del', '-');
    add(newStr, 'add', '+');
    return pre;
  }

  function renderTodos(todos) {
    const list = el('ul', 'todos');
    for (const t of Array.isArray(todos) ? todos : []) {
      const item = el('li', `todo ${t.status || 'pending'}`);
      item.appendChild(el('span', 'todo-mark', t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'));
      item.appendChild(el('span', 'todo-text', t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content));
      list.appendChild(item);
    }
    return list;
  }

  function renderToolInput(name, input) {
    const i = input || {};
    const wrap = el('div', 'tool-input');
    if (name === 'Bash') {
      if (i.description) wrap.appendChild(el('div', 'tool-note', i.description));
      wrap.appendChild(el('pre', 'code', `$ ${i.command || ''}`));
    } else if (name === 'Edit') {
      wrap.appendChild(el('div', 'tool-note', i.file_path || ''));
      wrap.appendChild(renderDiff(i.old_string, i.new_string));
    } else if (name === 'MultiEdit') {
      wrap.appendChild(el('div', 'tool-note', i.file_path || ''));
      for (const edit of Array.isArray(i.edits) ? i.edits : []) wrap.appendChild(renderDiff(edit.old_string, edit.new_string));
    } else if (name === 'Write') {
      wrap.appendChild(el('div', 'tool-note', i.file_path || ''));
      wrap.appendChild(renderDiff('', i.content || ''));
    } else if (name === 'Read') {
      wrap.appendChild(el('div', 'tool-note', i.file_path || ''));
    } else if (name === 'TodoWrite') {
      wrap.appendChild(renderTodos(i.todos));
    } else if (name === 'WebFetch') {
      wrap.appendChild(el('pre', 'code', i.url || ''));
      if (i.prompt) wrap.appendChild(el('div', 'tool-note', i.prompt));
    } else if (name === 'WebSearch') {
      wrap.appendChild(el('pre', 'code', i.query || ''));
    } else if (name === 'Glob' || name === 'Grep') {
      wrap.appendChild(el('pre', 'code', i.pattern || ''));
      if (i.path) wrap.appendChild(el('div', 'tool-note', i.path));
    } else {
      wrap.appendChild(el('pre', 'code', JSON.stringify(i, null, 2)));
    }
    return wrap;
  }

  function formatDuration(ms) {
    const s = Math.round(ms / 100) / 10;
    if (s < 60) return `${s.toLocaleString('tr-TR')} sn`;
    return `${Math.floor(s / 60)} dk ${Math.round(s % 60)} sn`;
  }

  // ---- scrolling ----

  // Scroll height at the last moment the view was known to sit at the bottom.
  let anchorHeight = 0;

  function nearBottom(height) {
    const s = els.scroll;
    return height - s.scrollTop - s.clientHeight < 80;
  }

  function scrollToBottom() {
    els.scroll.scrollTop = els.scroll.scrollHeight;
    anchorHeight = els.scroll.scrollHeight;
    els.jump.hidden = true;
    stickToBottom = true;
  }

  function afterAppend() {
    // Compare against the old content height: a scroll the user just made
    // (whose scroll event has not fired yet) must win over auto-scrolling.
    if (stickToBottom && nearBottom(anchorHeight)) {
      scrollToBottom();
    } else {
      stickToBottom = false;
      els.jump.hidden = false;
    }
  }

  els.scroll.addEventListener('scroll', () => {
    stickToBottom = nearBottom(els.scroll.scrollHeight);
    if (stickToBottom) {
      anchorHeight = els.scroll.scrollHeight;
      els.jump.hidden = true;
    }
  });
  els.jump.addEventListener('click', scrollToBottom);
  new ResizeObserver(() => {
    if (stickToBottom) scrollToBottom();
  }).observe(els.scroll);

  // ---- rendering ----

  function append(node, parent) {
    const host = parent && toolCards.get(parent);
    if (host && host.children) host.children.appendChild(node);
    else els.list.appendChild(node);
  }

  function resetView() {
    els.list.replaceChildren();
    toolCards.clear();
    permCards.clear();
    drafts.clear();
    retiredDrafts = [];
    lastTodo = null;
    eventCount = 0;
    stickToBottom = true;
    anchorHeight = 0;
    els.jump.hidden = true;
  }

  function renderEmpty() {
    els.list.replaceChildren();
    const box = el('div', 'chat-empty');
    box.appendChild(el('div', 'chat-empty-title', 'Ne üzerinde çalışalım?'));
    if (status && status.cwd) box.appendChild(el('div', 'chat-empty-path', status.cwd));
    const chips = el('div', 'chat-chips');
    for (const text of SUGGESTIONS) {
      chips.appendChild(
        btn(text, 'chip', () => {
          els.input.value = text;
          autoGrow();
          updateComposer();
          els.input.focus();
        })
      );
    }
    box.appendChild(chips);
    els.list.appendChild(box);
  }

  function renderThinking(text, live) {
    const details = el('details', `thinking${live ? ' live' : ''}`);
    details.appendChild(el('summary', null, live ? 'Düşünüyor…' : 'Düşünce'));
    details.appendChild(el('div', 'thinking-body', text));
    return details;
  }

  // A finished draft is swapped in place for its final block (matched by the
  // draft key the server sends) so the text does not jump; drafts that end
  // without a final block (empty text) disappear shortly after.
  function placeAssistant(node, ev, kind, live) {
    if (ev.parent) {
      node.classList.add('sub');
      append(node, ev.parent);
      return;
    }
    const idx = live && ev.draftKey ? retiredDrafts.findIndex((d) => d.key === ev.draftKey && d.kind === kind) : -1;
    if (idx !== -1) {
      const draft = retiredDrafts.splice(idx, 1)[0];
      draft.el.replaceWith(node);
      return;
    }
    append(node);
  }

  function renderTool(ev) {
    if (INLINE_TOOLS.has(ev.name)) {
      toolCards.set(ev.id, { hidden: true, done: false, statusEl: el('span') });
      return;
    }
    const card = el('div', 'tool');
    if (ev.parent) card.classList.add('sub');
    const head = el('button', 'tool-head');
    head.type = 'button';
    const statusEl = el('span', 'tool-status running');
    head.append(statusEl, el('span', 'tool-name', toolLabel(ev.name)), el('span', 'tool-summary', toolSummary(ev.name, ev.input)));
    const body = el('div', 'tool-body');
    body.appendChild(renderToolInput(ev.name, ev.input));
    const resultEl = el('div', 'tool-result');
    resultEl.hidden = true;
    body.appendChild(resultEl);
    const open = ev.name === 'TodoWrite';
    body.hidden = !open;
    card.classList.toggle('open', open);
    // Only the newest task list stays expanded.
    if (open) {
      if (lastTodo) {
        lastTodo.body.hidden = true;
        lastTodo.card.classList.remove('open');
      }
      lastTodo = { card, body };
    }
    head.addEventListener('click', () => {
      body.hidden = !body.hidden;
      card.classList.toggle('open', !body.hidden);
    });
    card.append(head, body);
    const entry = { card, statusEl, resultEl, done: false, children: null };
    if (ev.name === 'Task' || ev.name === 'Agent') {
      entry.children = el('div', 'tool-children');
      card.appendChild(entry.children);
    }
    toolCards.set(ev.id, entry);
    append(card, ev.parent);
  }

  function renderToolResult(ev) {
    const entry = toolCards.get(ev.id);
    if (!entry) return;
    entry.done = true;
    entry.statusEl.className = `tool-status ${ev.isError ? 'error' : 'ok'}`;
    if (entry.hidden) return;
    if (ev.isError) entry.card.classList.add('failed');
    if (ev.content) {
      entry.resultEl.hidden = false;
      entry.resultEl.replaceChildren(el('pre', `code${ev.isError ? ' error' : ''}`, ev.content));
    }
  }

  function sendPerm(id, payload, actions) {
    if (send({ type: 'perm', id, ...payload }) && actions) {
      actions.querySelectorAll('button').forEach((b) => {
        b.disabled = true;
      });
    }
  }

  const PERM_TITLE = {
    Bash: 'Claude bir komut çalıştırmak istiyor',
    Edit: 'Claude bir dosyayı düzenlemek istiyor',
    MultiEdit: 'Claude bir dosyayı düzenlemek istiyor',
    Write: 'Claude bir dosya yazmak istiyor',
    NotebookEdit: "Claude bir notebook'u düzenlemek istiyor",
    Read: 'Claude bir dosyayı okumak istiyor',
    Glob: 'Claude dosya aramak istiyor',
    Grep: 'Claude dosyalarda arama yapmak istiyor',
    WebFetch: 'Claude bir web sayfasını açmak istiyor',
    WebSearch: "Claude web'de arama yapmak istiyor",
    Task: 'Claude bir alt ajan başlatmak istiyor',
    Agent: 'Claude bir alt ajan başlatmak istiyor',
    Skill: 'Claude bir yetenek kullanmak istiyor',
  };

  // Claude Code's own prompt titles are English; known tools get a Turkish one.
  function permTitle(ev) {
    const name = ev.toolName || '';
    if (name.startsWith('mcp__')) return `Claude bir MCP aracı kullanmak istiyor: ${toolLabel(name)}`;
    return PERM_TITLE[name] || ev.title || `Claude şunu kullanmak istiyor: ${toolLabel(name)}`;
  }

  function buildToolPerm(card, ev, entry) {
    card.appendChild(el('div', 'perm-title', permTitle(ev)));
    if (ev.description) card.appendChild(el('div', 'perm-desc', ev.description));
    if (ev.reason) card.appendChild(el('div', 'perm-reason', ev.reason));
    if (ev.blockedPath) card.appendChild(el('div', 'perm-reason', `Yol: ${ev.blockedPath}`));
    if (ev.mcpServer) card.appendChild(el('div', 'perm-reason', `MCP sunucusu: ${ev.mcpServer}`));
    card.appendChild(renderToolInput(ev.toolName, ev.input));
    const actions = el('div', 'perm-actions');
    actions.appendChild(btn('Reddet', 'btn ghost', () => sendPerm(ev.id, { decision: 'deny' }, actions)));
    if (ev.canAlways) {
      actions.appendChild(btn('Her zaman izin ver', 'btn secondary', () => sendPerm(ev.id, { decision: 'always' }, actions)));
    }
    const allow = btn('İzin ver', ev.defaultToNo ? 'btn secondary' : 'btn primary', () => {
      // defaultToNo: the SDK asks that a single stray tap must not approve.
      if (ev.defaultToNo && !allow.dataset.armed) {
        allow.dataset.armed = '1';
        allow.textContent = 'Onaylamak için tekrar dokun';
        setTimeout(() => {
          delete allow.dataset.armed;
          allow.textContent = 'İzin ver';
        }, 3000);
        return;
      }
      sendPerm(ev.id, { decision: 'allow' }, actions);
    });
    actions.appendChild(allow);
    if (ev.defaultToNo) card.classList.add('caution');
    entry.actions = actions;
    card.appendChild(actions);
  }

  function buildQuestion(card, ev, entry) {
    card.classList.add('question');
    const questions = Array.isArray(ev.input && ev.input.questions) ? ev.input.questions : [];
    const answers = {};
    const actions = el('div', 'perm-actions');
    const submit = btn('Gönder', 'btn primary', () => {
      const out = {};
      for (const q of questions) {
        const a = answers[q.question];
        const parts = [...a.labels];
        if (a.otherOn && a.other.trim()) parts.push(a.other.trim());
        out[q.question] = parts.join(', ');
      }
      sendPerm(ev.id, { decision: 'allow', answers: out }, actions);
    });
    const refresh = () => {
      submit.disabled = !questions.every((q) => {
        const a = answers[q.question];
        return a.labels.size > 0 || (a.otherOn && a.other.trim());
      });
    };
    for (const q of questions) {
      const state = { labels: new Set(), other: '', otherOn: false };
      answers[q.question] = state;
      const block = el('div', 'q-block');
      if (q.header) block.appendChild(el('span', 'q-chip', q.header));
      block.appendChild(el('div', 'q-text', q.question));
      const opts = el('div', 'q-options');
      const optionButtons = [];
      const otherBtn = el('button', 'q-option');
      otherBtn.type = 'button';
      otherBtn.appendChild(el('span', 'q-label', 'Diğer…'));
      const otherInput = el('input', 'q-other');
      otherInput.type = 'text';
      otherInput.placeholder = 'Kendi cevabını yaz';
      otherInput.hidden = true;
      for (const option of Array.isArray(q.options) ? q.options : []) {
        const b = el('button', 'q-option');
        b.type = 'button';
        b.appendChild(el('span', 'q-label', option.label));
        if (option.description) b.appendChild(el('span', 'q-desc', option.description));
        b.addEventListener('click', () => {
          if (q.multiSelect) {
            if (state.labels.has(option.label)) state.labels.delete(option.label);
            else state.labels.add(option.label);
            b.classList.toggle('selected', state.labels.has(option.label));
          } else {
            state.labels.clear();
            state.labels.add(option.label);
            state.otherOn = false;
            otherInput.hidden = true;
            otherBtn.classList.remove('selected');
            optionButtons.forEach((other) => other.classList.toggle('selected', other === b));
          }
          refresh();
        });
        optionButtons.push(b);
        opts.appendChild(b);
      }
      otherBtn.addEventListener('click', () => {
        state.otherOn = q.multiSelect ? !state.otherOn : true;
        if (!q.multiSelect) {
          state.labels.clear();
          optionButtons.forEach((b) => b.classList.remove('selected'));
        }
        otherBtn.classList.toggle('selected', state.otherOn);
        otherInput.hidden = !state.otherOn;
        if (state.otherOn) otherInput.focus();
        refresh();
      });
      otherInput.addEventListener('input', () => {
        state.other = otherInput.value;
        refresh();
      });
      opts.append(otherBtn, otherInput);
      block.appendChild(opts);
      card.appendChild(block);
    }
    actions.append(btn('Atla', 'btn ghost', () => sendPerm(ev.id, { decision: 'deny' }, actions)), submit);
    refresh();
    entry.actions = actions;
    card.appendChild(actions);
  }

  function buildPlan(card, ev, entry) {
    card.classList.add('plan');
    card.appendChild(el('div', 'perm-title', 'Claude bir plan hazırladı'));
    const plan = el('div', 'md plan-body');
    const text = ev.input && typeof ev.input.plan === 'string' ? ev.input.plan : 'Plan metni gönderilmedi.';
    renderMarkdown(plan, text);
    card.appendChild(plan);
    const actions = el('div', 'perm-actions');
    actions.append(
      btn('Planlamaya devam et', 'btn ghost', () => sendPerm(ev.id, { decision: 'deny' }, actions)),
      btn('Onayla, her adımda sor', 'btn secondary', () => sendPerm(ev.id, { decision: 'allow', planMode: 'default' }, actions)),
      btn('Onayla, düzenlemeleri kabul et', 'btn primary', () => sendPerm(ev.id, { decision: 'allow', planMode: 'acceptEdits' }, actions))
    );
    entry.actions = actions;
    card.appendChild(actions);
  }

  function renderPerm(ev) {
    const card = el('div', 'perm-card');
    const entry = { card, ev, actions: null };
    permCards.set(ev.id, entry);
    if (ev.kind === 'question') buildQuestion(card, ev, entry);
    else if (ev.kind === 'plan') buildPlan(card, ev, entry);
    else buildToolPerm(card, ev, entry);
    append(card);
  }

  function finishPerm(ev) {
    const entry = permCards.get(ev.id);
    if (!entry) return;
    const kind = entry.ev.kind;
    const labels = { allow: '✓ İzin verildi', always: '✓ Her zaman izin verildi', deny: '✕ Reddedildi', cancelled: '— İptal edildi' };
    let text = labels[ev.decision] || ev.decision;
    if (kind === 'question') text = ev.decision === 'allow' ? '✓ Cevaplandı' : ev.decision === 'deny' ? '✕ Atlandı' : labels.cancelled;
    if (kind === 'plan' && ev.decision === 'allow') {
      text = ev.planMode === 'acceptEdits' ? '✓ Plan onaylandı, düzenlemeler otomatik' : '✓ Plan onaylandı';
    }
    const state = el('div', `perm-state ${ev.decision}`, text);
    if (ev.answers) {
      for (const [q, a] of Object.entries(ev.answers)) state.appendChild(el('div', 'perm-answer', `${q} → ${a}`));
    }
    entry.card.classList.add('done');
    if (entry.actions) entry.actions.replaceWith(state);
    else entry.card.appendChild(state);
    entry.actions = null;
  }

  function renderResult(ev) {
    for (const entry of toolCards.values()) {
      if (!entry.done) {
        entry.done = true;
        entry.statusEl.className = 'tool-status stopped';
      }
    }
    let text;
    let cls;
    if (ev.stopped) {
      text = '■ Durduruldu';
      cls = 'stopped';
    } else if (ev.ok) {
      text = `✓ Tamamlandı${ev.durationMs ? ` · ${formatDuration(ev.durationMs)}` : ''}`;
      cls = 'ok';
    } else {
      text = `✕ ${ev.error || 'Hata'}${ev.apiErrorStatus ? ` (HTTP ${ev.apiErrorStatus})` : ''}`;
      cls = 'failed';
    }
    append(el('div', `turn-end ${cls}`, text));
  }

  function renderEvent(ev, live) {
    switch (ev.t) {
      case 'user': {
        const node = el('div', 'msg user');
        node.appendChild(el('div', 'bubble', ev.text));
        append(node);
        break;
      }
      case 'text': {
        const node = el('div', 'msg assistant md');
        renderMarkdown(node, ev.text);
        placeAssistant(node, ev, 'text', live);
        break;
      }
      case 'thinking':
        placeAssistant(renderThinking(ev.text, false), ev, 'thinking', live);
        break;
      case 'tool':
        renderTool(ev);
        break;
      case 'tool_result':
        renderToolResult(ev);
        break;
      case 'perm':
        renderPerm(ev);
        break;
      case 'perm_done':
        finishPerm(ev);
        break;
      case 'result':
        renderResult(ev);
        break;
      case 'error':
        append(el('div', 'msg error', ev.message));
        break;
      case 'notice':
        append(el('div', 'notice', ev.text));
        break;
      default:
        break;
    }
  }

  function handleDraft(msg) {
    let draft = drafts.get(msg.key);
    if (!draft) {
      const node = msg.kind === 'thinking' ? renderThinking('', true) : el('div', 'msg assistant md draft');
      draft = { kind: msg.kind, el: node };
      drafts.set(msg.key, draft);
      els.list.appendChild(node);
    }
    if (msg.kind === 'thinking') draft.el.querySelector('.thinking-body').textContent = msg.text;
    else renderMarkdown(draft.el, msg.text, true);
    afterAppend();
  }

  function handleDraftDone(key) {
    const draft = drafts.get(key);
    if (!draft) return;
    drafts.delete(key);
    draft.key = key;
    retiredDrafts.push(draft);
    setTimeout(() => {
      const idx = retiredDrafts.indexOf(draft);
      if (idx !== -1) {
        retiredDrafts.splice(idx, 1);
        draft.el.remove();
      }
    }, 400);
  }

  // ---- status, pills, banners ----

  function currentModel() {
    if (!status) return null;
    return (status.models || []).find((m) => m.value === status.settings.model) || null;
  }

  function effortLevelsFor(model) {
    if (!model) return ALL_EFFORTS;
    return Array.isArray(model.supportedEffortLevels) ? model.supportedEffortLevels : [];
  }

  function modelName(model, fallback) {
    if (!model) return fallback || 'Varsayılan';
    return model.value === '' ? 'Varsayılan' : model.displayName;
  }

  function shieldIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'pill-icon');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M8 1.5 2.75 3.5v4.1c0 3.1 2.2 5.8 5.25 6.9 3.05-1.1 5.25-3.8 5.25-6.9V3.5L8 1.5z');
    svg.appendChild(path);
    return svg;
  }

  function updatePills() {
    if (!status) return;
    const s = status.settings;
    let label = modelName(currentModel(), s.model);
    if (s.effort) label += ` · ${EFFORT_SHORT[s.effort]}`;
    els.modelPill.textContent = `${label} ▾`;
    els.modePill.replaceChildren(shieldIcon(), document.createTextNode(MODE_SHORT[s.permissionMode] || s.permissionMode));
    els.modePill.dataset.mode = s.permissionMode;
  }

  function updateComposer() {
    const hasText = els.input.value.trim().length > 0;
    const running = !!(status && status.running);
    const stopMode = running && !hasText;
    els.send.classList.toggle('stop', stopMode);
    els.send.textContent = stopMode ? '■' : '↑';
    els.send.setAttribute('aria-label', stopMode ? 'Durdur' : 'Gönder');
    els.send.disabled = !connected || (!hasText && !running);
  }

  function formatReset(ts) {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toLocaleString('tr-TR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
  }

  function updateRate(info) {
    if (!info || (info.status !== 'allowed_warning' && info.status !== 'rejected')) {
      els.rate.hidden = true;
      return;
    }
    const key = `${info.status}:${info.resetsAt || ''}`;
    if (key === dismissedRate) {
      els.rate.hidden = true;
      return;
    }
    const rejected = info.status === 'rejected';
    const head = rejected ? 'Kullanım limitine ulaşıldı' : 'Limite yaklaşıyorsun';
    const parts = [];
    if (typeof info.utilization === 'number' && !rejected) parts.push(`%${Math.round(info.utilization * 100)} kullanıldı`);
    if (info.resetsAt) parts.push(`${formatReset(info.resetsAt)} sıfırlanır`);
    const close = btn('✕', 'rate-close', () => {
      dismissedRate = key;
      els.rate.hidden = true;
      try {
        window.localStorage.setItem('agentweb.rateDismissed', key);
      } catch {
        // tercih hatirlanmaz, sorun degil
      }
    });
    close.setAttribute('aria-label', 'Uyarıyı kapat');
    els.rate.replaceChildren(el('strong', null, head), el('span', null, parts.join(' · ')), close);
    els.rate.classList.toggle('rejected', rejected);
    els.rate.hidden = false;
  }

  function showLive(text, ms) {
    els.live.textContent = text;
    els.live.hidden = false;
    clearTimeout(liveTimer);
    if (ms) liveTimer = setTimeout(hideLive, ms);
  }

  function hideLive() {
    els.live.hidden = true;
  }

  function applyStatus(next) {
    status = next;
    updatePills();
    updateComposer();
    updateRate(next.rateLimit);
    if (!els.sheet.hidden) renderSheet();
    onStatusChange(next);
  }

  // ---- settings sheet ----

  function sheetOption(title, desc, selected, onClick, extraCls) {
    const b = btn('', `sheet-option${selected ? ' selected' : ''}${extraCls ? ` ${extraCls}` : ''}`, onClick);
    const text = el('span', 'opt-text');
    text.appendChild(el('span', 'opt-title', title));
    if (desc) text.appendChild(el('span', 'opt-desc', desc));
    b.append(text, el('span', 'opt-check', selected ? '✓' : ''));
    return b;
  }

  function sheetRow(title, value, onClick) {
    const b = btn('', 'sheet-row', onClick || (() => {}));
    b.append(el('span', 'row-title', title), el('span', 'row-val', `${value}${onClick ? ' ›' : ''}`));
    if (!onClick) b.disabled = true;
    return b;
  }

  function updateSettings(patch) {
    status.settings = { ...status.settings, ...patch };
    send({ type: 'settings', settings: patch });
    updatePills();
    renderSheet();
  }

  function chooseModel(model) {
    const patch = { model: model.value };
    const s = status.settings;
    if (s.effort && !effortLevelsFor(model).includes(s.effort)) patch.effort = '';
    if (s.permissionMode === 'auto' && !model.supportsAutoMode) patch.permissionMode = 'default';
    updateSettings(patch);
    closeSheet();
  }

  function renderSheetMain(body, s) {
    const models = status.models || [];
    const group = (list) => {
      const g = el('div', 'sheet-group');
      for (const m of list) g.appendChild(sheetOption(modelName(m), m.description, m.value === s.model, () => chooseModel(m)));
      return g;
    };
    body.appendChild(group(models.filter((m) => m.group !== 'other')));
    const efforts = effortLevelsFor(currentModel());
    const rows = el('div', 'sheet-group');
    rows.appendChild(
      sheetRow('Effort', efforts.length ? EFFORT_LABEL[s.effort] : 'Bu modelde yok', efforts.length
        ? () => {
            sheetView = 'effort';
            renderSheet();
          }
        : null)
    );
    rows.appendChild(
      sheetRow('İzin modu', MODE_LABEL[s.permissionMode] || s.permissionMode, () => {
        sheetView = 'mode';
        renderSheet();
      })
    );
    rows.appendChild(sheetRow('MCP sunucuları', mcpSummary(), refreshMcp));
    body.appendChild(rows);
    const other = models.filter((m) => m.group === 'other');
    if (other.length) {
      body.appendChild(el('div', 'sheet-label', 'Diğer modeller'));
      body.appendChild(group(other));
    }
    body.appendChild(renderInfo());
  }

  function renderSheetEffort(body, s) {
    const g = el('div', 'sheet-group');
    for (const level of ['', ...effortLevelsFor(currentModel())]) {
      g.appendChild(
        sheetOption(EFFORT_LABEL[level], EFFORT_DESC[level], level === s.effort, () => {
          updateSettings({ effort: level });
          closeSheet();
        })
      );
    }
    body.appendChild(g);
  }

  function renderSheetMode(body, s) {
    const model = currentModel();
    const modes = ['default', 'acceptEdits', 'plan'];
    if (model && model.supportsAutoMode) modes.push('auto');
    if (status.canBypass) modes.push('bypassPermissions');
    const g = el('div', 'sheet-group');
    for (const mode of modes) {
      const danger = mode === 'bypassPermissions';
      const desc = danger && confirmBypass ? 'Emin misin? Onaylamak için tekrar dokun.' : MODE_DESC[mode];
      g.appendChild(
        sheetOption(MODE_LABEL[mode], desc, mode === s.permissionMode, () => {
          if (danger && mode !== s.permissionMode && !confirmBypass) {
            confirmBypass = true;
            renderSheet();
            return;
          }
          confirmBypass = false;
          updateSettings({ permissionMode: mode });
          closeSheet();
        }, danger ? 'danger' : '')
      );
    }
    body.appendChild(g);
  }

  function renderInfo() {
    const box = el('div', 'sheet-info');
    const rows = [];
    if (status.cwd) rows.push(['Klasör', status.cwd]);
    const init = status.init;
    if (init) {
      if (init.model) rows.push(['Aktif model', init.model]);
      const auth = init.auth === 'none' ? 'claude.ai girişi (abonelik)' : init.auth === 'ANTHROPIC_API_KEY' ? 'API key' : init.auth || '—';
      rows.push(['Kimlik', auth]);
      if (init.version) rows.push(['Claude Code', init.version]);
    } else {
      rows.push(['Durum', 'Oturum ilk mesajla başlar']);
    }
    for (const [key, value] of rows) {
      const row = el('div', 'info-row');
      row.append(el('span', 'info-key', key), el('span', 'info-val', value));
      box.appendChild(row);
    }
    return box;
  }

  function mcpSummary() {
    if (!status.init) return '—';
    const list = status.init.mcp || [];
    if (!list.length) return 'Yok';
    const ok = list.filter((m) => m.status === 'connected').length;
    const bad = list.filter((m) => m.status === 'failed').length;
    return `${ok}/${list.length} bağlı${bad ? ` · ${bad} hata` : ''}`;
  }

  function refreshMcp() {
    sheetView = 'mcp';
    mcpState = send({ type: 'mcp_status' }) ? null : { live: false, servers: [], error: 'Bağlantı yok, biraz sonra tekrar dene.' };
    renderSheet();
  }

  function mcpRow(server) {
    const row = el('div', 'mcp-row');
    const text = el('div', 'opt-text');
    text.appendChild(el('span', 'opt-title', server.name));
    const meta = [];
    if (MCP_SCOPE[server.scope]) meta.push(MCP_SCOPE[server.scope]);
    if (server.status === 'connected' && typeof server.tools === 'number') meta.push(`${server.tools} araç`);
    if (meta.length) text.appendChild(el('span', 'opt-desc', meta.join(' · ')));
    if (server.error) text.appendChild(el('span', 'mcp-error', server.error));
    if (server.status === 'needs-auth') {
      text.appendChild(el('span', 'opt-desc', 'Giriş için Terminal sekmesinde claude yazıp /mcp komutunu kullan.'));
    }
    const side = el('div', 'mcp-side');
    side.appendChild(el('span', `mcp-badge ${server.status}`, MCP_STATUS[server.status] || server.status || '?'));
    if (mcpState.live && server.status === 'failed') {
      side.appendChild(
        btn('Yeniden bağlan', 'mcp-retry', () => {
          mcpState = send({ type: 'mcp_reconnect', name: server.name }) ? null : { ...mcpState, error: 'Bağlantı yok, biraz sonra tekrar dene.' };
          renderSheet();
        })
      );
    }
    row.append(text, side);
    return row;
  }

  function renderSheetMcp(body) {
    if (!mcpState) {
      body.appendChild(el('div', 'sheet-note', 'Durum alınıyor…'));
      return;
    }
    if (mcpState.error) body.appendChild(el('div', 'sheet-note error', mcpState.error));
    if (!mcpState.live) {
      body.appendChild(
        el('div', 'sheet-note', mcpState.servers.length
          ? 'Claude şu an çalışmıyor; liste son başlatmadaki durum. Güncel durum bir sonraki mesajla gelir.'
          : 'Claude şu an çalışmıyor. MCP sunucuları bir sonraki mesajla başlar.')
      );
    }
    if (mcpState.servers.length) {
      const g = el('div', 'sheet-group');
      for (const server of mcpState.servers) g.appendChild(mcpRow(server));
      body.appendChild(g);
    } else if (mcpState.live) {
      body.appendChild(el('div', 'sheet-note', 'Tanımlı MCP sunucusu yok.'));
    }
    const running = !!status.running;
    const restart = sheetOption(
      "Claude'u yeniden başlat",
      running ? 'Yanıt sürerken kullanılamaz.' : 'Konuşma korunur; ~/.claude.json ve .mcp.json değişiklikleri bir sonraki mesajla yüklenir.',
      false,
      () => {
        if (status.running) return;
        send({ type: 'restart' });
        closeSheet();
      }
    );
    restart.disabled = running;
    const g = el('div', 'sheet-group');
    g.appendChild(restart);
    body.appendChild(g);
  }

  function renderSheet() {
    if (!status) return;
    const s = status.settings;
    const header = el('div', 'sheet-header');
    if (sheetView === 'main') header.appendChild(iconBtn('✕', 'Kapat', closeSheet));
    else {
      header.appendChild(
        iconBtn('‹', 'Geri', () => {
          sheetView = 'main';
          confirmBypass = false;
          renderSheet();
        })
      );
    }
    const titles = { effort: 'Effort', mode: 'İzin modu', mcp: 'MCP sunucuları' };
    header.appendChild(el('div', 'sheet-title', titles[sheetView] || 'Model seç'));
    if (sheetView === 'mcp') header.appendChild(iconBtn('↻', 'Yenile', refreshMcp));
    else header.appendChild(el('span', 'sheet-spacer'));
    const body = el('div', 'sheet-body');
    if (sheetView === 'effort') renderSheetEffort(body, s);
    else if (sheetView === 'mode') renderSheetMode(body, s);
    else if (sheetView === 'mcp') renderSheetMcp(body);
    else renderSheetMain(body, s);
    els.sheet.replaceChildren(el('div', 'sheet-handle'), header, body);
  }

  function openSheet(view) {
    if (!status) return;
    // Close the soft keyboard so the sheet sits at the real bottom of the screen.
    if (document.activeElement === els.input) els.input.blur();
    sheetView = view || 'main';
    confirmBypass = false;
    renderSheet();
    els.sheet.hidden = false;
    els.sheetBackdrop.hidden = false;
    requestAnimationFrame(() => {
      els.sheet.classList.add('open');
      els.sheetBackdrop.classList.add('open');
    });
  }

  function closeSheet() {
    if (els.sheet.hidden) return;
    els.sheet.classList.remove('open');
    els.sheetBackdrop.classList.remove('open');
    setTimeout(() => {
      if (!els.sheet.classList.contains('open')) {
        els.sheet.hidden = true;
        els.sheetBackdrop.hidden = true;
      }
    }, 220);
  }

  els.modelPill.addEventListener('click', () => openSheet('main'));
  els.modePill.addEventListener('click', () => openSheet('mode'));
  els.sheetBackdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  // ---- composer ----

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }

  function submit() {
    const text = els.input.value.trim();
    if (!text) {
      if (status && status.running) send({ type: 'stop' });
      return;
    }
    if (send({ type: 'send', text })) {
      els.input.value = '';
      autoGrow();
      updateComposer();
      scrollToBottom();
    }
  }

  els.input.addEventListener('input', () => {
    autoGrow();
    updateComposer();
  });
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !coarsePointer && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  // ---- connection ----

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    showLive('Bağlantı yok, biraz sonra tekrar dene.', 4000);
    return false;
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        resetView();
        applyStatus(msg.status);
        if (msg.history.length) {
          for (const ev of msg.history) renderEvent(ev, false);
          eventCount = msg.history.length;
        } else {
          renderEmpty();
        }
        scrollToBottom();
        break;
      case 'event':
        if (eventCount === 0) els.list.replaceChildren();
        eventCount += 1;
        renderEvent(msg.event, true);
        afterAppend();
        break;
      case 'draft':
        if (eventCount === 0) els.list.replaceChildren();
        handleDraft(msg);
        break;
      case 'draft_done':
        handleDraftDone(msg.key);
        break;
      case 'status':
        applyStatus(msg.status);
        break;
      case 'rate':
        if (status) status.rateLimit = msg.info;
        updateRate(msg.info);
        break;
      case 'mcp':
        mcpState = { live: !!msg.live, servers: Array.isArray(msg.servers) ? msg.servers : [], error: msg.error || '' };
        if (!els.sheet.hidden && sheetView === 'mcp') renderSheet();
        break;
      case 'live':
        showLive(msg.text, 6000);
        break;
      case 'reset':
        resetView();
        renderEmpty();
        break;
      default:
        break;
    }
  }

  async function scheduleReconnect() {
    try {
      const res = await fetch('/api/sessions');
      if (res.status === 401) {
        window.location.href = '/login.html';
        return;
      }
    } catch {
      // ag yoksa yine de tekrar dene
    }
    if (closedByUs) return;
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  }

  function connect() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${window.location.host}/ws/chat/${encodeURIComponent(sessionName)}`);
    ws = sock;
    sock.addEventListener('open', () => {
      if (ws !== sock) return;
      connected = true;
      reconnectDelay = 1000;
      hideLive();
      updateComposer();
    });
    sock.addEventListener('message', (e) => {
      if (ws !== sock) return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      handleMessage(msg);
    });
    sock.addEventListener('close', () => {
      if (ws !== sock) return;
      connected = false;
      updateComposer();
      if (closedByUs) return;
      showLive('Bağlantı koptu, yeniden bağlanılıyor…', 0);
      scheduleReconnect();
    });
  }

  function open(name) {
    // Switching back from the terminal tab: the socket never closed, keep it.
    if (name === sessionName && !closedByUs) return;
    close();
    sessionName = name;
    closedByUs = false;
    renderEmpty();
    connect();
  }

  function close() {
    closedByUs = true;
    clearTimeout(reconnectTimer);
    if (ws) {
      const sock = ws;
      ws = null;
      sock.close();
    }
    connected = false;
    status = null;
    sessionName = null;
    closeSheet();
    hideLive();
    els.rate.hidden = true;
    resetView();
    updateComposer();
  }

  window.ChatView = {
    open,
    close,
    newChat: () => send({ type: 'new_chat' }),
    hasMessages: () => eventCount > 0,
    onStatus: (fn) => {
      onStatusChange = fn;
    },
  };
})();
