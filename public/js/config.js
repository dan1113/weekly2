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
  
  // 1) 메타 태그에서 확인
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta?.content) {
      cachedCsrf = meta.content;
      console.log("✅ CSRF from meta:", cachedCsrf.substring(0, 20) + "...");
      return cachedCsrf;
    }
  }
  
  // 2) 쿠키에서 확인
  if (typeof document !== "undefined") {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'xsrf-token' || name === 'XSRF-TOKEN') {
        cachedCsrf = decodeURIComponent(value);
        console.log("✅ CSRF from cookie:", cachedCsrf.substring(0, 20) + "...");
        return cachedCsrf;
      }
    }
  }
  
  // 3) window 객체에서 확인
  if (typeof window !== "undefined" && window.__CSRF_TOKEN__) {
    cachedCsrf = window.__CSRF_TOKEN__;
    console.log("✅ CSRF from window:", cachedCsrf.substring(0, 20) + "...");
    return cachedCsrf;
  }
  
  // 4) localStorage에서 확인
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("csrfToken");
      if (stored) {
        cachedCsrf = stored;
        console.log("✅ CSRF from localStorage:", cachedCsrf.substring(0, 20) + "...");
        return stored;
      }
    } catch (err) {
      console.warn("csrf storage unavailable", err);
    }
  }
  
  console.warn("⚠️ CSRF token not found");
  return "";
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

// ⭐ ensureCsrfToken 함수 - 한 번만 선언
export async function ensureCsrfToken() {
  const existing = resolveStoredCsrf();
  if (existing) {
    console.log("✅ Using existing CSRF token");
    return existing;
  }
  
  if (csrfPromise) {
    console.log("⏳ CSRF fetch already in progress...");
    return csrfPromise;
  }

  console.log("🔄 Fetching new CSRF token...");
  csrfPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/csrf`, {
        method: "GET",
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error(`CSRF fetch failed: ${res.status}`);
      }
      
      const data = await res.json();
      console.log("📥 CSRF response:", data);
      
      if (data?.csrfToken) {
        cachedCsrf = data.csrfToken;
        
        if (typeof window !== "undefined") {
          window.__CSRF_TOKEN__ = cachedCsrf;
          try {
            localStorage.setItem("csrfToken", cachedCsrf);
          } catch (err) {
            console.warn("localStorage save failed", err);
          }
        }
        
        console.log("✅ CSRF token cached:", cachedCsrf.substring(0, 20) + "...");
      }
      
      // 쿠키에서도 다시 확인 (서버가 쿠키로 설정했을 수 있음)
      setTimeout(() => {
        const fromCookie = resolveStoredCsrf();
        if (fromCookie && fromCookie !== cachedCsrf) {
          cachedCsrf = fromCookie;
          console.log("✅ CSRF updated from cookie");
        }
      }, 100);
      
      return cachedCsrf || "";
    } catch (err) {
      console.error("❌ CSRF fetch error:", err);
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
  if (uid) {
    headers["x-user-id"] = uid;
  }

  const csrf = resolveStoredCsrf();
  if (csrf) {
    headers["X-CSRF-Token"] = csrf;
    headers["CSRF-Token"] = csrf; // 백업용
  } else {
    console.warn("⚠️ No CSRF token available for request");
  }

  console.log("📤 Request headers:", { 
    hasUserId: !!uid, 
    hasCsrf: !!csrf,
    csrfPreview: csrf ? csrf.substring(0, 20) + "..." : "none"
  });

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