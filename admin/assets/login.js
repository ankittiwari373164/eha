document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err'), btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Signing in…'; err.classList.remove('show');
  try {
    const r = await fetch('/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('pw').value }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Sign in failed');
    location.href = j.mustChange ? '/admin/#settings' : '/admin/';
  } catch (x) { err.textContent = x.message; err.classList.add('show'); btn.disabled = false; btn.textContent = 'Sign in →'; }
});