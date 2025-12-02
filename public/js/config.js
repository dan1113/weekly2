const runtime = typeof window !== "undefined" ? window : undefined;

// ✅ 명시적으로 설정: Cloudflare Pages에서 실행 시 워커 도메인으로 보냄
const rawBase =
  (runtime && runtime.API_BASE) ||
  (location.hostname.includes("localhost")
    ? "http://localhost:8787"
    : "https://weeklydiary.store");

export const API_BASE = rawBase.endsWith("/")
  ? rawBase.slice(0, -1)
  : rawBase;

let cachedUserId =
  (typeof window !== "undefined" && window.__USER_ID__) || null;

function resolveStoredUserId() {
  if (cachedUserId) return cachedUserId;
  if (typeof window !== "undefined") {
    if (window.__USER_ID__) {
      cachedUserId = window.__USER_ID__;
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

export function setUserId(id) {
  if (!id) return;
  cachedUserId = id;
  if (typeof window !== "undefined") {
    window.__USER_ID__ = id;
    try {
      localStorage.setItem("userId", id);
    } catch (err) {
      console.warn("unable to persist userId", err);
    }
  }
}

/**
 * 🔥 [수정됨] 사용자 ID와 CSRF 토큰을 모두 포함하는 헤더를 반환합니다.
 */
export function AUTH_HEADERS(extra = {}) {
  const headers = { ...extra };
  
  // 1. 사용자 ID 추가 (기존 로직 유지)
  const uid = resolveStoredUserId();
  if (uid) headers["x-user-id"] = uid;
  
  // 2. ⚡️ CSRF 토큰 추가 (403 Forbidden 해결을 위한 핵심 수정)
  // calendar.html에 <meta name="csrf-token" content="..." /> 이 있어야 합니다.
  if (typeof document !== 'undefined') {
    const tokenMeta = document.querySelector('meta[name="csrf-token"]');
    if (tokenMeta && tokenMeta.content) {
      headers['X-CSRF-Token'] = tokenMeta.content;
    }
  }
  
  return headers;
}

export function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  // AUTH_HEADERS 호출 시 options.headers를 인수로 넘겨서
  // custom headers를 덮어쓰지 않고 추가하도록 수정했습니다.
  const mergedHeaders = AUTH_HEADERS(options.headers);
  
  return fetch(url, {
    credentials: "include",
    ...options,
    headers: mergedHeaders,
  });
}