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
    view: $('chatView'),
    attachBtn: $('attachBtn'),
    fileInput: $('fileInput'),
    attachList: $('attachList'),
    turnStatus: $('turnStatus'),
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
  const MAX_FILES = 10;
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
  // Large photos are shrunk before upload: Claude sees at most ~2000px anyway
  // and the API rejects images over 5 MB.
  const IMAGE_MAX_EDGE = 2000;
  const IMAGE_MAX_BYTES = 3.5 * 1024 * 1024;

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
  let attachments = [];
  let attachSeq = 0;
  let clockOffset = 0;
  let tickTimer = null;
  let eventCount = 0;
  let dismissedRate = readDismissed();
  let onStatusChange = () => {};
  const toolCards = new Map();
  const permCards = new Map();
  const drafts = new Map();
  let retiredDrafts = [];
  let lastTodo = null;

  // ---- image viewer ----

  const lightbox = el('div', 'lightbox');
  lightbox.hidden = true;
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-label', 'Görsel');
  const lbImg = el('img', 'lb-img');
  const lbBar = el('div', 'lb-bar');
  const lbOpen = el('a', 'lb-btn', 'Yeni sekmede aç');
  lbOpen.target = '_blank';
  lbOpen.rel = 'noopener';
  lbBar.append(lbOpen, iconBtn('✕', 'Kapat', closeLightbox));
  lightbox.append(lbImg, lbBar);
  document.body.appendChild(lightbox);
  // Tap the picture to see it at full size (then scroll around), tap again to fit.
  lbImg.addEventListener('click', () => lightbox.classList.toggle('zoomed'));
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  function openLightbox(src, alt) {
    lbImg.src = src;
    lbImg.alt = alt || '';
    lbOpen.href = src;
    lightbox.classList.remove('zoomed');
    lightbox.hidden = false;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lbImg.removeAttribute('src');
  }

  function mediaUrl(id) {
    return `/api/media/${encodeURIComponent(sessionName || '')}/${encodeURIComponent(id)}`;
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024).toLocaleString('tr-TR')} KB`;
    return `${(n / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
  }

  function thumbButton(src, alt, cls) {
    const b = el('button', cls);
    b.type = 'button';
    b.setAttribute('aria-label', `${alt} — büyüt`);
    const img = el('img');
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => {
      if (stickToBottom) scrollToBottom();
    });
    img.src = src;
    b.appendChild(img);
    b.addEventListener('click', () => openLightbox(img.src, alt));
    return { button: b, img };
  }

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
    if (Array.isArray(ev.images) && ev.images.length) renderToolImages(entry, ev.images);
  }

  // Screenshots stay visible under the tool's header even while it is collapsed.
  function renderToolImages(entry, images) {
    const box = el('div', 'tool-images');
    for (const image of images) {
      if (!image || !image.id) {
        box.appendChild(el('div', 'img-missing', 'Görsel çok büyük olduğu için gösterilemedi.'));
        continue;
      }
      const { button, img } = thumbButton(mediaUrl(image.id), 'Ekran görüntüsü', 'tool-img');
      img.addEventListener('error', () => button.replaceWith(el('div', 'img-missing', 'Görsel artık yok.')));
      box.appendChild(button);
    }
    entry.card.insertBefore(box, entry.card.querySelector('.tool-body'));
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
    updateTurnStatus();
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
    updateTurnStatus();
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
      text = '✓ Tamamlandı';
      cls = 'ok';
    } else {
      text = `✕ ${ev.error || 'Hata'}${ev.apiErrorStatus ? ` (HTTP ${ev.apiErrorStatus})` : ''}`;
      cls = 'failed';
    }
    const parts = [text];
    if (ev.durationMs && cls !== 'failed') parts.push(formatDuration(ev.durationMs));
    const tokens = tokenText(ev.usage);
    if (tokens) parts.push(tokens);
    if (!tokens) {
      append(el('div', `turn-end ${cls}`, parts.join(' · ')));
      return;
    }
    // Tap the line for the exact numbers.
    const box = el('details', `turn-end ${cls}`);
    box.appendChild(el('summary', null, parts.join(' · ')));
    const u = ev.usage;
    const exact = (n) => Math.round(n || 0).toLocaleString('tr-TR');
    const rows = [
      `Giriş: ${exact(u.input)} yeni · ${exact(u.cacheRead)} önbellekten · ${exact(u.cacheWrite)} önbelleğe yazılan`,
      `Çıkış: ${exact(u.output)} (düşünme dahil)`,
      `Toplam: ${exact(u.input + u.cacheRead + u.cacheWrite + u.output)} token`,
    ];
    if (Array.isArray(ev.models) && ev.models.length) rows.push(`Model: ${ev.models.join(', ')}`);
    if (ev.apiKey && ev.cost) rows.push(`Tahmini API maliyeti: $${ev.cost.toLocaleString('tr-TR', { maximumFractionDigits: 4 })}`);
    const detail = el('div', 'usage-detail');
    for (const row of rows) detail.appendChild(el('div', null, row));
    box.appendChild(detail);
    box.addEventListener('toggle', () => {
      if (box.open) detail.scrollIntoView({ block: 'nearest' });
    });
    append(box);
  }

  function fmtTokens(n) {
    const v = Math.max(0, Math.round(n || 0));
    if (v < 1000) return String(v);
    if (v < 1e6) return `${(v / 1000).toLocaleString('tr-TR', { maximumFractionDigits: v < 100000 ? 1 : 0 })}k`;
    return `${(v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}M`;
  }

  // "↑" everything Claude read (new + cached prompt), "↓" everything it wrote.
  function tokenText(u) {
    if (!u) return '';
    const input = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
    if (!input && !u.output) return '';
    return `↑ ${fmtTokens(input)} · ↓ ${fmtTokens(u.output)} token`;
  }

  function fileChip(file) {
    const chip = el('div', 'file-chip');
    chip.title = file.path || file.name;
    chip.append(el('span', 'file-name', file.name), el('span', 'file-meta', formatSize(file.size)));
    return chip;
  }

  function renderMsgFiles(files) {
    const box = el('div', 'msg-files');
    for (const file of files) {
      if (file.mediaId) {
        const { button, img } = thumbButton(mediaUrl(file.mediaId), file.name, 'msg-thumb');
        img.addEventListener('error', () => button.replaceWith(fileChip(file)));
        box.appendChild(button);
      } else {
        box.appendChild(fileChip(file));
      }
    }
    return box;
  }

  function renderEvent(ev, live) {
    switch (ev.t) {
      case 'user': {
        const node = el('div', 'msg user');
        if (Array.isArray(ev.attachments) && ev.attachments.length) node.appendChild(renderMsgFiles(ev.attachments));
        if (ev.text) node.appendChild(el('div', 'bubble', ev.text));
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
    const busy = attachments.some((a) => a.status === 'preparing' || a.status === 'uploading');
    const ready = attachments.some((a) => a.status === 'ready');
    const running = !!(status && status.running);
    const stopMode = running && !hasText && !ready && !busy;
    els.send.classList.toggle('stop', stopMode);
    els.send.textContent = stopMode ? '■' : '↑';
    els.send.setAttribute('aria-label', stopMode ? 'Durdur' : busy ? 'Dosyalar yükleniyor' : 'Gönder');
    els.send.disabled = !connected || busy || (!hasText && !ready && !running);
    els.attachBtn.disabled = !sessionName;
  }

  // ---- live "working" line: elapsed time and tokens of the running turn ----

  function formatElapsed(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return sec < 60 ? `${sec} sn` : `${Math.floor(sec / 60)} dk ${sec % 60} sn`;
  }

  function updateTurnStatus() {
    const running = !!(status && status.running);
    if (!running) {
      els.turnStatus.hidden = true;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      return;
    }
    if (!tickTimer) tickTimer = setInterval(updateTurnStatus, 1000);
    const waiting = [...permCards.values()].some((p) => p.actions);
    const turn = status.turn;
    const parts = [waiting ? 'Onay bekliyor' : 'Çalışıyor'];
    if (turn && turn.startedAt) parts.push(formatElapsed(Date.now() - clockOffset - turn.startedAt));
    const tokens = tokenText(turn);
    if (tokens) parts.push(tokens);
    els.turnStatus.replaceChildren(el('span', `ts-dot${waiting ? ' waiting' : ''}`), el('span', 'ts-text', parts.join(' · ')));
    els.turnStatus.hidden = false;
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
    if (typeof next.now === 'number') clockOffset = Date.now() - next.now;
    updatePills();
    updateComposer();
    updateTurnStatus();
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
    if (e.key !== 'Escape') return;
    if (!lightbox.hidden) closeLightbox();
    else closeSheet();
  });

  // ---- composer ----

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }

  function submit() {
    const text = els.input.value.trim();
    if (attachments.some((a) => a.status === 'preparing' || a.status === 'uploading')) return;
    const ready = attachments.filter((a) => a.status === 'ready');
    if (!text && !ready.length) {
      if (status && status.running) send({ type: 'stop' });
      return;
    }
    if (send({ type: 'send', text, attachments: ready.map((a) => a.info.id) })) {
      els.input.value = '';
      clearAttachments();
      autoGrow();
      updateComposer();
      scrollToBottom();
    }
  }

  // ---- attachments: pick / paste / drop, upload right away, send by id ----

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function prepareFile(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return file;
    }
    const edge = Math.max(bitmap.width, bitmap.height);
    if (edge <= IMAGE_MAX_EDGE && file.size <= IMAGE_MAX_BYTES) {
      if (bitmap.close) bitmap.close();
      return file;
    }
    const scale = Math.min(1, IMAGE_MAX_EDGE / edge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    let blob = null;
    let ext = '.jpg';
    if (file.type === 'image/png') {
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await canvasBlob(canvas, 'image/png');
      ext = '.png';
    }
    if (!blob || blob.size > IMAGE_MAX_BYTES) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await canvasBlob(canvas, 'image/jpeg', 0.88);
      ext = '.jpg';
    }
    if (bitmap.close) bitmap.close();
    if (!blob) return file;
    const base = (file.name || 'gorsel').replace(/\.[^.]+$/, '') || 'gorsel';
    return new File([blob], base + ext, { type: blob.type });
  }

  function uploadBlob(item, file, session) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      item.xhr = xhr;
      xhr.open('POST', `/api/upload/${encodeURIComponent(session)}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'dosya'));
      xhr.setRequestHeader('X-File-Type', file.type || '');
      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        item.progress = e.loaded / e.total;
        renderAttachList();
      });
      xhr.addEventListener('load', () => {
        item.xhr = null;
        if (xhr.status === 401) {
          window.location.href = '/login.html';
          return;
        }
        let body = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && body && body.id) resolve(body);
        else reject(new Error((body && body.error) || `Yüklenemedi (HTTP ${xhr.status})`));
      });
      xhr.addEventListener('error', () => {
        item.xhr = null;
        reject(new Error('Yükleme başarısız, bağlantını kontrol et.'));
      });
      xhr.addEventListener('abort', () => {
        item.xhr = null;
        reject(new Error('İptal edildi'));
      });
      xhr.send(file);
    });
  }

  async function startUpload(item) {
    const session = sessionName;
    const file = await prepareFile(item.file);
    if (!attachments.includes(item) || session !== sessionName) return;
    item.name = file.name || item.name;
    item.size = file.size;
    item.status = 'uploading';
    renderAttachList();
    try {
      const info = await uploadBlob(item, file, session);
      if (!attachments.includes(item) || session !== sessionName) {
        fetch(`/api/upload/${encodeURIComponent(session)}/${encodeURIComponent(info.id)}`, { method: 'DELETE' }).catch(() => {});
        return;
      }
      item.info = info;
      item.status = 'ready';
    } catch (err) {
      if (!attachments.includes(item)) return;
      item.status = 'error';
      item.error = err.message;
    }
    renderAttachList();
    updateComposer();
  }

  function addFiles(list) {
    if (!sessionName) return;
    for (const file of Array.from(list || [])) {
      if (attachments.length >= MAX_FILES) {
        showLive(`Bir mesaja en fazla ${MAX_FILES} dosya eklenebilir.`, 4000);
        break;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        showLive(`${file.name}: dosya çok büyük (en fazla 50 MB).`, 5000);
        continue;
      }
      const item = {
        key: ++attachSeq,
        file,
        name: file.name || 'dosya',
        size: file.size,
        isImage: /^image\//.test(file.type),
        status: 'preparing',
        progress: 0,
        info: null,
        error: '',
        previewUrl: null,
        xhr: null,
      };
      if (item.isImage) item.previewUrl = URL.createObjectURL(file);
      attachments.push(item);
      startUpload(item);
    }
    renderAttachList();
    updateComposer();
  }

  function removeAttachment(item) {
    attachments = attachments.filter((a) => a !== item);
    if (item.xhr) item.xhr.abort();
    if (item.info && sessionName) {
      fetch(`/api/upload/${encodeURIComponent(sessionName)}/${encodeURIComponent(item.info.id)}`, { method: 'DELETE' }).catch(() => {});
    }
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    renderAttachList();
    updateComposer();
  }

  // After sending the files belong to the message; only local previews go.
  function clearAttachments() {
    for (const item of attachments) {
      if (item.xhr) item.xhr.abort();
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    attachments = [];
    renderAttachList();
  }

  function renderAttachList() {
    els.attachList.hidden = attachments.length === 0;
    els.attachList.replaceChildren();
    for (const item of attachments) {
      const chip = el('div', `attach-chip ${item.status}${item.previewUrl ? ' image' : ''}`);
      chip.title = item.status === 'error' ? `${item.name}: ${item.error}` : item.name;
      if (item.previewUrl) {
        const img = el('img');
        img.src = item.previewUrl;
        img.alt = item.name;
        chip.appendChild(img);
      } else {
        const text = el('span', 'attach-text');
        text.append(el('span', 'attach-name', item.name), el('span', 'attach-meta', item.status === 'error' ? 'Hata' : formatSize(item.size)));
        chip.appendChild(text);
      }
      if (item.status === 'preparing' || item.status === 'uploading') {
        const bar = el('span', 'attach-progress');
        bar.style.width = `${Math.round((item.status === 'uploading' ? item.progress : 0) * 100)}%`;
        chip.appendChild(bar);
      }
      if (item.status === 'error' && item.previewUrl) chip.appendChild(el('span', 'attach-badge', '!'));
      const remove = btn('✕', 'attach-remove', () => removeAttachment(item));
      remove.setAttribute('aria-label', `${item.name} dosyasını kaldır`);
      chip.appendChild(remove);
      els.attachList.appendChild(chip);
    }
  }

  els.attachBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    addFiles(els.fileInput.files);
    els.fileInput.value = '';
  });
  els.input.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  els.view.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || !sessionName) return;
    e.preventDefault();
    els.view.classList.add('dragging');
  });
  els.view.addEventListener('dragleave', (e) => {
    if (!els.view.contains(e.relatedTarget)) els.view.classList.remove('dragging');
  });
  els.view.addEventListener('drop', (e) => {
    els.view.classList.remove('dragging');
    if (!hasFiles(e) || !sessionName) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });

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
      case 'usage':
        if (status && status.running) {
          status.turn = msg.turn;
          if (typeof msg.now === 'number') clockOffset = Date.now() - msg.now;
          updateTurnStatus();
        }
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
    clearAttachments();
    sessionName = null;
    closeSheet();
    closeLightbox();
    hideLive();
    els.rate.hidden = true;
    resetView();
    updateComposer();
    updateTurnStatus();
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
