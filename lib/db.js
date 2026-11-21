// Datastore with two backends:
//  - Redis over REST (Upstash / Vercel KV) when KV_REST_API_URL + KV_REST_API_TOKEN
//    (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) are set → use this on Vercel.
//  - Local JSON file (data/db.json) otherwise → for VPS / local use.
const fs = require('fs');
const path = require('path');

const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEY = process.env.DB_KEY || 'eha:db';
const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const mode = REDIS_URL && REDIS_TOKEN ? 'redis' : SERVERLESS ? 'tmp' : 'file';

const DATA_DIR = process.env.DATA_DIR || (mode === 'tmp' ? '/tmp/eha-data' : path.join(__dirname, '..', 'data'));
const FILE = path.join(DATA_DIR, 'db.json');

const empty = () => ({
  users: [], sessions: {}, leads: [],
  settings: { zoho: { dc: 'com.au', clientId: '', clientSecret: '', refreshToken: '', autoSync: false, leadSource: 'Website', connectedAs: '' }, notifyEmail: '' },
  counters: { lead: 1000 }, zohoLog: [],
});

let state = null;
let dirty = false;

function normalise(obj) {
  const s = Object.assign(empty(), obj || {});
  s.settings = Object.assign(empty().settings, s.settings || {});
  s.settings.zoho = Object.assign(empty().settings.zoho, s.settings.zoho || {});
  return s;
}

async function redis(cmd, body) {
  const r = await fetch(`${REDIS_URL}/${cmd}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Redis error: ' + (j.error || r.status));
  return j.result;
}

// Load fresh state (called at the start of every request so serverless instances stay in sync)
async function refresh() {
  if (mode === 'redis') {
    const raw = await redis(`get/${encodeURIComponent(KEY)}`);
    state = normalise(raw ? JSON.parse(raw) : null);
  } else if (!state) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      try { state = normalise(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
      catch (e) { console.error('db.json corrupt, backing up', e); fs.renameSync(FILE, FILE + '.corrupt-' + Date.now()); state = empty(); }
    } else state = empty();
  }
  return state;
}

function save() { dirty = true; }

async function flush() {
  if (!dirty || !state) return;
  dirty = false;
  const json = JSON.stringify(state);
  if (mode === 'redis') await redis(`set/${encodeURIComponent(KEY)}`, json);
  else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, json, { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }
}

module.exports = { refresh, save, flush, get: () => state, mode, SERVERLESS };