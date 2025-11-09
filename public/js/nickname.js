async function getCsrf() {
  const r = await fetch('/api/csrf', { credentials: 'include' });
  const j = await r.json();
  return j.csrfToken;
}

// (선택) 서버에 사전 중복 체크 API가 있을 때 사용.
// 없으면 404가 떨어질 수 있으니, 그땐 PATCH 결과(409)로 처리하게끔 설계.
async function isNicknameTaken(nickname) {
  try {
    const csrfToken = await getCsrf();
    const r = await fetch('/api/users/check-nickname', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CSRF-Token': csrfToken
      },
      credentials: 'include',
      body: JSON.stringify({ nickname })
    });
    if (r.status === 404) return null; // 사전체크 엔드포인트 없음 -> 서버 PATCH에서 판단
    const j = await r.json();
    // 기대 응답: { exists: true/false }
    return !!j.exists;
  } catch {
    // 네트워크 에러 등 -> 사전 체크 패스하고 PATCH에서 최종 판단
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('form');
  const err = document.getElementById('err');
  const logoutBtn = document.getElementById('logoutBtn');
  const input = document.getElementById('nickname');

  // 세션 확인
  const sess = await fetch('/api/auth/session', { credentials: 'include' }).then(r=>r.json());
  if (!sess.loggedIn) { location.href = '/login.html'; return; }
  if (sess.nickname) input.value = sess.nickname;

  // 로그아웃
  logoutBtn.addEventListener('click', async () => {
    const csrfToken = await getCsrf();
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'CSRF-Token': csrfToken },
      credentials: 'include'
    });
    location.href = '/login.html';
  });

  // 폼 제출
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';

    let nickname = input.value.trim();

    // 1) 클라이언트 1차 검증
    if (nickname.length < 1 || nickname.length > 24) {
      err.textContent = '닉네임은 1~24자';
      return;
    }
    // (선택) 허용 문자 제한: 한글/영문/숫자/밑줄/하이픈/공백
    // 필요 없다면 이 블록 지워도 됩니다.
    const ok = /^[\p{L}\p{N}_\-\s]+$/u.test(nickname);
    if (!ok) {
      err.textContent = '특수문자 제한: 한글/영문/숫자/공백/_/- 만 허용';
      return;
    }

    // 중복 체크 버튼 없이도 제출 시 사전 확인 (엔드포인트 있을 때만)
    const taken = await isNicknameTaken(nickname);
    if (taken === true) {
      err.textContent = '이미 사용 중인 닉네임입니다.';
      return;
    }

    // 2) 서버 요청 (최종 보스: DB UNIQUE + 409 핸들링)
    const csrfToken = await getCsrf();

    // 중복 제출 방지
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const r = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ nickname })
      });

      // 서버가 UNIQUE 제약 위반 시 409로 내려주면 메시지 처리
      if (r.status === 409) {
        err.textContent = '이미 사용 중인 닉네임입니다.';
        return;
      }

      const j = await r.json();
      if (!r.ok) {
        err.textContent = j.error || '저장 실패';
        return;
      }

      // 성공
      location.href = '/calendar.html';
    } catch (e) {
      err.textContent = '네트워크 오류. 잠시 후 다시 시도하세요.';
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
});
