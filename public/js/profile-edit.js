// /public/js/profile-edit.js
async function getCsrf() {
  const r = await fetch('/api/csrf', { credentials: 'include' });
  const j = await r.json();
  return j.csrfToken;
}

function isAcceptableImage(file) {
  if (!file) return false;
  const okType = /^image\/(png|jpe?g|gif|webp|avif)$/i.test(file.type);
  const okSize = file.size <= 2 * 1024 * 1024; // 2MB
  return okType && okSize;
}

document.addEventListener('DOMContentLoaded', async () => {
  const fileEl   = document.getElementById('file');
  const preview  = document.getElementById('preview');
  const bioEl    = document.getElementById('bio');
  const saveBtn  = document.getElementById('save');

  let previewUrl; // revoke용
  let csrfToken   = await getCsrf();

  // 0) 현재 내 프로필 프리필 (선택: 있으면 UX ↑)
  try {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then(r=>r.json());
    if (sess?.loggedIn) {
      const me = await fetch(`/api/users/${encodeURIComponent(sess.userId)}`, { credentials: 'include' }).then(r=>r.json());
      if (me?.user) {
        preview.src = me.user.avatar_url || '/image/avatar-default.png';
        bioEl.value = me.user.bio || '';
      }
    }
  } catch {}

  // 1) 선택 시 미리보기
  fileEl.addEventListener('change', () => {
    const f = fileEl.files?.[0];
    if (!f) return;

    if (!isAcceptableImage(f)) {
      alert('이미지 형식(png/jpg/gif/webp/avif), 2MB 이하만 업로드할 수 있어요.');
      fileEl.value = '';
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    preview.src = previewUrl;
  });

  // 2) 저장
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
      // (필요 시) CSRF 재발급 — 토큰 만료 대비
      csrfToken = await getCsrf();

      // 2-1) 아바타 업로드 (선택)
      if (fileEl.files && fileEl.files[0]) {
        const fd = new FormData();
        fd.append('avatar', fileEl.files[0]);     // ← 서버의 필드명과 일치
        const r1 = await fetch('/api/users/me/avatar', {
          method: 'POST',
          credentials: 'include',
          headers: { 'CSRF-Token': csrfToken },   // Content-Type 직접 세팅 금지!
          body: fd
        });
        const j1 = await r1.json().catch(()=>({}));
        if (!r1.ok) {
          alert(j1?.error || '아바타 업로드 실패');
          return;
        }
      }

      // 2-2) bio 저장 (빈 값 허용)
      const r2 = await fetch('/api/users/me/bio', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
        body: JSON.stringify({ bio: bioEl.value || '' })
      });
      const j2 = await r2.json().catch(()=>({}));
      if (!r2.ok) {
        alert(j2?.error || '저장 실패');
        return;
      }

      alert('저장 완료');
      location.href = '/me.html';
    } catch (e) {
      console.error(e);
      alert('네트워크 오류');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });

  // 페이지 이탈 시 미리보기 URL 정리
  window.addEventListener('beforeunload', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
});
