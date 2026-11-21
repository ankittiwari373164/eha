/* EHA site interactions */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- page load / transitions ----
  const ready = () => requestAnimationFrame(() => document.body.classList.add('loaded'));
  if (document.readyState !== 'loading') setTimeout(ready, 250); else addEventListener('DOMContentLoaded', () => setTimeout(ready, 250));
  setTimeout(ready, 1200); // fail-safe
  addEventListener('pageshow', (e) => { if (e.persisted) document.body.classList.remove('leaving'); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]'); if (!a || reduce) return;
    const href = a.getAttribute('href');
    if (a.target || e.metaKey || e.ctrlKey || e.shiftKey || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || a.host !== location.host) return;
    if (a.pathname === location.pathname && a.hash) return;
    e.preventDefault(); document.body.classList.add('leaving'); setTimeout(() => (location.href = a.href), 420);
  });

  // ---- UTM persistence ----
  const qs = new URLSearchParams(location.search); const utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((k) => qs.get(k) && (utm[k] = qs.get(k)));
  try { if (Object.keys(utm).length) sessionStorage.setItem('eha_utm', JSON.stringify(utm)); } catch {}
  const getUtm = () => { try { return JSON.parse(sessionStorage.getItem('eha_utm') || '{}'); } catch { return {}; } };

  // ---- nav ----
  const nav = $('header.nav'), prog = $('.scroll-progress'), sticky = $('.sticky-cta'), top = $('.to-top');
  $('.burger')?.addEventListener('click', () => { document.body.classList.toggle('nav-open'); $('.burger').setAttribute('aria-expanded', document.body.classList.contains('nav-open')); });
  $$('.menu a').forEach((a) => { if (a.pathname === location.pathname || (location.pathname === '/' && a.pathname === '/')) a.classList.add('active'); });
  top?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

  // ---- scroll-driven effects ----
  const par = $$('.parallax img'), tlBar = $('.timeline .bar'), tl = $('.timeline');
  let ticking = false;
  const onScroll = () => {
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    nav?.classList.toggle('scrolled', y > 20);
    if (prog) prog.style.transform = `scaleX(${h > 0 ? y / h : 0})`;
    sticky?.classList.toggle('show', y > 700 && y < h - 600);
    top?.classList.toggle('show', y > 900);
    if (!reduce) par.forEach((img) => { const r = img.parentElement.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) img.style.transform = `translateY(${(r.top + r.height / 2 - innerHeight / 2) * -0.12}px)`; });
    if (tl && tlBar) { const r = tl.getBoundingClientRect(); const p = Math.min(1, Math.max(0, (innerHeight * 0.6 - r.top) / r.height)); tlBar.style.height = p * 100 + '%'; }
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(onScroll); ticking = true; } }, { passive: true });
  onScroll();

  // ---- reveal ----
  $$('.stagger').forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty('--i', i)));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  $$('.rv, .tl-item').forEach((el) => io.observe(el));

  // ---- counters ----
  const co = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; co.unobserve(e.target);
    const el = e.target, end = +el.dataset.count, pre = el.dataset.pre || '', suf = el.dataset.suf || '', t0 = performance.now(), dur = 1800;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur), v = Math.round(end * (1 - Math.pow(1 - p, 3))); el.textContent = pre + v.toLocaleString() + suf; if (p < 1) requestAnimationFrame(step); };
    reduce ? (el.textContent = pre + end.toLocaleString() + suf) : requestAnimationFrame(step);
  }), { threshold: 0.6 });
  $$('[data-count]').forEach((el) => co.observe(el));

  // ---- tilt cards ----
  if (!reduce && matchMedia('(hover:hover)').matches) $$('.tilt').forEach((c) => {
    c.addEventListener('mousemove', (e) => { const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; c.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-6px)`; });
    c.addEventListener('mouseleave', () => (c.style.transform = ''));
  });
  // magnetic buttons
  if (!reduce && matchMedia('(hover:hover)').matches) $$('.magnet').forEach((b) => {
    b.addEventListener('mousemove', (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px,${(e.clientY - r.top - r.height / 2) * 0.35}px)`; });
    b.addEventListener('mouseleave', () => (b.style.transform = ''));
  });

  // ---- carousel ----
  $$('.carousel').forEach((c) => {
    const slides = $$('.slide', c), dots = $('.dots', c); let i = 0, tm;
    slides.forEach((_, k) => { const d = document.createElement('i'); dots && dots.appendChild(d); });
    const go = (n) => { i = (n + slides.length) % slides.length; slides.forEach((s, k) => s.classList.toggle('on', k === i)); dots && [...dots.children].forEach((d, k) => { d.classList.remove('on'); if (k === i) { void d.offsetWidth; d.classList.add('on'); } }); clearTimeout(tm); tm = setTimeout(() => go(i + 1), 6000); };
    $('.prev', c)?.addEventListener('click', () => go(i - 1)); $('.next', c)?.addEventListener('click', () => go(i + 1));
    let sx = 0; c.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
    c.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); });
    go(0);
  });

  // ---- quotes ----
  $$('.quotes').forEach((q) => {
    const items = $$('.quote', q), dots = $('.quote-dots', q); let i = 0, tm;
    items.forEach((_, k) => { const b = document.createElement('button'); b.setAttribute('aria-label', 'Show quote ' + (k + 1)); b.onclick = () => go(k); dots.appendChild(b); });
    const go = (n) => { i = n % items.length; items.forEach((x, k) => x.classList.toggle('on', k === i)); [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); clearTimeout(tm); tm = setTimeout(() => go(i + 1), 7000); };
    go(0);
  });

  // ---- filters (homes / faq) ----
  $$('[data-filter-group]').forEach((g) => {
    const target = $(g.dataset.filterGroup);
    $$('button', g).forEach((b) => b.addEventListener('click', () => {
      $$('button', g).forEach((x) => x.classList.toggle('on', x === b));
      const f = b.dataset.filter;
      $$('[data-cat]', target).forEach((it) => { const show = f === 'all' || it.dataset.cat.split(' ').includes(f); it.classList.toggle('hide', !show); if (show) { it.classList.remove('in'); requestAnimationFrame(() => it.classList.add('in')); } });
    }));
  });

  // ---- deposit calculator ----
  const calc = $('#calc');
  if (calc) {
    const fmt = (n) => '$' + Math.round(n).toLocaleString('en-AU');
    const upd = () => {
      const price = +$('#c-price').value, dep = +$('#c-dep').value, rate = +$('#c-rate').value, yrs = 30;
      $$('input[type=range]', calc).forEach((r) => r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'));
      $('#o-price').textContent = fmt(price); $('#o-dep').textContent = (dep).toFixed(0) + '%'; $('#o-rate').textContent = rate.toFixed(2) + '%';
      const depAmt = price * dep / 100, loan = price - depAmt, r = rate / 100 / 12, n = yrs * 12;
      const m = r ? loan * r / (1 - Math.pow(1 + r, -n)) : loan / n;
      $('#r-month').textContent = fmt(m); $('#r-dep').textContent = fmt(depAmt); $('#r-loan').textContent = fmt(loan); $('#r-week').textContent = fmt(m * 12 / 52);
      $('#r-lmi').textContent = dep < 20 ? 'Likely (deposit under 20%)' : 'Usually not required';
    };
    $$('input', calc).forEach((i) => i.addEventListener('input', upd)); upd();
  }

  // ---- forms ----
  const T0 = Date.now();
  async function submitLead(data) {
    const r = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ t: T0, utm: getUtm(), page: location.pathname }, data)) });
    const j = await r.json().catch(() => ({ error: 'Unexpected server response' }));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  const formData = (f) => { const o = {}; new FormData(f).forEach((v, k) => (o[k] = v)); $$('input[type=checkbox]', f).forEach((c) => (o[c.name] = c.checked)); return o; };
  const showAlert = (el, msg, ok) => { if (!el) return alert(msg); el.textContent = msg; el.className = 'alert show ' + (ok ? 'ok' : 'err'); };

  // generic forms (contact, callback, newsletter)
  $$('form[data-lead]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', f), al = $('.alert', f), orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Sending…';
    try {
      const d = formData(f); d.consent = d.consent === true || d.consent === 'on';
      const j = await submitLead(Object.assign(d, { source: f.dataset.lead }));
      if (f.dataset.lead === 'newsletter') { f.innerHTML = '<p style="color:var(--gold-2);font-weight:700;padding:10px 14px">✓ You’re subscribed. Thanks!</p>'; return; }
      f.innerHTML = `<div class="success"><svg class="tick" viewBox="0 0 110 110"><circle cx="55" cy="55" r="50"/><path d="M33 57l15 15 30-32"/></svg><h3>Thank you — we’ve got it.</h3><div class="ref">Reference ${j.ref}</div><p class="muted">A member of the EHA team will be in touch within one business day.</p></div>`;
    } catch (err) { showAlert(al, err.message); btn.disabled = false; btn.innerHTML = orig; }
  }));

  // modal
  const modal = $('#callback');
  $$('[data-open-callback]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); modal?.classList.add('open'); setTimeout(() => $('input[name=name]', modal)?.focus(), 300); }));
  modal?.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('.x')) modal.classList.remove('open'); });
  addEventListener('keydown', (e) => e.key === 'Escape' && modal?.classList.remove('open'));

  // ---- assessment wizard ----
  const wz = $('#wizard');
  if (wz) {
    const steps = $$('.step', wz), bar = $('.wz-progress i'), list = $$('.wz-steps li'), back = $('#wz-back'), next = $('#wz-next'), al = $('.alert', wz), count = $('#wz-count');
    let cur = 0;
    // preselect from ?interest=
    const pre = qs.get('interest'); if (pre) { const r = $(`input[name=homeType][value="${CSS.escape(pre)}"]`, wz); if (r) r.checked = true; }
    const show = (n) => {
      cur = n; steps.forEach((s, k) => s.classList.toggle('on', k === n));
      list.forEach((l, k) => { l.classList.toggle('on', k === n); l.classList.toggle('done', k < n); });
      bar.style.width = ((n + 1) / steps.length) * 100 + '%'; count.textContent = `Step ${n + 1} of ${steps.length}`;
      back.style.visibility = n ? 'visible' : 'hidden';
      next.innerHTML = n === steps.length - 1 ? 'Send my assessment <span class="arr">→</span>' : 'Continue <span class="arr">→</span>';
      al.className = 'alert'; const y = wz.getBoundingClientRect().top + scrollY - 120; if (scrollY > y) scrollTo({ top: y, behavior: 'smooth' });
    };
    const validate = (n) => {
      const s = steps[n]; $$('.field', s).forEach((f) => f.classList.remove('err'));
      for (const g of new Set($$('input[type=radio][required]', s).map((r) => r.name))) if (!$(`input[name="${g}"]:checked`, s)) return 'Please choose an option to continue.';
      for (const i of $$('input[required]:not([type=radio]):not([type=checkbox]),select[required]', s)) if (!i.value.trim()) { i.closest('.field')?.classList.add('err'); i.focus(); return 'Please complete the highlighted field.'; }
      const em = $('input[type=email]', s); if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value)) { em.closest('.field').classList.add('err'); return 'Please enter a valid email address.'; }
      const ph = $('input[type=tel]', s); if (ph && !/^[+()\d\s-]{8,20}$/.test(ph.value)) { ph.closest('.field').classList.add('err'); return 'Please enter a valid mobile number.'; }
      const c = $('input[name=consent]', s); if (c && !c.checked) return 'Please tick the consent box so we can respond.';
      return '';
    };
    // auto-advance on single-choice steps
    steps.forEach((s, k) => $$('input[type=radio]', s).forEach((r) => r.addEventListener('change', () => { if (!$('select,textarea,input:not([type=radio])', s) && k < steps.length - 1) setTimeout(() => show(k + 1), 280); })));
    back.addEventListener('click', () => cur > 0 && show(cur - 1));
    next.addEventListener('click', async () => {
      const err = validate(cur); if (err) return showAlert(al, err);
      if (cur < steps.length - 1) return show(cur + 1);
      next.disabled = true; next.innerHTML = 'Sending…';
      try {
        const j = await submitLead(Object.assign(formData(wz), { source: 'assessment' }));
        $('.wz-body', wz).innerHTML = `<div class="success"><svg class="tick" viewBox="0 0 110 110"><circle cx="55" cy="55" r="50"/><path d="M33 57l15 15 30-32"/></svg><h2>You’re one step closer.</h2><div class="ref">Reference ${j.ref}</div><p class="lead" style="margin:0 auto">Thanks! An EHA specialist will review your answers and call you within one business day to talk through your options.</p><p style="margin-top:28px"><a class="btn" href="/homes">Browse home designs <span class="arr">→</span></a></p></div>`;
        bar.style.width = '100%'; list.forEach((l) => { l.classList.remove('on'); l.classList.add('done'); }); count.textContent = 'Complete';
      } catch (e) { showAlert(al, e.message); next.disabled = false; next.innerHTML = 'Send my assessment <span class="arr">→</span>'; }
    });
    wz.addEventListener('submit', (e) => { e.preventDefault(); next.click(); });
    show(0);
  }

  $$('[data-year]').forEach((e) => (e.textContent = new Date().getFullYear()));
})();