// /public/js/profile.js (clean)
async function csrf() {
  const r = await fetch('/api/csrf', { credentials: 'include' });
  return (await r.json()).csrfToken;
}
async function session() {
  const r = await fetch('/api/auth/session', { credentials: 'include' });
  return r.json();
}

(async () => {
  const me = await session();
  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  if (!id) { alert('잘못된 접근'); history.back(); return; }
  if (me.loggedIn && me.userId === id) { location.replace('/me.html'); return; }

  const r = await fetch(`/api/users/${encodeURIComponent(id)}`, { credentials: 'include' });
  if (!r.ok) { alert('존재하지 않는 사용자입니다.'); history.back(); return; }
  const { user, relation } = await r.json();

  const $ = (s)=>document.querySelector(s);
  $('#avatar').src = user.avatar_url || '/image/logoblack.svg';
  $('#nickname').textContent = user.nickname || '(닉네임 없음)';
  $('#username').textContent = '@' + user.username;
  $('#bioText').textContent = user.bio || '소개가 없습니다.';

  // 미니 갤러리
  try {
    const rg = await fetch(`/api/diary/${user.id}/photos?limit=60`, { credentials: 'include' });
    const pj = await rg.json();
    const wrap = $('#gallery');
    wrap.innerHTML = '';
    (pj.items || []).forEach(p => {
      const img = document.createElement('img');
      img.src = p.image_url; img.alt = p.date;
      wrap.appendChild(img);
    });
  } catch {}

  // 버튼 상태
  const addBtn = $('#addBtn'), acceptBtn = $('#acceptBtn'), rejectBtn = $('#rejectBtn');
  const show = (...els)=>[addBtn,acceptBtn,rejectBtn].forEach(b=>b.style.display = els.includes(b) ? 'inline-block' : 'none');

  if (!relation) {
    addBtn.disabled = false; addBtn.textContent = '친구 요청'; show(addBtn);
  } else if (relation.status === 'accepted') {
    addBtn.disabled = true; addBtn.textContent = '이미 친구'; show(addBtn);
  } else if (relation.status === 'pending') {
    const iAmRequester = relation.requester_id === me.userId;
    if (iAmRequester) { addBtn.disabled = true; addBtn.textContent = '대기중'; show(addBtn); }
    else { show(acceptBtn, rejectBtn); }
  } else {
    addBtn.disabled = false; addBtn.textContent = '친구 요청'; show(addBtn);
  }

  addBtn.addEventListener('click', async () => {
    const token = await csrf();
    const r = await fetch('/api/friends/request', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': token },
      body: JSON.stringify({ toUserId: id })
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || '요청 실패');
    addBtn.disabled = true; addBtn.textContent = '대기중';
  });

  acceptBtn.addEventListener('click', async () => {
    const token = await csrf();
    const r = await fetch('/api/friends/respond', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': token },
      body: JSON.stringify({ fromUserId: id, action: 'accept' })
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || '실패');
    location.reload();
  });

  rejectBtn.addEventListener('click', async () => {
    const token = await csrf();
    const r = await fetch('/api/friends/respond', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': token },
      body: JSON.stringify({ fromUserId: id, action: 'reject' })
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || '실패');
    location.reload();
  });
})();
