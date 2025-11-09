async function getCsrf() {
  const r = await fetch('/api/csrf', { credentials: 'include' });
  const j = await r.json();
  return j.csrfToken;
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form');
  const err = document.getElementById('err');

  // ✅ 인라인 제거 → JS로 이동
  const toLogin = document.getElementById('toLogin');
  if (toLogin) toLogin.addEventListener('click', () => location.href = '/login.html');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';

    const username = document.getElementById('username').value.trim();
    const p1 = document.getElementById('password').value;
    const p2 = document.getElementById('password2').value;

    if (!/^[a-zA-Z0-9_.]{4,32}$/.test(username)) { err.textContent = '아이디는 영문/숫자/._ 4~32자'; return; }
    if (p1 !== p2) { err.textContent = '비밀번호가 일치하지 않습니다.'; return; }
    if (p1.length < 6 || p1.length > 128) { err.textContent = '비밀번호는 6~128자'; return; }

    const csrfToken = await getCsrf();
    const r = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ username, password: p1 })
    });

    const j = await r.json();
    if (!r.ok) { err.textContent = j.error || '회원가입 실패'; return; }

    location.href = '/nickname.html';
  });
});
