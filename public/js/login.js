// /public/js/login.js
import { API_BASE, AUTH_HEADERS, setUserId } from "./config.js";

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  const form = $("form");
  const err = $("err");
  const toSignup = $("toSignup");
  const reloadLink = $("reloadLink");

  toSignup?.addEventListener("click", () => (location.href = "/signup.html"));
  reloadLink?.addEventListener("click", (e) => {
    e.preventDefault();
    location.reload();
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (err) err.textContent = "";

    const username = $("username")?.value.trim();
    const password = $("password")?.value || "";
    if (!username || !password) {
      if (err) err.textContent = "아이디와 비밀번호를 모두 입력해 주세요.";
      return;
    }

    try {
      // 1) CSRF 토큰 쿠키 + 값 받기 (반드시 include)
      const csrf = await requestCsrf();
      // 2) 로그인
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          ...AUTH_HEADERS({ "Content-Type": "application/json" }),
          // ★ 핵심 수정: 워커는 X-CSRF-Token을 기대함
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify({ username, password }),
      });
      const data = await safeJson(res);

      if (!res.ok) {
        let message = data?.error || "로그인에 실패했습니다.";
        if (res.status === 401 || res.status === 404)
          message = "아이디 또는 비밀번호가 틀렸습니다.";
        if (err) err.textContent = message;
        return;
      }

      if (!data || !data.userId) {
        if (err) err.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
        return;
      }
      setUserId(data.userId);

      // 3) 세션이 실제로 붙었는지 최종 확인
      const ok = await waitForSession();
      if (!ok) {
        if (err) err.textContent = "세션 생성에 실패했습니다. 다시 시도해 주세요.";
        return;
      }

      const params = new URLSearchParams(location.search);
      const next = params.get("next");
      if (next) { location.href = next; return; }
      location.href = "/calendar.html";
    } catch (error) {
      console.error(error);
      if (err) err.textContent = error.message || "로그인 중 오류가 발생했습니다.";
    }
  });
});

async function requestCsrf() {
  const res = await fetch(`${API_BASE}/api/csrf`, {
    method: "GET",
    credentials: "include", // ★ 쿠키 받아야 함
    headers: AUTH_HEADERS(),
  });
  const data = await safeJson(res);
  if (res.ok && data?.csrfToken) return data.csrfToken;
  // 예전 코드처럼 "dev"로 대체하지 말고 명확히 실패 처리
  throw new Error("CSRF 토큰을 가져오지 못했습니다.");
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

// 워커에 /api/auth/session 엔드포인트가 없으므로,
// 인증 필요한 리소스(/api/diary)를 조회해서 200이면 세션 OK로 판정
async function waitForSession(timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`${API_BASE}/api/diary`, { credentials: "include" });
      if (r.status === 200) return true; // 세션 쿠키 유효
    } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  return false;
}
