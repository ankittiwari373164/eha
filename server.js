// EHA — website + admin panel + leads CRM + Zoho CRM sync
require('./lib/env').load();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./lib/db');
const zoho = require('./lib/zoho');

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : `http://localhost:${PORT}`)).replace(/\/$/, '');
const SECURE_COOKIE = BASE_URL.startsWith('https://');
const SESSION_HOURS = 12;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' || !!process.env.VERCEL);

// ---------- helpers ----------
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => {
  const [salt, h] = String(stored).split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const now = () => new Date().toISOString();
const clean = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const cleanMulti = (v, max = 2000) => (typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const STATUSES = ['new', 'contacted', 'qualified', 'appointment', 'won', 'lost'];

function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setCookie(res, name, val, maxAgeSec) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${SECURE_COOKIE ? '; Secure' : ''}`);
}

// simple in-memory rate limiter
const buckets = new Map();
function limit(key, max, windowMs) {
  const t = Date.now(); const b = buckets.get(key) || { n: 0, reset: t + windowMs };
  if (t > b.reset) { b.n = 0; b.reset = t + windowMs; }
  b.n++; buckets.set(key, b); return b.n <= max;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 60000).unref();

// first-run admin
function seedAdmin() {
  const s = db.get();
  if (!s.users.length) {
    const email = (process.env.ADMIN_EMAIL || 'admin@eha.com.au').toLowerCase();
    const pw = process.env.ADMIN_PASSWORD || 'ChangeMe!2026';
    s.users.push({ id: crypto.randomUUID(), email, name: 'Administrator', pw: hashPw(pw), createdAt: now(), mustChange: !process.env.ADMIN_PASSWORD });
    db.save();
    console.log(`\n  Admin created → ${email} / ${process.env.ADMIN_PASSWORD ? '(password from ADMIN_PASSWORD)' : pw}\n`);
  }
  // purge expired sessions
  for (const [k, v] of Object.entries(s.sessions)) if (v.exp < Date.now()) { delete s.sessions[k]; db.save(); }
}

// ---------- security headers ----------
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.zoho.com https://accounts.zoho.com.au https://accounts.zoho.eu https://accounts.zoho.in",
  });
  if (SECURE_COOKIE) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '50kb' }));

// Load data for every request and persist changes before the response is sent
const isStatic = (p) => /^\/(assets|admin\/assets)\//.test(p) || /\.(html|ico|png|webp|svg|css|js)$/.test(p) && !p.startsWith('/admin');
app.use(async (req, res, next) => {
  if (isStatic(req.path)) return next();
  try { await db.refresh(); seedAdmin(); } catch (e) { console.error(e); return res.status(503).json({ error: 'Database unavailable: ' + e.message }); }
  const end = res.end;
  res.end = function (...args) {
    db.flush().catch((e) => console.error('DB save failed', e)).finally(() => end.apply(res, args));
    return res;
  };
  next();
});

// ---------- auth ----------
function currentUser(req) {
  const tok = getCookie(req, 'eha_sid'); if (!tok) return null;
  const s = db.get().sessions[tok];
  if (!s || s.exp < Date.now()) return null;
  return db.get().users.find((u) => u.id === s.uid) || null;
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return req.path.startsWith('/api') || req.originalUrl.startsWith('/admin/api') ? res.status(401).json({ error: 'Not signed in' }) : res.redirect('/admin/login.html');
  // CSRF: mutating admin API calls must carry the custom header (cannot be sent cross-site without CORS)
  if (req.method !== 'GET' && req.get('X-EHA-Admin') !== '1') return res.status(403).json({ error: 'Bad request origin' });
  req.user = u; next();
}

app.post('/admin/api/login', (req, res) => {
  const ip = req.ip;
  if (!limit('login:' + ip, 8, 15 * 60000)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const email = clean(req.body.email).toLowerCase(), pw = String(req.body.password || '');
  const u = db.get().users.find((x) => x.email === email);
  if (!u || !checkPw(pw, u.pw)) return res.status(401).json({ error: 'Incorrect email or password' });
  const tok = crypto.randomBytes(32).toString('hex');
  db.get().sessions[tok] = { uid: u.id, exp: Date.now() + SESSION_HOURS * 3600e3 };
  u.lastLogin = now(); db.save();
  setCookie(res, 'eha_sid', tok, SESSION_HOURS * 3600);
  res.json({ ok: true, mustChange: !!u.mustChange });
});
app.post('/admin/api/logout', (req, res) => {
  const tok = getCookie(req, 'eha_sid'); if (tok) { delete db.get().sessions[tok]; db.save(); }
  setCookie(res, 'eha_sid', '', 0); res.json({ ok: true });
});

// ---------- public lead capture ----------
const OPTIONS = {
  state: ['Victoria', 'Western Australia', 'South Australia', 'New South Wales', 'Queensland', 'Tasmania', 'ACT', 'Northern Territory', 'Other / not sure'],
  budget: ['Under $450,000', '$450,000–$550,000', '$550,000–$650,000', '$650,000–$800,000', 'Above $800,000', 'Not sure yet'],
  deposit: ['Under $10,000', '$10,000–$25,000', '$25,000–$50,000', '$50,000–$100,000', 'Over $100,000', 'Still saving / unsure'],
  timeframe: ['As soon as possible', 'Within 3 months', 'Within 6 months', '6–12 months', 'Just exploring'],
  employment: ['', 'Prefer not to say', 'Employed full time', 'Employed part time', 'Self-employed', 'Other'],
  homeType: ['', 'Smarter economical home', 'House & land package', 'Low-deposit pathway', 'Not sure yet'],
};
const SOURCES = ['assessment', 'contact', 'callback', 'newsletter'];

app.post('/api/leads', async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true, ref: 'EHA-OK' }); // honeypot: pretend success
  if (!limit('lead:' + req.ip, 6, 10 * 60000)) return res.status(429).json({ error: 'Too many submissions. Please try again shortly.' });
  if (Number(b.t) && Date.now() - Number(b.t) < 2500) return res.status(400).json({ error: 'Please take a moment to complete the form.' });

  const source = SOURCES.includes(b.source) ? b.source : 'contact';
  const lead = {
    name: clean(b.name, 100), email: clean(b.email, 160).toLowerCase(), phone: clean(b.phone, 30),
    state: clean(b.state, 60), budget: clean(b.budget, 60), deposit: clean(b.deposit, 60), timeframe: clean(b.timeframe, 60),
    employment: clean(b.employment, 60), homeType: clean(b.homeType, 60), message: cleanMulti(b.message, 2000),
    consent: b.consent === true, marketing: b.marketing === true,
  };
  const errors = [];
  if (source !== 'newsletter' && lead.name.length < 2) errors.push('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) errors.push('Please enter a valid email address.');
  if (lead.phone && !/^[+()\d\s-]{8,20}$/.test(lead.phone)) errors.push('Please enter a valid phone number.');
  if (source === 'callback' && !lead.phone) errors.push('Please enter a phone number for your callback.');
  if (!lead.consent) errors.push('Please confirm consent so we can respond.');
  if (source === 'assessment') {
    for (const k of ['state', 'budget', 'deposit', 'timeframe']) if (!OPTIONS[k].includes(lead[k])) errors.push(`Please choose a valid ${k}.`);
    if (!lead.phone) errors.push('Please enter your mobile number.');
  }
  for (const k of ['employment', 'homeType']) if (lead[k] && !OPTIONS[k].includes(lead[k])) lead[k] = '';
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const s = db.get();
  if (source === 'newsletter') {
    const ex = s.leads.find((l) => l.email === lead.email);
    if (ex) { ex.marketing = true; ex.activity.unshift({ at: now(), text: 'Subscribed to newsletter' }); db.save(); return res.json({ ok: true, ref: ex.ref }); }
    lead.name = lead.name || lead.email.split('@')[0];
    lead.marketing = true;
  }
  const utm = {}; for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) if (b.utm && b.utm[k]) utm[k] = clean(b.utm[k], 100);
  const rec = Object.assign(lead, {
    id: crypto.randomUUID(), ref: 'EHA-' + ++s.counters.lead, source, status: 'new', score: scoreLead(lead, source),
    createdAt: now(), updatedAt: now(), utm, page: clean(b.page, 200), notes: [], activity: [{ at: now(), text: `Lead captured via ${source} form` }],
    zoho: { id: null, syncedAt: null, error: null },
  });
  s.leads.unshift(rec); db.save();
  if (s.settings.zoho.autoSync && zoho.configured(s.settings.zoho)) {
    await Promise.race([syncLead(rec).catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  }
  res.json({ ok: true, ref: rec.ref });
});

function scoreLead(l, source) {
  let sc = source === 'assessment' ? 30 : source === 'callback' ? 25 : 10;
  sc += { 'As soon as possible': 30, 'Within 3 months': 25, 'Within 6 months': 15, '6–12 months': 8 }[l.timeframe] || 0;
  sc += { 'Over $100,000': 25, '$50,000–$100,000': 20, '$25,000–$50,000': 14, '$10,000–$25,000': 8 }[l.deposit] || 0;
  if (l.phone) sc += 10; if (l.employment && /Employed|Self/.test(l.employment)) sc += 5;
  return Math.min(100, sc);
}

async function syncLead(lead) {
  const s = db.get(); const cfg = s.settings.zoho;
  try {
    const r = await zoho.pushLead(cfg, lead);
    lead.zoho = { id: r.id, syncedAt: now(), error: null };
    lead.activity.unshift({ at: now(), text: `Synced to Zoho CRM (${r.action || 'upsert'})` });
    s.zohoLog.unshift({ at: now(), ok: true, ref: lead.ref, msg: r.action || 'synced' });
  } catch (e) {
    lead.zoho = Object.assign({}, lead.zoho, { error: e.message });
    s.zohoLog.unshift({ at: now(), ok: false, ref: lead.ref, msg: e.message });
    throw e;
  } finally { s.zohoLog = s.zohoLog.slice(0, 100); db.save(); }
}

// ---------- admin API ----------
const A = express.Router();
A.use(requireAuth);
const safeUser = (u) => ({ id: u.id, email: u.email, name: u.name, mustChange: !!u.mustChange, lastLogin: u.lastLogin });

A.get('/me', (req, res) => res.json(safeUser(req.user)));

A.get('/stats', (req, res) => {
  const L = db.get().leads; const day = 86400e3; const t = Date.now();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])); const bySource = {}; const byState = {};
  const daily = Array.from({ length: 30 }, (_, i) => ({ date: new Date(t - (29 - i) * day).toISOString().slice(0, 10), n: 0 }));
  for (const l of L) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1; bySource[l.source] = (bySource[l.source] || 0) + 1;
    if (l.state) byState[l.state] = (byState[l.state] || 0) + 1;
    const d = daily.find((x) => x.date === l.createdAt.slice(0, 10)); if (d) d.n++;
  }
  const week = L.filter((l) => t - Date.parse(l.createdAt) < 7 * day).length;
  const prevWeek = L.filter((l) => { const a = t - Date.parse(l.createdAt); return a >= 7 * day && a < 14 * day; }).length;
  res.json({
    total: L.length, week, prevWeek, byStatus, bySource, byState, daily,
    conversion: L.length ? Math.round((byStatus.won / L.length) * 100) : 0,
    avgScore: L.length ? Math.round(L.reduce((a, l) => a + (l.score || 0), 0) / L.length) : 0,
    unsynced: L.filter((l) => !l.zoho || !l.zoho.id).length,
    recent: L.slice(0, 6).map((l) => ({ id: l.id, ref: l.ref, name: l.name, source: l.source, status: l.status, createdAt: l.createdAt, score: l.score })),
    zohoConnected: zoho.configured(db.get().settings.zoho), storage: db.mode,
  });
});

A.get('/leads', (req, res) => {
  let L = db.get().leads.slice();
  const { q, status, source, sort = 'newest', zoho: z } = req.query;
  if (q) { const s = String(q).toLowerCase(); L = L.filter((l) => [l.name, l.email, l.phone, l.ref, l.state, l.message].join(' ').toLowerCase().includes(s)); }
  if (status) L = L.filter((l) => l.status === status);
  if (source) L = L.filter((l) => l.source === source);
  if (z === 'synced') L = L.filter((l) => l.zoho && l.zoho.id); if (z === 'unsynced') L = L.filter((l) => !(l.zoho && l.zoho.id));
  if (sort === 'oldest') L.reverse(); if (sort === 'score') L.sort((a, b) => (b.score || 0) - (a.score || 0));
  if (sort === 'name') L.sort((a, b) => a.name.localeCompare(b.name));
  const page = Math.max(1, +req.query.page || 1), per = Math.min(100, +req.query.per || 20);
  res.json({ total: L.length, page, per, leads: L.slice((page - 1) * per, page * per) });
});

A.get('/leads.csv', (req, res) => {
  const cols = ['ref', 'createdAt', 'source', 'status', 'score', 'name', 'email', 'phone', 'state', 'budget', 'deposit', 'timeframe', 'employment', 'homeType', 'message', 'consent', 'marketing'];
  const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const rows = [cols.join(',')].concat(db.get().leads.map((l) => cols.map((c) => esc(l[c])).concat(esc(l.zoho && l.zoho.id)).join(',')));
  rows[0] += ',zohoId';
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="eha-leads-${now().slice(0, 10)}.csv"` });
  res.send('﻿' + rows.join('\r\n'));
});

const findLead = (id) => db.get().leads.find((l) => l.id === id);
A.get('/leads/:id', (req, res) => { const l = findLead(req.params.id); l ? res.json(l) : res.status(404).json({ error: 'Not found' }); });

A.patch('/leads/:id', (req, res) => {
  const l = findLead(req.params.id); if (!l) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  if (b.status && STATUSES.includes(b.status) && b.status !== l.status) { l.activity.unshift({ at: now(), text: `Status: ${l.status} → ${b.status} by ${req.user.name}` }); l.status = b.status; }
  for (const k of ['name', 'email', 'phone', 'state', 'budget', 'deposit', 'timeframe']) if (typeof b[k] === 'string') l[k] = clean(b[k], 160);
  if (b.followUp !== undefined) l.followUp = clean(b.followUp, 30);
  l.updatedAt = now(); db.save(); res.json(l);
});

A.post('/leads/:id/notes', (req, res) => {
  const l = findLead(req.params.id); if (!l) return res.status(404).json({ error: 'Not found' });
  const text = cleanMulti(req.body.text, 2000); if (!text) return res.status(400).json({ error: 'Note is empty' });
  l.notes.unshift({ id: crypto.randomUUID(), at: now(), by: req.user.name, text }); l.updatedAt = now(); db.save(); res.json(l);
});

A.delete('/leads/:id', (req, res) => {
  const s = db.get(); const i = s.leads.findIndex((l) => l.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  s.leads.splice(i, 1); db.save(); res.json({ ok: true });
});

A.post('/leads/:id/sync', async (req, res) => {
  const l = findLead(req.params.id); if (!l) return res.status(404).json({ error: 'Not found' });
  if (!zoho.configured(db.get().settings.zoho)) return res.status(400).json({ error: 'Connect Zoho CRM first (Zoho CRM tab).' });
  try { await syncLead(l); res.json(l); } catch (e) { res.status(502).json({ error: e.message, lead: l }); }
});

A.post('/leads/bulk', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : []; const action = req.body.action;
  const L = ids.map(findLead).filter(Boolean); const s = db.get();
  if (action === 'delete') { s.leads = s.leads.filter((l) => !ids.includes(l.id)); db.save(); return res.json({ ok: true, n: L.length }); }
  if (STATUSES.includes(action)) { L.forEach((l) => { if (l.status !== action) { l.activity.unshift({ at: now(), text: `Status: ${l.status} → ${action} (bulk)` }); l.status = action; } }); db.save(); return res.json({ ok: true, n: L.length }); }
  if (action === 'sync') {
    if (!zoho.configured(s.settings.zoho)) return res.status(400).json({ error: 'Connect Zoho CRM first.' });
    let ok = 0, fail = 0, lastErr = ''; for (const l of L) { try { await syncLead(l); ok++; } catch (e) { fail++; lastErr = e.message; } }
    return res.json({ ok: true, synced: ok, failed: fail, error: lastErr });
  }
  res.status(400).json({ error: 'Unknown action' });
});

// Zoho settings
const zohoPublic = (z) => ({ dc: z.dc, clientId: z.clientId, hasSecret: !!z.clientSecret, connected: zoho.configured(z), autoSync: z.autoSync, leadSource: z.leadSource, connectedAs: z.connectedAs, redirectUri: BASE_URL + '/admin/zoho/callback', dcs: zoho.DCS });
A.get('/zoho', (req, res) => res.json(Object.assign(zohoPublic(db.get().settings.zoho), { log: db.get().zohoLog.slice(0, 30) })));
A.put('/zoho', (req, res) => {
  const z = db.get().settings.zoho; const b = req.body;
  if (b.dc && zoho.DCS[b.dc]) { if (b.dc !== z.dc) z.refreshToken = ''; z.dc = b.dc; }
  if (typeof b.clientId === 'string' && b.clientId.trim() !== z.clientId) { z.clientId = clean(b.clientId, 120); z.refreshToken = ''; }
  if (typeof b.clientSecret === 'string' && b.clientSecret.trim()) z.clientSecret = clean(b.clientSecret, 200);
  if (typeof b.refreshToken === 'string' && b.refreshToken.trim()) z.refreshToken = clean(b.refreshToken, 300);
  if (typeof b.autoSync === 'boolean') z.autoSync = b.autoSync;
  if (typeof b.leadSource === 'string') z.leadSource = clean(b.leadSource, 60) || 'Website';
  zoho.reset(); db.save(); res.json(zohoPublic(z));
});
A.post('/zoho/test', async (req, res) => {
  const z = db.get().settings.zoho; if (!zoho.configured(z)) return res.status(400).json({ error: 'Zoho is not connected yet.' });
  try { const u = await zoho.testConnection(z); z.connectedAs = `${u.name} <${u.email}>`; db.save(); res.json({ ok: true, user: u }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
A.post('/zoho/disconnect', (req, res) => { const z = db.get().settings.zoho; z.refreshToken = ''; z.connectedAs = ''; zoho.reset(); db.save(); res.json(zohoPublic(z)); });
A.get('/zoho/authorize', (req, res) => {
  const z = db.get().settings.zoho; if (!z.clientId || !z.clientSecret) return res.status(400).send('Save your Zoho Client ID and Secret first.');
  const st = crypto.randomBytes(16).toString('hex'); setCookie(res, 'eha_zst', st, 600);
  res.redirect(zoho.authorizeUrl(z, BASE_URL + '/admin/zoho/callback', st));
});

// account
A.put('/account', (req, res) => {
  const u = req.user; const b = req.body;
  if (b.newPassword) {
    if (!checkPw(String(b.currentPassword || ''), u.pw)) return res.status(400).json({ error: 'Current password is incorrect' });
    if (String(b.newPassword).length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters' });
    u.pw = hashPw(String(b.newPassword)); u.mustChange = false;
    const s = db.get().sessions; const cur = getCookie(req, 'eha_sid'); for (const k of Object.keys(s)) if (s[k].uid === u.id && k !== cur) delete s[k];
  }
  if (b.name) u.name = clean(b.name, 80);
  if (b.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) u.email = clean(b.email, 160).toLowerCase();
  db.save(); res.json(safeUser(u));
});
A.get('/users', (req, res) => res.json(db.get().users.map(safeUser)));
A.post('/users', (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase(), name = clean(req.body.name, 80), pw = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (pw.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
  if (db.get().users.some((u) => u.email === email)) return res.status(400).json({ error: 'That email already has access' });
  db.get().users.push({ id: crypto.randomUUID(), email, name: name || email, pw: hashPw(pw), createdAt: now(), mustChange: true });
  db.save(); res.json(db.get().users.map(safeUser));
});
A.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove yourself" });
  const s = db.get(); s.users = s.users.filter((u) => u.id !== req.params.id);
  for (const k of Object.keys(s.sessions)) if (s.sessions[k].uid === req.params.id) delete s.sessions[k];
  db.save(); res.json(s.users.map(safeUser));
});

app.use('/admin/api', A);

// OAuth callback (session required, plus state check)
app.get('/admin/zoho/callback', requireAuth, async (req, res) => {
  const st = getCookie(req, 'eha_zst'); setCookie(res, 'eha_zst', '', 0);
  if (!st || st !== req.query.state) return res.redirect('/admin/#zoho?err=' + encodeURIComponent('OAuth state mismatch — please try again.'));
  if (req.query.error) return res.redirect('/admin/#zoho?err=' + encodeURIComponent(String(req.query.error)));
  const z = db.get().settings.zoho;
  try {
    const r = await zoho.exchangeCode(z, String(req.query.code || ''), BASE_URL + '/admin/zoho/callback', String(req.query['accounts-server'] || ''));
    z.refreshToken = r.refreshToken; z.dc = zoho.DCS[r.dc] ? r.dc : z.dc; zoho.reset();
    try { const u = await zoho.testConnection(z); z.connectedAs = `${u.name} <${u.email}>`; } catch {}
    db.save(); res.redirect('/admin/#zoho?ok=1');
  } catch (e) { res.redirect('/admin/#zoho?err=' + encodeURIComponent(e.message)); }
});

// ---------- static ----------
app.get('/admin/login.html', (req, res, next) => (currentUser(req) ? res.redirect('/admin/') : next()));
app.get('/admin/login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'login.html')));
app.use('/admin/assets', express.static(path.join(__dirname, 'admin', 'assets')));
app.get(['/admin', '/admin/', '/admin/index.html'], requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, file) => res.set('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600'),
}));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

module.exports = app;
if (require.main === module) app.listen(PORT, () => console.log(`EHA site running → ${BASE_URL}  (admin: ${BASE_URL}/admin) [storage: ${db.mode}]`));