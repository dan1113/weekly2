import { API_BASE, AUTH_HEADERS, ensureCsrfToken } from "./config.js";

export async function api(url, opts = {}) {
  const token = await ensureCsrfToken();
  const headers = { ...(opts.headers || {}), "X-CSRF-Token": token };
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
