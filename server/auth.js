const crypto = require('crypto');

const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'cc_session';

if (!process.env.SESSION_SECRET) {
  console.warn(
    '[auth] UYARI: SESSION_SECRET tanimli degil, gecici bir deger uretildi. ' +
      'Sunucu her yeniden basladiginda mevcut oturum cookie\'leri gecersiz olur. ' +
      'HF Secret olarak sabit bir SESSION_SECRET tanimlamaniz onerilir.'
  );
}

function sign(value) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}

function verifyCookieValue(signed) {
  if (!signed) return false;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return false;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  let sigBuf;
  let expBuf;
  try {
    sigBuf = Buffer.from(sig, 'hex');
    expBuf = Buffer.from(expected, 'hex');
  } catch {
    return false;
  }
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  return value === 'authenticated';
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function checkPassword(candidate) {
  if (!APP_PASSWORD) return false;
  const a = Buffer.from(String(candidate ?? ''));
  const b = Buffer.from(APP_PASSWORD);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(b.length), Buffer.alloc(b.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyCookieValue(cookies[COOKIE_NAME]);
}

function setAuthCookie(res) {
  const value = sign('authenticated');
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${value}; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`
  );
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=0`);
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

module.exports = {
  APP_PASSWORD,
  checkPassword,
  isAuthenticated,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  parseCookies,
  verifyCookieValue,
  COOKIE_NAME,
};
