(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUSES = ['new', 'contacted', 'qualified', 'appointment', 'won', 'lost'];
  const COLORS = { new: '#2563eb', contacted: '#d97706', qualified: '#7c3aed', appointment: '#0891b2', won: '#16a34a', lost: '#9ca3af' };
  const ago = (d) => { const s = (Date.now() - Date.parse(d)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 604800) return Math.floor(s / 86400) + 'd ago'; return new Date(d).toLocaleDateString('en-AU'); };
  const fmtDate = (d) => new Date(d).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

  async function api(path, opts = {}) {
    const r = await fetch('/admin/api' + path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-EHA-Admin': '1', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (r.status === 401) { location.href = '/admin/login.html'; throw new Error('Signed out'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.data = j; throw e; }
    return j;
  }
  const toast = (msg, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4200); };
  const statusTag = (s) => `<span class="tag s-${esc(s)}">${esc(s)}</span>`;
  const scoreEl = (n) => `<span class="score"><i><span style="width:${+n || 0}%"></span></i>${+n || 0}</span>`;
  const zohoEl = (z) => z && z.id ? '<span class="z-ok" title="Synced">✓ Synced</span>' : z && z.error ? `<span class="z-err" title="${esc(z.error)}">⚠ Error</span>` : '<span class="z-no">—</span>';

  // ---------- routing ----------
  let me = null;
  const route = () => {
    const [v, qs] = (location.hash.slice(1) || 'dashboard').split('?');
    const view = ['dashboard', 'leads', 'zoho', 'settings'].includes(v) ? v : 'dashboard';
    $$('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + view));
    $$('.side nav a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === view));
    $('#side').classList.remove('open');
    ({ dashboard: loadDash, leads: loadLeads, zoho: loadZoho, settings: loadSettings })[view](new URLSearchParams(qs || ''));
  };
  addEventListener('hashchange', route);
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); location.href = '/admin/login.html'; };

  // ---------- dashboard ----------
  async function loadDash() {
    const s = await api('/stats');
    const h = new Date().getHours();
    $('#greet').textContent = `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${me ? me.name.split(' ')[0] : ''}`;
    countUp($('#k-total'), s.total); countUp($('#k-new'), s.byStatus.new); countUp($('#k-unsync'), s.unsynced); $('#k-conv').textContent = s.conversion + '%';
    const diff = s.week - s.prevWeek;
    $('#k-week').innerHTML = `<span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}</span> <span class="muted">${s.week} this week vs ${s.prevWeek} last</span>`;
    $('#k-zoho').innerHTML = s.zohoConnected ? '<span class="up">● Zoho connected</span>' : '<a href="#zoho" class="down">Connect Zoho →</a>';
    newBadge(s.byStatus.new);
    drawChart(s.daily);
    bars($('#pipe'), STATUSES.map((k) => [k, s.byStatus[k] || 0, COLORS[k]]));
    bars($('#sources'), Object.entries(s.bySource).map(([k, v]) => [k, v, '#0c3a22']));
    bars($('#states'), Object.entries(s.byState).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k.replace('Western Australia', 'WA').replace('New South Wales', 'NSW').replace('South Australia', 'SA'), v, '#e3b23c']));
    $('#recent').innerHTML = s.recent.length ? s.recent.map((l) => `<tr data-id="${esc(l.id)}"><td><span class="nm">${esc(l.name)}</span><span class="sub">${esc(l.ref)} · ${esc(l.source)}</span></td><td>${statusTag(l.status)}</td><td class="hide-m">${scoreEl(l.score)}</td><td class="sub">${ago(l.createdAt)}</td></tr>`).join('') : `<tr><td class="empty">No leads yet. Submit the form on the website to see one arrive here.</td></tr>`;
    $$('#recent tr[data-id]').forEach((tr) => (tr.onclick = () => openLead(tr.dataset.id)));
  }
  function countUp(el, n) { const t0 = performance.now(); const f = (t) => { const p = Math.min(1, (t - t0) / 900); el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
  function bars(el, rows) {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    el.innerHTML = rows.length ? rows.map(([k, v, c]) => `<div class="bar"><span style="text-transform:capitalize">${esc(k)}</span><span class="t"><i style="background:${c}" data-w="${(v / max) * 100}"></i></span><b>${v}</b></div>`).join('') : '<p class="muted">No data yet.</p>';
    requestAnimationFrame(() => requestAnimationFrame(() => $$('i[data-w]', el).forEach((i) => (i.style.width = i.dataset.w + '%'))));
  }
  function drawChart(d) {
    const W = 600, H = 200, P = 24, max = Math.max(4, ...d.map((x) => x.n));
    const x = (i) => P + (i * (W - P * 2)) / (d.length - 1), y = (v) => H - P - (v / max) * (H - P * 2);
    const pts = d.map((p, i) => [x(i), y(p.n)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const grid = [0, 0.5, 1].map((f) => `<line class="gl" x1="${P}" x2="${W - P}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="0" y="${y(max * f) + 3}">${Math.round(max * f)}</text>`).join('');
    const labels = [0, 10, 20, 29].map((i) => `<text x="${x(i)}" y="${H}" text-anchor="middle">${d[i].date.slice(5)}</text>`).join('');
    $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="gr" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e3b23c" stop-opacity=".45"/><stop offset="1" stop-color="#e3b23c" stop-opacity="0"/></linearGradient></defs>${grid}<path class="ar" d="${line} L${x(d.length - 1)} ${H - P} L${P} ${H - P}Z"/><path class="ln" d="${line}"/>${pts.filter((_, i) => d[i].n).map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5"><title>${d[i].n}</title></circle>`).join('')}${labels}</svg>`;
  }
  const newBadge = (n) => { const b = $('#newCount'); b.hidden = !n; b.textContent = n; };

  // ---------- leads ----------
  const LS = { page: 1, sel: new Set(), data: null };
  let tmr;
  ['#q', '#fStatus', '#fSource', '#fZoho', '#fSort'].forEach((s) => $(s).addEventListener(s === '#q' ? 'input' : 'change', () => { clearTimeout(tmr); tmr = setTimeout(() => { LS.page = 1; loadLeads(); }, 250); }));
  $('#pgPrev').onclick = () => { if (LS.page > 1) { LS.page--; loadLeads(); } };
  $('#pgNext').onclick = () => { if (LS.data && LS.page * LS.data.per < LS.data.total) { LS.page++; loadLeads(); } };
  async function loadLeads(qs) {
    if (qs && qs.get && qs.get('status')) $('#fStatus').value = qs.get('status');
    const p = new URLSearchParams({ q: $('#q').value, status: $('#fStatus').value, source: $('#fSource').value, zoho: $('#fZoho').value, sort: $('#fSort').value, page: LS.page, per: 20 });
    const tb = $('#leadRows');
    if (!LS.data) tb.innerHTML = Array(5).fill('<tr><td colspan="8"><div class="skeleton"></div></td></tr>').join('');
    const d = await api('/leads?' + p); LS.data = d;
    $('#leadsSub').textContent = `${d.total} lead${d.total === 1 ? '' : 's'} match your filters.`;
    tb.innerHTML = d.leads.length ? d.leads.map((l) => `<tr data-id="${esc(l.id)}" class="${LS.sel.has(l.id) ? 'sel' : ''}">
      <td><input type="checkbox" class="rowSel" ${LS.sel.has(l.id) ? 'checked' : ''} aria-label="Select"></td>
      <td><span class="nm">${esc(l.name)}</span><span class="sub">${esc(l.ref)}${l.state ? ' · ' + esc(l.state) : ''}</span></td>
      <td class="hide-m"><span class="sub">${esc(l.email)}<br>${esc(l.phone || '')}</span></td>
      <td>${statusTag(l.status)}</td><td class="hide-m"><span class="tag src">${esc(l.source)}</span></td>
      <td class="hide-m">${scoreEl(l.score)}</td><td class="hide-m">${zohoEl(l.zoho)}</td><td class="hide-m sub" title="${esc(fmtDate(l.createdAt))}">${ago(l.createdAt)}</td></tr>`).join('')
      : `<tr><td colspan="8"><div class="empty"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg><p>No leads found.</p></div></td></tr>`;
    $$('#leadRows tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.classList.contains('rowSel')) { e.target.checked ? LS.sel.add(tr.dataset.id) : LS.sel.delete(tr.dataset.id); tr.classList.toggle('sel', e.target.checked); updBulk(); return; }
      openLead(tr.dataset.id);
    }));
    const from = d.total ? (d.page - 1) * d.per + 1 : 0;
    $('#pgInfo').textContent = `${from}–${Math.min(d.total, d.page * d.per)} of ${d.total}`;
    $('#pgPrev').disabled = d.page <= 1; $('#pgNext').disabled = d.page * d.per >= d.total;
    $('#selAll').checked = d.leads.length > 0 && d.leads.every((l) => LS.sel.has(l.id));
    updBulk();
  }
  $('#selAll').onchange = (e) => { (LS.data?.leads || []).forEach((l) => (e.target.checked ? LS.sel.add(l.id) : LS.sel.delete(l.id))); loadLeads(); };
  const updBulk = () => { $('#bulk').classList.toggle('show', LS.sel.size > 0); $('#bulkN').textContent = LS.sel.size; };
  $('#bulkClear').onclick = () => { LS.sel.clear(); loadLeads(); };
  $('#bulkGo').onclick = async () => {
    const action = $('#bulkAct').value; if (!action) return toast('Choose an action first', true);
    if (action === 'delete' && !confirm(`Delete ${LS.sel.size} lead(s) permanently?`)) return;
    const b = $('#bulkGo'); b.disabled = true; b.textContent = 'Working…';
    try {
      const r = await api('/leads/bulk', { method: 'POST', body: { ids: [...LS.sel], action } });
      toast(action === 'sync' ? `Synced ${r.synced}, failed ${r.failed}${r.error ? ' — ' + r.error : ''}` : `Updated ${r.n} lead(s)`, action === 'sync' && r.failed);
      LS.sel.clear(); $('#bulkAct').value = ''; loadLeads();
    } catch (e) { toast(e.message, true); } finally { b.disabled = false; b.textContent = 'Apply'; }
  };

  // ---------- lead drawer ----------
  const drawer = $('#drawer'), bg = $('#drawerBg');
  const closeDrawer = () => { drawer.classList.remove('open'); bg.classList.remove('open'); };
  bg.onclick = closeDrawer; addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());
  async function openLead(id) {
    const l = await api('/leads/' + id).catch((e) => toast(e.message, true)); if (!l) return;
    renderLead(l); drawer.classList.add('open'); bg.classList.add('open');
  }
  function renderLead(l) {
    const row = (k, v) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : '');
    drawer.innerHTML = `<div class="dh"><button class="x" aria-label="Close">✕</button><span style="font-size:.8rem;letter-spacing:.12em;font-weight:800;color:var(--gold-2)">${esc(l.ref)} · ${esc(l.source.toUpperCase())}</span><h2>${esc(l.name)}</h2><span>Received ${esc(fmtDate(l.createdAt))}</span>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">${l.phone ? `<a class="btn sm gold" href="tel:${esc(l.phone)}">📞 Call</a>` : ''}<a class="btn sm gold" href="mailto:${esc(l.email)}?subject=${encodeURIComponent('Your EHA enquiry ' + l.ref)}">✉ Email</a><button class="btn sm ghost" id="dSync">${l.zoho && l.zoho.id ? '↻ Re-sync to Zoho' : '→ Send to Zoho'}</button><button class="btn sm danger" id="dDel">Delete</button></div></div>
    <div class="db">
      <div class="card"><h3>Pipeline stage</h3><div class="pipeline">${STATUSES.map((s) => `<button data-s="${s}" class="${s === l.status ? 'on' : ''}">${s}</button>`).join('')}</div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:14px"><label class="muted" style="font-weight:700;font-size:.85rem">Follow-up date</label><input type="date" class="inp" id="dFollow" value="${esc(l.followUp || '')}"><span style="margin-left:auto">${scoreEl(l.score)} <span class="muted small">lead score</span></span></div></div>
      <div class="card"><h3>Details</h3><dl class="kv">
        ${row('Email', `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>`)}${row('Mobile', l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : '')}
        ${row('State', esc(l.state))}${row('Budget', esc(l.budget))}${row('Deposit', esc(l.deposit))}${row('Timeframe', esc(l.timeframe))}
        ${row('Employment', esc(l.employment))}${row('Interest', esc(l.homeType))}${row('Message', esc(l.message).replace(/\n/g, '<br>'))}
        ${row('Consent', l.consent ? '✓ Yes' : 'No')}${row('Marketing', l.marketing ? '✓ Opted in' : 'No')}${row('Page', esc(l.page))}
        ${row('Campaign', l.utm && Object.keys(l.utm).length ? esc(Object.entries(l.utm).map(([k, v]) => k.replace('utm_', '') + ': ' + v).join(', ')) : '')}
        ${row('Zoho CRM', l.zoho && l.zoho.id ? `✓ ID ${esc(l.zoho.id)}<br><span class="muted">${esc(fmtDate(l.zoho.syncedAt))}</span>` : l.zoho && l.zoho.error ? `<span class="z-err">${esc(l.zoho.error)}</span>` : 'Not synced')}
      </dl></div>
      <div class="card notes"><h3>Notes</h3><textarea id="dNote" placeholder="Add a call note, next step…"></textarea><button class="btn sm" id="dAddNote" style="margin:10px 0 14px">Add note</button>
        <div style="display:grid;gap:10px">${l.notes.map((n) => `<div class="note">${esc(n.text)}<small>${esc(n.by)} · ${esc(fmtDate(n.at))}</small></div>`).join('') || '<p class="muted">No notes yet.</p>'}</div></div>
      <div class="card"><h3>Activity</h3><ul class="act">${l.activity.map((a) => `<li>${esc(a.text)}<small>${esc(fmtDate(a.at))}</small></li>`).join('')}</ul></div>
    </div>`;
    $('.x', drawer).onclick = closeDrawer;
    $$('.pipeline button', drawer).forEach((b) => (b.onclick = async () => { const u = await api('/leads/' + l.id, { method: 'PATCH', body: { status: b.dataset.s } }); renderLead(u); toast('Status → ' + b.dataset.s); refresh(); }));
    $('#dFollow').onchange = async (e) => { await api('/leads/' + l.id, { method: 'PATCH', body: { followUp: e.target.value } }); toast('Follow-up date saved'); };
    $('#dAddNote').onclick = async () => { const t = $('#dNote').value.trim(); if (!t) return; renderLead(await api(`/leads/${l.id}/notes`, { method: 'POST', body: { text: t } })); toast('Note added'); };
    $('#dDel').onclick = async () => { if (!confirm('Delete this lead permanently?')) return; await api('/leads/' + l.id, { method: 'DELETE' }); closeDrawer(); toast('Lead deleted'); refresh(); };
    $('#dSync').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Syncing…'; try { renderLead(await api(`/leads/${l.id}/sync`, { method: 'POST' })); toast('Sent to Zoho CRM'); } catch (x) { toast(x.message, true); if (x.data && x.data.lead) renderLead(x.data.lead); else { e.target.disabled = false; e.target.textContent = 'Retry Zoho sync'; } } refresh(); };
  }
  const refresh = () => { const v = (location.hash.slice(1) || 'dashboard').split('?')[0]; if (v === 'leads') loadLeads(); else if (v === 'dashboard') loadDash(); };

  // ---------- zoho ----------
  async function loadZoho(qs) {
    if (qs.get('ok')) toast('Zoho CRM connected!'); if (qs.get('err')) toast('Zoho: ' + qs.get('err'), true);
    if (qs.get('ok') || qs.get('err')) history.replaceState(null, '', '#zoho');
    const z = await api('/zoho'); const f = $('#zForm');
    $('#zDc').innerHTML = Object.entries(z.dcs).map(([k, v]) => `<option value="${esc(k)}" ${k === z.dc ? 'selected' : ''}>${esc(v)} (zoho.${esc(k)})</option>`).join('');
    f.clientId.value = z.clientId || ''; f.leadSource.value = z.leadSource || 'Website'; f.autoSync.checked = !!z.autoSync; f.clientSecret.value = ''; f.refreshToken.value = '';
    f.clientSecret.placeholder = z.hasSecret ? '••••••• saved (leave blank to keep)' : 'Paste client secret';
    $('#zRedirect').textContent = z.redirectUri;
    $('#zDot').className = 'dot ' + (z.connected ? 'ok' : 'no');
    $('#zState').textContent = z.connected ? 'Connected to Zoho CRM' : 'Not connected';
    $('#zAs').textContent = z.connected ? (z.connectedAs || 'Credentials saved — click Test to verify') : 'Add your API credentials below.';
    $('#zDisc').hidden = !z.connected; $('#zTest').hidden = !z.connected;
    $('#zLog').innerHTML = z.log.length ? z.log.map((x) => `<div><span class="${x.ok ? 'z-ok' : 'z-err'}">${x.ok ? '✓' : '✗'}</span><b>${esc(x.ref)}</b><span class="muted" style="flex:1">${esc(x.msg)}</span><span class="muted">${ago(x.at)}</span></div>`).join('') : '<p class="muted">No sync activity yet.</p>';
  }
  $('#zForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('/zoho', { method: 'PUT', body: { dc: f.dc.value, clientId: f.clientId.value, clientSecret: f.clientSecret.value, refreshToken: f.refreshToken.value, leadSource: f.leadSource.value, autoSync: f.autoSync.checked } }); toast('Zoho settings saved'); loadZoho(new URLSearchParams()); } catch (x) { toast(x.message, true); }
  };
  $('#zConnect').onclick = (e) => { if (!$('#zForm').clientId.value) { e.preventDefault(); toast('Enter and save your Client ID and Secret first', true); } };
  $('#zTest').onclick = async (e) => { e.target.disabled = true; try { const r = await api('/zoho/test', { method: 'POST' }); toast(`Connected as ${r.user.name || r.user.email}`); loadZoho(new URLSearchParams()); } catch (x) { toast(x.message, true); } e.target.disabled = false; };
  $('#zDisc').onclick = async () => { if (!confirm('Disconnect Zoho CRM? Existing leads stay in Zoho.')) return; await api('/zoho/disconnect', { method: 'POST' }); toast('Disconnected'); loadZoho(new URLSearchParams()); };
  $('#zSyncAll').onclick = async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Syncing…';
    try { const d = await api('/leads?zoho=unsynced&per=100'); if (!d.leads.length) { toast('Everything is already in Zoho'); return; }
      const r = await api('/leads/bulk', { method: 'POST', body: { ids: d.leads.map((l) => l.id), action: 'sync' } }); toast(`Synced ${r.synced}, failed ${r.failed}${r.error ? ' — ' + r.error : ''}`, r.failed); loadZoho(new URLSearchParams());
    } catch (x) { toast(x.message, true); } finally { b.disabled = false; b.textContent = 'Sync all unsynced leads'; }
  };

  // ---------- settings ----------
  async function loadSettings() {
    const f = $('#acctForm'); f.name.value = me.name; f.email.value = me.email; $('#mustChange').hidden = !me.mustChange;
    const users = await api('/users'); renderUsers(users);
  }
  const renderUsers = (users) => {
    $('#users').innerHTML = users.map((u) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)"><div style="width:36px;height:36px;border-radius:50%;background:var(--forest);color:var(--gold);display:grid;place-items:center;font-weight:800">${esc(u.name[0] || '?').toUpperCase()}</div><div style="flex:1"><b>${esc(u.name)}</b>${u.id === me.id ? ' <span class="tag src">you</span>' : ''}<br><span class="muted">${esc(u.email)}${u.lastLogin ? ' · last login ' + ago(u.lastLogin) : ' · never signed in'}</span></div>${u.id !== me.id ? `<button class="btn sm danger" data-del="${esc(u.id)}">Remove</button>` : ''}</div>`).join('');
    $$('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Remove this team member?')) return; try { renderUsers(await api('/users/' + b.dataset.del, { method: 'DELETE' })); toast('Removed'); } catch (x) { toast(x.message, true); } }));
  };
  $('#acctForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { me = await api('/account', { method: 'PUT', body: { name: f.name.value, email: f.email.value, currentPassword: f.currentPassword.value, newPassword: f.newPassword.value } }); f.currentPassword.value = f.newPassword.value = ''; setMe(); loadSettings(); toast('Account saved'); } catch (x) { toast(x.message, true); }
  };
  $('#userForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { renderUsers(await api('/users', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value } })); f.reset(); toast('Team member added — they’ll be asked to change their password'); } catch (x) { toast(x.message, true); }
  };

  const setMe = () => { $('#meName').textContent = me.name; $('#meEmail').textContent = me.email; };
  (async () => {
    me = await api('/me'); setMe();
    if (me.mustChange && !location.hash.startsWith('#settings')) { location.hash = '#settings'; toast('Please set a new password first', true); }
    route();
    setInterval(() => { if (!document.hidden && !drawer.classList.contains('open')) refresh(); }, 60000);
  })();
})();
