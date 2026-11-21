// Zoho CRM integration (OAuth 2.0 refresh-token flow, CRM API v7).
// Docs: https://www.zoho.com/crm/developer/docs/api/v7/
const SCOPES = 'ZohoCRM.modules.leads.ALL,ZohoCRM.users.READ,ZohoCRM.settings.fields.READ';
const DCS = { com: 'United States', 'com.au': 'Australia', eu: 'Europe', in: 'India', 'com.cn': 'China', jp: 'Japan', ca: 'Canada', sa: 'Saudi Arabia' };

let tokenCache = { token: null, exp: 0, key: '' };

const accountsHost = (dc) => `https://accounts.zoho.${dc}`;
const apiHost = (dc) => `https://www.zohoapis.${dc}`;

function configured(cfg) { return !!(cfg.clientId && cfg.clientSecret && cfg.refreshToken); }

function authorizeUrl(cfg, redirectUri, state) {
  const p = new URLSearchParams({ scope: SCOPES, client_id: cfg.clientId, response_type: 'code', access_type: 'offline', prompt: 'consent', redirect_uri: redirectUri, state });
  return `${accountsHost(cfg.dc)}/oauth/v2/auth?${p}`;
}

async function exchangeCode(cfg, code, redirectUri, accountsServer) {
  // Zoho may return the user's real accounts server (multi-DC); only trust zoho domains.
  let host = accountsHost(cfg.dc);
  if (accountsServer && /^https:\/\/accounts\.zoho\.[a-z.]+$/.test(accountsServer)) host = accountsServer;
  const p = new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, code });
  const r = await net(fetch(`${host}/oauth/v2/token`, { method: 'POST', body: p }));
  const j = await r.json();
  if (!j.refresh_token) throw new Error(j.error || 'Zoho did not return a refresh token');
  const dc = host.replace('https://accounts.zoho.', '');
  return { refreshToken: j.refresh_token, dc };
}

async function accessToken(cfg) {
  const key = cfg.clientId + cfg.refreshToken + cfg.dc;
  if (tokenCache.token && tokenCache.key === key && Date.now() < tokenCache.exp) return tokenCache.token;
  const p = new URLSearchParams({ grant_type: 'refresh_token', client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken });
  const r = await net(fetch(`${accountsHost(cfg.dc)}/oauth/v2/token`, { method: 'POST', body: p }));
  const j = await r.json();
  if (!j.access_token) throw new Error('Zoho token error: ' + (j.error || r.status));
  tokenCache = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 120) * 1000, key };
  return j.access_token;
}

const net = (p) => p.catch((e) => { throw new Error('Could not reach Zoho (' + (e.cause && e.cause.code || e.message) + '). Check the server has internet access and the data centre is correct.'); });

async function api(cfg, method, pathname, body) {
  const t = await accessToken(cfg);
  const r = await net(fetch(apiHost(cfg.dc) + pathname, {
    method,
    headers: { Authorization: 'Zoho-oauthtoken ' + t, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const text = await r.text();
  let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!r.ok) throw new Error(`Zoho ${r.status}: ${j.message || j.code || text.slice(0, 200)}`);
  return j;
}

async function testConnection(cfg) {
  const j = await api(cfg, 'GET', '/crm/v7/users?type=CurrentUser');
  const u = (j.users || [])[0] || {};
  return { name: u.full_name, email: u.email, org: u.role && u.role.name };
}

const LABELS = {
  state: 'Preferred state', budget: 'Budget', deposit: 'Deposit saved', timeframe: 'Timeframe',
  employment: 'Employment', homeType: 'Home interest', message: 'Message',
};

function toZohoLead(lead, cfg) {
  const parts = (lead.name || '').trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop() : parts[0] || 'Unknown';
  const first = parts.join(' ');
  const lines = [`EHA ref: ${lead.ref}`, `Source form: ${lead.source}`];
  for (const k of Object.keys(LABELS)) if (lead[k]) lines.push(`${LABELS[k]}: ${lead[k]}`);
  lines.push(`Marketing opt-in: ${lead.marketing ? 'Yes' : 'No'}`);
  if (lead.utm && Object.keys(lead.utm).length) lines.push('UTM: ' + JSON.stringify(lead.utm));
  const rec = {
    Last_Name: last, First_Name: first || undefined, Email: lead.email || undefined,
    Mobile: lead.phone || undefined, Lead_Source: cfg.leadSource || 'Website', Company: 'Individual',
    State: lead.state || undefined, Country: 'Australia', Description: lines.join('\n'),
    Email_Opt_Out: !lead.marketing,
  };
  Object.keys(rec).forEach((k) => rec[k] === undefined && delete rec[k]);
  return rec;
}

// Upsert by email so re-syncs never create duplicates.
async function pushLead(cfg, lead) {
  const j = await api(cfg, 'POST', '/crm/v7/Leads/upsert', {
    data: [toZohoLead(lead, cfg)], duplicate_check_fields: ['Email'], trigger: ['workflow'],
  });
  const d = (j.data || [])[0] || {};
  if (d.status !== 'success') throw new Error(d.message || 'Zoho rejected the record');
  return { id: d.details && d.details.id, action: d.action };
}

module.exports = { DCS, SCOPES, configured, authorizeUrl, exchangeCode, testConnection, pushLead, toZohoLead, reset: () => { tokenCache = { token: null, exp: 0, key: '' }; } };
