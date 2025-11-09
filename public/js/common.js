// /public/js/common.js
export async function getCSRF() {
  const r = await fetch("/api/csrf", { credentials: "include" });
  const j = await r.json();
  return j.csrfToken;
}

export async function api(url, opts = {}) {
  const token = await getCSRF();
  const headers = { ...(opts.headers || {}) };
  if (!headers["X-CSRF-Token"]) headers["X-CSRF-Token"] = token;
  return fetch(url, { credentials: "include", ...opts, headers });
}

export async function getSession() {
  const r = await fetch("/api/auth/session", { credentials: "include" });
  return r.json();
}

export const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
