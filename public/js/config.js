const runtime = typeof window !== "undefined" ? window : undefined;

// Cloudflare Pages vs local
const rawBase =
  (runtime && runtime.API_BASE) ||
  (typeof location !== "undefined" && location.hostname.includes("localhost")
    ? "http://localhost:8787"
    : "https://weeklydiary.store");

export const API_BASE = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

// CSRF: 단일 쿠키(XSRF-TOKEN) + 단일 헤더(X-CSRF-Token)
const CSRF_COOKIE = "XSRF-TOKEN";
const CSRF_HEADER = "X-CSRF-Token";
let cachedCsrf = null;
let csrfPromise = null;

function readCsrfCookie() {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const [k, v] = part.trim().split("=");
    if (k === CSRF_COOKIE && v !== undefined) return decodeURIComponent(v);
  }
  return "";
}

function resolveCsrf() {
  if (cachedCsrf) return cachedCsrf;
  const fromCookie = readCsrfCookie();
  if (fromCookie) {
    cachedCsrf = fromCookie;
    return cachedCsrf;
  }
  return "";
}

export async function ensureCsrfToken() {
  const existing = resolveCsrf();
  if (existing) return existing;
  if (csrfPromise) return csrfPromise;

  csrfPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/csrf`, {
        method: "GET",
        credentials: "include",
      });
      // CSRF 발급 엔드포인트는 쿠키를 내려주기만 하면 됨.
      // 헤더/바디는 사용하지 않고, 쿠키를 다시 읽는다.
      const token = readCsrfCookie();
      if (token) {
        cachedCsrf = token;
        return token;
      }
      // 혹시 헤더로 내려줬다면 보조적으로 읽음
      const hdr = res.headers.get(CSRF_HEADER.toLowerCase()) || res.headers.get(CSRF_HEADER);
      if (hdr) {
        cachedCsrf = hdr;
        return hdr;
      }
      return "";
    } catch (err) {
      console.error("CSRF fetch error:", err);
      return "";
    } finally {
      csrfPromise = null;
    }
  })();

  return csrfPromise;
}

let cachedUserId = (typeof window !== "undefined" && window.USER_ID) || null;

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
    } catch {}
  }
  return "";
}

export function setUserId(id) {
  if (!id) return;
  cachedUserId = id;
  if (typeof window !== "undefined") {
    window.USER_ID = id;
    try {
      localStorage.setItem("userId", id);
    } catch {}
  }
}

export function AUTH_HEADERS(extra = {}) {
  const headers = { ...extra };
  const uid = resolveStoredUserId();
  if (uid) headers["x-user-id"] = uid;
  const csrf = resolveCsrf();
  if (csrf) headers[CSRF_HEADER] = csrf;
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
