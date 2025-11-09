async function getCsrf() {
  const r = await fetch('/api/csrf', { credentials: 'include' });
  const j = await r.json();
  return j.csrfToken;
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form');
  const err = document.getElementById('err');

  // ✅ CSP 우회: 인라인 대신 JS로 바인딩
  const toSignup = document.getElementById('toSignup');
  if (toSignup) toSignup.addEventListener('click', () => location.href = '/signup.html');

  const reloadLink = document.getElementById('reloadLink');
  if (reloadLink) reloadLink.addEventListener('click', (e) => { e.preventDefault(); location.reload(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    const csrfToken = await getCsrf();
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    const j = await r.json();
    if (!r.ok) { err.textContent = j.error || '로그인 실패'; return; }

    if (!j.nickname || !String(j.nickname).trim()) {
      location.href = '/nickname.html';
    } else {
      location.href = '/calendar.html';
    }
  });
});
