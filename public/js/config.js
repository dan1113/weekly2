const runtime = typeof window !== "undefined" ? window : undefined;

// Cloudflare Pages vs local
const rawBase =
  (runtime && runtime.API_BASE) ||
  "https://weeklydiary.store";

export const API_BASE = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

// CSRF: Express는 XSRF-TOKEN, Cloudflare Worker는 csrf_token을 사용한다.
const CSRF_COOKIES = ["XSRF-TOKEN", "csrf_token"];
const CSRF_HEADERS = ["X-CSRF-Token", "X-XSRF-TOKEN", "CSRF-Token"];
let cachedCsrf = null;
let csrfPromise = null;

function readCsrfCookie() {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const [k, v] = part.trim().split("=");
    if (CSRF_COOKIES.includes(k) && v !== undefined) return decodeURIComponent(v);
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
      const data = await res.json().catch(() => ({}));
      const bodyToken = data?.csrfToken;
      const headerToken = res.headers.get("x-csrf-token") || res.headers.get("X-CSRF-Token") || res.headers.get("x-xsrf-token") || res.headers.get("X-XSRF-TOKEN");
      const cookieToken = readCsrfCookie();
      const token = headerToken || bodyToken || cookieToken || "";
      if (token) {
        cachedCsrf = token;
        // 서버가 HttpOnly 쿠키로만 주는 경우 대비 클라이언트에 직접 써준다.
        try {
          if (typeof document !== "undefined") {
            const secure = location.protocol === "https:" ? "; Secure" : "";
            CSRF_COOKIES.forEach((name) => {
              document.cookie = `${name}=${encodeURIComponent(token)}; path=/; SameSite=Lax${secure}`;
            });
          }
        } catch {}
      }
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
  if (csrf) {
    CSRF_HEADERS.forEach((name) => {
      headers[name] = csrf;
    });
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
