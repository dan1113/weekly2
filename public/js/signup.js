// /public/js/signup.js
import { API_BASE, AUTH_HEADERS, setUserId } from "./config.js";

const ID_REGEX = /^[A-Za-z0-9._-]{4,32}$/;
const PW_MIN = 6;

const form = document.getElementById("form");
const err = document.getElementById("err");
const toLogin = document.getElementById("toLogin");

toLogin?.addEventListener("click", () => (location.href = "/login.html"));

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (err) err.textContent = "";

  const username = document.getElementById("username")?.value.trim();
  const nickname = document.getElementById("nickname")?.value.trim();
  const password = document.getElementById("password")?.value || "";
  const password2 = document.getElementById("password2")?.value || "";

  try {
    validate(username, nickname, password, password2);

    // 1) CSRF 먼저 (쿠키 생성 + 토큰 값 확보)
    const csrf = await requestCsrf();

    // 2) 회원가입
    const res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      credentials: "include",
      headers: {
        ...AUTH_HEADERS({ "Content-Type": "application/json" }),
        // ★ 핵심: 서버는 X-CSRF-Token 헤더를 기대
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({ username, password, nickname }),
    });

    const data = await safeJson(res);

    if (!res.ok) {
      let message = data?.error || "회원가입에 실패했습니다.";
      if (res.status === 409) {
        // 서버는 "Username already taken" 형태로 내려줌
        if ((data?.error || "").toLowerCase().includes("username")) {
          message = "이미 사용 중인 아이디입니다.";
        }
      }
      throw new Error(message);
    }

    if (!data || !data.userId) {
      throw new Error("회원가입 처리에 문제가 발생했습니다.");
    }
    setUserId(data.userId);

    // 3) 세션 확인 (보호 리소스 호출로 검증)
    const ok = await waitForSession();
    if (!ok) throw new Error("세션 생성에 실패했습니다. 다시 시도해 주세요.");

    location.href = "/calendar.html";
  } catch (signupErr) {
    if (err) err.textContent = signupErr.message || "오류가 발생했습니다.";
  }
});

function validate(username, nickname, pw1, pw2) {
  if (!ID_REGEX.test(username || "")) {
    throw new Error("아이디는 영문/숫자/._- 4~32자로 입력하세요.");
  }
  if (!nickname || nickname.length < 1 || nickname.length > 24 ||
      !/^[\p{L}\p{N}_\-\s]+$/u.test(nickname)) {
    throw new Error("닉네임은 한글/영문/숫자/공백/_/- 1~24자로 입력하세요.");
  }
  if (pw1.length < PW_MIN) throw new Error(`비밀번호는 최소 ${PW_MIN}자 이상이어야 합니다.`);
  if (pw1 !== pw2) throw new Error("비밀번호가 서로 다릅니다.");
}

async function requestCsrf() {
  const res = await fetch(`${API_BASE}/api/csrf`, {
    method: "GET",
    credentials: "include", // ★ 쿠키 받아야 함
    headers: AUTH_HEADERS(),
  });
  const data = await safeJson(res);
  if (res.ok && data?.csrfToken) return data.csrfToken;
  // 예전처럼 "dev"로 대체하지 말고 실패를 명확히 알림
  throw new Error("CSRF 토큰을 가져오지 못했습니다.");
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

// 워커에는 /api/auth/session이 없으니 인증 필요한 리소스 호출로 판정
async function waitForSession(timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${API_BASE}/api/diary`, { credentials: "include" });
      if (r.status === 200) return true; // 세션 쿠키 유효
    } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  return false;
}
