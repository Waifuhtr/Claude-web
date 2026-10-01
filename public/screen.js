// "Ekran" tab: the container's virtual X display through noVNC. The VNC
// stream comes from /ws/display/vnc (same cookie auth as everything else).
// Phones get a type-and-send box and a special-key row instead of trying to
// stream the soft keyboard key by key, which IMEs and autocorrect break.
import RFB from '/vendor/novnc/core/rfb.js';
import KeyTable from '/vendor/novnc/core/input/keysym.js';
import keysyms from '/vendor/novnc/core/input/keysymdef.js';

const $ = (id) => document.getElementById(id);
const els = {
  view: $('screenView'),
  stage: $('screenStage'),
  canvas: $('screenCanvas'),
  overlay: $('screenOverlay'),
  spinner: $('screenSpinner'),
  msg: $('screenMsg'),
  retry: $('screenRetryBtn'),
  typeForm: $('screenTypeForm'),
  typeInput: $('screenTypeInput'),
  pasteBtn: $('screenPasteBtn'),
  keys: $('screenKeys'),
  dot: $('screenDot'),
  keyboardBtn: $('screenKeyboardBtn'),
  keysBtn: $('screenKeysBtn'),
  zoomBtn: $('screenZoomBtn'),
  menuBtn: $('screenMenuBtn'),
  toast: $('screenToast'),
  sheet: $('screenSheet'),
  backdrop: $('screenSheetBackdrop'),
};

const MODE_KEY = 'agentweb.screenMode';
const MAX_TYPE_CHARS = 2000;
const MODIFIERS = { ctrl: KeyTable.XK_Control_L, alt: KeyTable.XK_Alt_L, shift: KeyTable.XK_Shift_L };
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

let visible = false;
let rfb = null;
let status = null;
let retryTimer = null;
let retryDelay = 1000;
let toastTimer = null;
let remoteClipboard = '';
let sheetOpen = false;
let mode = readPref(MODE_KEY) === 'pan' ? 'pan' : 'fit';
const sticky = new Set();

function readPref(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // gizli sekme; tercih hatirlanmaz
  }
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(text, cls, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function api(url, options) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('unauthorized');
  }
  return res;
}

// ---- status line and overlay ----

function setDot(state) {
  els.dot.className = `screen-dot ${state}`;
  els.dot.title = { ok: 'Bağlı', busy: 'Bağlanıyor', off: 'Bağlı değil' }[state] || '';
}

function showOverlay(message, { busy = true, retry = false } = {}) {
  els.overlay.hidden = false;
  els.spinner.hidden = !busy;
  els.msg.textContent = message;
  els.retry.hidden = !retry;
}

function hideOverlay() {
  els.overlay.hidden = true;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3500);
}

async function loadStatus() {
  const res = await api('/api/display');
  status = await res.json();
  return status;
}

// ---- connection ----

async function start() {
  setDot('busy');
  showOverlay('Ekran hazırlanıyor…');
  try {
    await loadStatus();
  } catch {
    setDot('off');
    showOverlay('Sunucuya ulaşılamadı.', { busy: false, retry: true });
    return;
  }
  if (!visible) return;
  if (!status.available) {
    setDot('off');
    showOverlay(
      status.disabled
        ? "Sanal ekran kapalı. Açmak için Space ayarlarına AGENTWEB_DISPLAY=1 değişkenini ekle."
        : "Bu kurulumda sanal ekran yok (Xvfb bulunamadı). Space'i güncel Dockerfile ile yeniden derleyin (Settings → Factory rebuild).",
      { busy: false }
    );
    return;
  }
  if (!status.running) {
    try {
      const res = await api('/api/display/start', { method: 'POST' });
      status = await res.json();
    } catch {
      // asagida baglanti denemesi hatayi gosterir
    }
  }
  connect();
}

function connect() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!visible || rfb) return;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  setDot('busy');
  showOverlay('Ekrana bağlanılıyor…');
  let r;
  try {
    r = new RFB(els.canvas, `${proto}://${window.location.host}/ws/display/vnc`, { shared: true });
  } catch {
    scheduleRetry();
    return;
  }
  rfb = r;
  r.background = '#05070a';
  r.qualityLevel = 6;
  r.compressionLevel = 2;
  // Tapping the picture on a phone must not pull focus away from the text box.
  r.focusOnClick = !coarsePointer;
  r.showDotCursor = coarsePointer;
  applyMode();
  r.addEventListener('connect', () => {
    if (rfb !== r) return;
    retryDelay = 1000;
    setDot('ok');
    hideOverlay();
  });
  r.addEventListener('disconnect', () => {
    if (rfb !== r) return;
    rfb = null;
    setDot('off');
    if (visible) scheduleRetry();
  });
  r.addEventListener('securityfailure', () => {
    if (rfb !== r) return;
    showOverlay('VNC bağlantısı reddedildi.', { busy: false, retry: true });
  });
  r.addEventListener('clipboard', (e) => {
    remoteClipboard = String((e.detail && e.detail.text) || '');
    if (sheetOpen) renderSheet();
  });
}

function scheduleRetry() {
  showOverlay('Bağlantı koptu, yeniden bağlanılıyor…', { retry: true });
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    start();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 10000);
}

function disconnect() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (rfb) {
    const r = rfb;
    rfb = null;
    try {
      r.disconnect();
    } catch {
      // zaten kapali
    }
  }
}

function reconnect() {
  disconnect();
  retryDelay = 1000;
  start();
}

// "fit": the whole screen scaled into the tab; one finger drags in the remote
// app. "pan": real pixels, one finger moves the view, a tap still clicks.
function applyMode() {
  els.zoomBtn.textContent = mode === 'fit' ? '1:1' : 'Sığdır';
  els.zoomBtn.setAttribute('aria-label', mode === 'fit' ? 'Gerçek boyuta yakınlaştır' : 'Ekrana sığdır');
  els.view.classList.toggle('pan', mode === 'pan');
  if (!rfb) return;
  rfb.scaleViewport = mode === 'fit';
  rfb.clipViewport = mode === 'pan';
  rfb.dragViewport = mode === 'pan';
}

// ---- keyboard ----

function pressKeysym(keysym) {
  if (!rfb || !keysym) return false;
  const mods = [...sticky].map((m) => MODIFIERS[m]);
  for (const m of mods) rfb.sendKey(m, null, true);
  rfb.sendKey(keysym, null, true);
  rfb.sendKey(keysym, null, false);
  for (const m of mods.reverse()) rfb.sendKey(m, null, false);
  clearSticky();
  return true;
}

function typeText(textValue) {
  if (!rfb || !textValue) return false;
  const mods = [...sticky].map((m) => MODIFIERS[m]);
  for (const m of mods) rfb.sendKey(m, null, true);
  for (const ch of textValue.slice(0, MAX_TYPE_CHARS)) {
    const keysym = ch === '\n' ? KeyTable.XK_Return : ch === '\t' ? KeyTable.XK_Tab : keysyms.lookup(ch.codePointAt(0));
    rfb.sendKey(keysym, null, true);
    rfb.sendKey(keysym, null, false);
  }
  for (const m of mods.reverse()) rfb.sendKey(m, null, false);
  clearSticky();
  return true;
}

function clearSticky() {
  sticky.clear();
  for (const b of els.keys.querySelectorAll('button[data-mod]')) {
    b.classList.remove('on');
    b.setAttribute('aria-pressed', 'false');
  }
}

function toggleTypeForm(force) {
  const show = force === undefined ? els.typeForm.hidden : force;
  els.typeForm.hidden = !show;
  els.keyboardBtn.classList.toggle('on', show);
  els.keyboardBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
  if (show) els.typeInput.focus();
  else els.typeInput.blur();
}

function toggleKeys(force) {
  const show = force === undefined ? els.keys.hidden : force;
  els.keys.hidden = !show;
  els.keysBtn.classList.toggle('on', show);
  els.keysBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
  if (!show) clearSticky();
}

els.typeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = els.typeInput.value;
  if (!value) return;
  if (!rfb) {
    toast('Ekran bağlı değil.');
    return;
  }
  typeText(value);
  els.typeInput.value = '';
});

// Long or non-Latin text goes in one piece through the remote clipboard.
els.pasteBtn.addEventListener('click', () => {
  const value = els.typeInput.value;
  if (!value || !rfb) return;
  rfb.clipboardPasteFrom(value);
  setTimeout(() => {
    sticky.clear();
    sticky.add('ctrl');
    pressKeysym(keysyms.lookup('v'.codePointAt(0)));
  }, 150);
  els.typeInput.value = '';
});

els.keys.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mod) {
    const on = !sticky.has(b.dataset.mod);
    if (on) sticky.add(b.dataset.mod);
    else sticky.delete(b.dataset.mod);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    return;
  }
  const keysym = KeyTable[`XK_${b.dataset.key}`];
  if (!pressKeysym(keysym)) toast('Ekran bağlı değil.');
});

// Keep the soft keyboard up while special keys are tapped.
els.keys.addEventListener('mousedown', (e) => e.preventDefault());

els.keyboardBtn.addEventListener('click', () => toggleTypeForm());
els.keysBtn.addEventListener('click', () => toggleKeys());
els.zoomBtn.addEventListener('click', () => {
  mode = mode === 'fit' ? 'pan' : 'fit';
  writePref(MODE_KEY, mode);
  applyMode();
});
els.retry.addEventListener('click', reconnect);

// ---- menu ----

function option(title, desc, onClick, opts = {}) {
  const b = button('', `sheet-option${opts.danger ? ' danger' : ''}`, onClick);
  const t = el('span', 'opt-text');
  t.appendChild(el('span', 'opt-title', title));
  if (desc) t.appendChild(el('span', 'opt-desc', desc));
  b.append(t, el('span', 'opt-check', ''));
  if (opts.disabled) b.disabled = true;
  return b;
}

const APP_DESC = {
  browser: 'Sanal ekranda Google Chrome',
};

async function launch(app) {
  closeSheet();
  try {
    const res = await api('/api/display/launch', { method: 'POST', body: JSON.stringify({ app: app.id }) });
    const body = await res.json().catch(() => ({}));
    toast(res.ok ? `${app.title} başlatılıyor…` : body.error || 'Başlatılamadı.');
  } catch {
    toast('Başlatılamadı.');
  }
}

async function restartDisplay() {
  if (!window.confirm('Sanal ekran yeniden başlatılsın mı? Açık tüm pencereler kapanır.')) return;
  closeSheet();
  disconnect();
  setDot('busy');
  showOverlay('Ekran yeniden başlatılıyor…');
  try {
    const res = await api('/api/display/restart', { method: 'POST' });
    status = await res.json();
  } catch {
    // baglanti denemesi hatayi gosterir
  }
  retryDelay = 1000;
  if (visible) connect();
}

function renderSheet() {
  const header = el('div', 'sheet-header');
  const close = button('✕', 'icon-btn always', closeSheet);
  close.setAttribute('aria-label', 'Kapat');
  header.append(close, el('div', 'sheet-title', 'Sanal ekran'), el('span', 'sheet-spacer'));
  const body = el('div', 'sheet-body');
  const s = status || {};
  const state = rfb && els.overlay.hidden ? 'bağlı' : 'bağlı değil';
  body.appendChild(el('div', 'sheet-note', `${s.resolution || ''} · ${s.display || ''} · ${state}`));

  const apps = el('div', 'sheet-group');
  for (const app of Array.isArray(s.apps) ? s.apps : []) {
    const title = app.id === 'browser' ? 'Tarayıcıyı aç' : app.title;
    apps.appendChild(
      option(title, app.available ? APP_DESC[app.id] || '' : 'Bu kurulumda yok', () => launch(app), { disabled: !app.available })
    );
  }
  if (apps.childElementCount) {
    body.appendChild(el('div', 'sheet-label', 'Uygulamalar'));
    body.appendChild(apps);
  }

  if (remoteClipboard) {
    body.appendChild(el('div', 'sheet-label', 'Uzak pano'));
    const group = el('div', 'sheet-group');
    const row = el('div', 'clip-row');
    row.appendChild(el('pre', 'clip-text', remoteClipboard.slice(0, 2000)));
    const copy = button('Kopyala', 'btn ghost small', async () => {
      try {
        await navigator.clipboard.writeText(remoteClipboard);
        copy.textContent = 'Kopyalandı';
      } catch {
        copy.textContent = 'Kopyalanamadı';
      }
    });
    row.appendChild(copy);
    group.appendChild(row);
    body.appendChild(group);
  }

  const actions = el('div', 'sheet-group');
  actions.appendChild(option('Yeniden bağlan', 'Görüntüyü yeniden yükler', () => {
    closeSheet();
    reconnect();
  }));
  actions.appendChild(option('Ekranı yeniden başlat', 'Açık tüm pencereler kapanır', restartDisplay, { danger: true }));
  body.appendChild(actions);
  body.appendChild(
    el(
      'div',
      'sheet-note',
      coarsePointer
        ? 'Dokun: tıkla · İki parmakla dokun: sağ tık · İki parmakla sürükle: tekerlek · 1:1 modunda tek parmakla sürükleyerek görüntüyü kaydır.'
        : 'Klavye için görüntüye tıkla. 1:1 modunda sürükleyerek görüntüyü kaydırabilirsin.'
    )
  );
  if (s.error) body.appendChild(el('div', 'sheet-note error', s.error));
  els.sheet.replaceChildren(el('div', 'sheet-handle'), header, body);
}

async function openSheet() {
  if (document.activeElement === els.typeInput) els.typeInput.blur();
  try {
    await loadStatus();
  } catch {
    // eski durumla devam
  }
  sheetOpen = true;
  renderSheet();
  els.sheet.hidden = false;
  els.backdrop.hidden = false;
  requestAnimationFrame(() => {
    els.sheet.classList.add('open');
    els.backdrop.classList.add('open');
  });
}

function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  els.sheet.classList.remove('open');
  els.backdrop.classList.remove('open');
  setTimeout(() => {
    if (!sheetOpen) {
      els.sheet.hidden = true;
      els.backdrop.hidden = true;
    }
  }, 220);
}

els.menuBtn.addEventListener('click', openSheet);
els.backdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen) closeSheet();
});

// ---- visibility (driven by app.js) ----

function setVisible(on) {
  if (on === visible) return;
  visible = on;
  if (on) {
    applyMode();
    start();
  } else {
    disconnect();
    closeSheet();
    toggleTypeForm(false);
    toggleKeys(false);
  }
}

window.ScreenView = { setVisible, isConnected: () => !!rfb };
window.dispatchEvent(new Event('screenview-ready'));
