import { API_BASE, AUTH_HEADERS } from "./config.js";

export async function getCSRF() {
  try {
    const res = await fetch(`${API_BASE}/api/csrf`, {
      credentials: "include",
      headers: AUTH_HEADERS(),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.csrfToken) return data.csrfToken;
  } catch {}
  // 개발 모드: 백엔드 라우트/도메인 미연결 시에도 진행되도록 허용
  return "dev";
}

export async function api(url, opts = {}) {
  const token = await getCSRF();
  const headers = { ...(opts.headers || {}), "CSRF-Token": token };
  return fetch(`${API_BASE}${url}`, {
    credentials: "include",
    ...opts,
    headers: AUTH_HEADERS(headers),
  });
}

export async function getSession() {
  const res = await fetch(`${API_BASE}/api/auth/session`, {
    credentials: "include",
    headers: AUTH_HEADERS(),
  });
  return res.json();
}

export const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

