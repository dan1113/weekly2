const runtime = typeof window !== "undefined" ? window : undefined;

// Cloudflare Pages vs local
const rawBase =
  (runtime && runtime.API_BASE) ||
  (typeof location !== "undefined" && location.hostname.includes("localhost")
    ? "http://localhost:8787"
    : "https://weeklydiary.store");

export const API_BASE = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

let cachedUserId = (typeof window !== "undefined" && window.USER_ID) || null;
let cachedCsrf = (typeof window !== "undefined" && window.__CSRF_TOKEN__) || null;
let csrfPromise = null;

function resolveStoredUserId() {
  if (cachedUserId) return cachedUserId;
  if (typeof window !== "undefined") {
    if (window.USER_ID) {
      cachedUserId = window.USER_ID;
      return cachedUserId;
    }
    try {
      const stored = localStorage.getItem("userId");
      if (stored) {
        cachedUserId = stored;
        return stored;
      }
    } catch (err) {
      console.warn("userId storage unavailable", err);
    }
  }
  return "";
}

function resolveStoredCsrf() {
  if (cachedCsrf) return cachedCsrf;

  // 1) meta tag
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta?.content) {
      cachedCsrf = meta.content;
      return cachedCsrf;
    }
  }

  // 2) window global
  if (typeof window !== "undefined" && window.__CSRF_TOKEN__) {
    cachedCsrf = window.__CSRF_TOKEN__;
    return cachedCsrf;
  }

  // 3) localStorage
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("csrfToken");
      if (stored) {
        cachedCsrf = stored;
        return stored;
      }
    } catch (err) {
      console.warn("csrf storage unavailable", err);
    }
  }

  return "";
}

function persistCsrf(token) {
  if (!token) return;
  cachedCsrf = token;
  if (typeof window !== "undefined") {
    window.__CSRF_TOKEN__ = token;
    try {
      localStorage.setItem("csrfToken", token);
    } catch (err) {
      console.warn("localStorage save failed", err);
    }
  }
}

export function setUserId(id) {
  if (!id) return;
  cachedUserId = id;
  if (typeof window !== "undefined") {
    window.USER_ID = id;
    try {
      localStorage.setItem("userId", id);
    } catch (err) {
      console.warn("unable to persist userId", err);
    }
  }
}

export async function ensureCsrfToken() {
  const existing = resolveStoredCsrf();
  if (existing) return existing;
  if (csrfPromise) return csrfPromise;

  csrfPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/csrf`, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`CSRF fetch failed: ${res.status}`);

      const data = await res.json().catch(() => ({}));
      const headerToken =
        res.headers.get("x-csrf-token") ||
        res.headers.get("csrf-token") ||
        res.headers.get("x-xsrf-token") ||
        res.headers.get("xsrf-token");

      const bodyToken = data?.csrfToken;
      const token = headerToken || bodyToken;
      if (token) persistCsrf(token);

      return cachedCsrf || "";
    } catch (err) {
      console.error("CSRF fetch error:", err);
      return "";
    } finally {
      csrfPromise = null;
    }
  })();

  return csrfPromise;
}

export function AUTH_HEADERS(extra = {}) {
  const headers = { ...extra };

  const uid = resolveStoredUserId();
  if (uid) headers["x-user-id"] = uid;

  const csrf = resolveStoredCsrf();
  if (csrf) {
    headers["CSRF-Token"] = csrf;
    headers["X-XSRF-TOKEN"] = csrf;
    headers["XSRF-TOKEN"] = csrf;
    headers["x-xsrf-token"] = csrf;
    headers["x-csrf-token"] = csrf;
    headers["x-csrf-token"] = csrf;
  }

  return headers;
}

export async function apiFetch(path, options = {}) {
  await ensureCsrfToken();
  const url = `${API_BASE}${path}`;
  const mergedHeaders = AUTH_HEADERS(options.headers);

  return fetch(url, {
    credentials: "include",
    ...options,
    headers: mergedHeaders,
  });
}
