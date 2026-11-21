// Tiny JSON-file datastore with atomic writes. No native modules needed.
// For high volume, swap for Postgres/SQLite — the API surface is small.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

const empty = () => ({
  users: [],
  sessions: {},
  leads: [],
  settings: {
    zoho: { dc: 'com.au', clientId: '', clientSecret: '', refreshToken: '', autoSync: false, leadSource: 'Website', connectedAs: '' },
    notifyEmail: '',
  },
  counters: { lead: 1000 },
  zohoLog: [],
});

let state;
function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    try { state = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
    catch (e) { console.error('db.json is corrupt, backing up and starting fresh', e); fs.renameSync(FILE, FILE + '.corrupt-' + Date.now()); state = empty(); }
  } else state = empty();
  state.settings.zoho = Object.assign(empty().settings.zoho, state.settings.zoho || {});
  return state;
}

let timer = null;
function save(immediate) {
  const write = () => {
    timer = null;
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };
  if (immediate) { if (timer) clearTimeout(timer); return write(); }
  if (!timer) timer = setTimeout(write, 150);
}

module.exports = { load, save, get: () => state, DATA_DIR };
