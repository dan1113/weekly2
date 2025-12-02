import { API_BASE, AUTH_HEADERS } from "./config.js";

const $ = (sel) => document.querySelector(sel);

async function safeJson(res) { try { return await res.json(); } catch { return {}; } }

async function getCsrf() {
  try {
    const res = await fetch(`${API_BASE}/api/csrf`, { credentials: "include", headers: AUTH_HEADERS() });
    const data = await safeJson(res);
    if (res.ok && data?.csrfToken) return data.csrfToken;
  } catch {}
  return "dev";
}

async function postJson(path, body, method = "POST") {
  const token = await getCsrf();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: AUTH_HEADERS({ "Content-Type": "application/json", "CSRF-Token": token }),
    body: JSON.stringify(body ?? {}),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || "요청 처리에 실패했습니다.");
  return data;
}

document.addEventListener("DOMContentLoaded", async () => {
  const form = $("#form");
  const err = $("#err");
  const logoutBtn = $("#logoutBtn");
  const input = $("#nickname");

  try {
    const sess = await fetch(`${API_BASE}/api/auth/session`, { credentials: "include", headers: AUTH_HEADERS() }).then(safeJson);
    if (sess?.nickname) input.value = sess.nickname;
  } catch {}

  logoutBtn?.addEventListener("click", async () => {
    try { await postJson(`/api/auth/logout`, {}); } catch {}
    location.href = "/login.html";
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (err) err.textContent = "";
    const nickname = (input.value || "").trim();
    try {
      if (!nickname || nickname.length > 24 || !/^[\p{L}\p{N}_\-\s]+$/u.test(nickname)) {
        throw new Error("닉네임은 한글/영문/숫자/공백/_/- 1~24자로 입력하세요.");
      }
      await postJson(`/api/users/me`, { nickname }, "PATCH");
      location.href = "/calendar.html";
    } catch (e2) {
      if (err) err.textContent = e2.message || "요청 처리에 실패했습니다.";
    }
  });
});

