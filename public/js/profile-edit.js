// /public/js/profile-edit.js (recreated)
async function getCsrf() {
  const r = await fetch('/api/csrf', { credentials: 'include' });
  const j = await r.json();
  return j.csrfToken;
}

function isAcceptableImage(file) {
  if (!file) return false;
  const okType = /^image\/(png|jpe?g|gif|webp|avif|heic|heif)$/i.test(file.type);
  const okSize = file.size <= 2 * 1024 * 1024; // 2MB
  return okType && okSize;
}

document.addEventListener('DOMContentLoaded', async () => {
  const fileEl  = document.getElementById('file');
  const preview = document.getElementById('preview');
  const bioEl   = document.getElementById('bio');
  const saveBtn = document.getElementById('save');

  let previewUrl = null;
  let csrfToken = await getCsrf();

  // 현재 사용자 불러와 기본 값 세팅
  try {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then(r=>r.json());
    if (sess && sess.loggedIn) {
      const me = await fetch(`/api/users/${encodeURIComponent(sess.userId)}`, { credentials: 'include' }).then(r=>r.json());
      if (me && me.user) {
        if (preview) preview.src = me.user.avatar_url || '/image/logoblack.svg';
        if (bioEl) bioEl.value = me.user.bio || '';
      }
    }
  } catch {}

  // 파일 선택 미리보기
  if (fileEl) fileEl.addEventListener('change', () => {
    const f = fileEl.files && fileEl.files[0];
    if (!f) return;
    if (!isAcceptableImage(f)) {
      alert('이미지 형식(png/jpg/gif/webp/avif), 2MB 이하만 업로드 가능합니다.');
      fileEl.value = '';
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    if (preview) preview.src = previewUrl;
  });

  // 저장
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '업로드 중..';
    try {
      // 필요 시 CSRF 재발급
      csrfToken = await getCsrf();

      // 1) 아바타 업로드 (선택)
      if (fileEl && fileEl.files && fileEl.files[0]) {
        const fd = new FormData();
        fd.append('avatar', fileEl.files[0]);
        const r1 = await fetch('/api/users/me/avatar', {
          method: 'POST',
          credentials: 'include',
          headers: { 'CSRF-Token': csrfToken },
          body: fd,
        });
        const j1 = await r1.json().catch(()=>({}));
        if (!r1.ok) {
          const msg = (j1 && j1.error) || '';
          if (/파일|file/i.test(msg)) alert('선택된 파일이 없거나 전송되지 않았습니다. 다시 선택해 주세요.');
          else alert(j1?.error || '아바타 업로드 실패');
          return;
        }
      }

      // 2) bio 저장 (선택)
      if (bioEl) {
        const r2 = await fetch('/api/users/me/bio', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
          body: JSON.stringify({ bio: bioEl.value || '' }),
        });
        const j2 = await r2.json().catch(()=>({}));
        if (!r2.ok) {
          alert(j2?.error || '저장 실패');
          return;
        }
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

  // 페이지 이탈 시 미리보기 URL 해제
  window.addEventListener('beforeunload', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
});


