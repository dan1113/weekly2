// /public/js/me.js
import { apiFetch } from "./config.js";

const $ = (sel) => document.querySelector(sel);

// ───────────── utils ─────────────
async function safeJson(res) { try { return await res.json(); } catch { return {}; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getSessionStable() {
  try {
    let r = await apiFetch("/api/auth/session", { credentials: "include" });
    let j = await safeJson(r);
    if (j && (j.loggedIn === true || j.loggedIn === false)) return j;
    await sleep(150);
    r = await apiFetch("/api/auth/session", { credentials: "include" });
    j = await safeJson(r);
    return j || null;
  } catch {
    return null;
  }
}

function renderText(sel, text) {
  const el = $(sel);
  if (el) el.textContent = text;
}

function setSrc(sel, url) {
  const el = $(sel);
  if (el) el.src = url;
}

// ───────────── bootstrap ─────────────
document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    // 1) 세션 확인
    const sess = await getSessionStable();

    if (sess && sess.loggedIn === false) {
      // 명확히 비로그인일 때만 로그인 페이지로
      location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
      return;
    }
    if (!sess || !sess.loggedIn) {
      // 일시 네트워크/지연이면 화면만 남기고 종료(루프 방지)
      console.warn("session unavailable; avoid redirect loop");
      return;
    }

    // 2) 내 프로필 정보: /api/me 우선
    let meRes = await apiFetch("/api/me", { credentials: "include" });
    if (meRes.status === 401) {
      location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
      return;
    }

    // 백엔드에 /api/me 없을 수도 있으니 폴백
    let meData = await safeJson(meRes);
    if (!meRes.ok || !meData?.user) {
      // 폴백: /api/users/:id
      if (!sess.userId) {
        console.error("No userId in session; cannot fallback to /api/users/:id");
        renderText("#nickname", "(닉네임 없음)");
        renderText("#username", "@");
        return;
      }
      const fbRes = await apiFetch(`/api/users/${encodeURIComponent(sess.userId)}`, { credentials: "include" });
      if (!fbRes.ok) {
        const fbJson = await safeJson(fbRes);
        alert(fbJson?.error || "프로필 정보를 불러오지 못했습니다.");
        return;
      }
      meData = await safeJson(fbRes);
    }

    const user = meData.user || {};
    // 3) 렌더
    setSrc("#avatar", user.avatar_url || "/image/logoblack.svg");
    renderText("#nickname", user.nickname || "(닉네임 없음)");
    renderText("#username", "@" + (user.username || ""));
    renderText("#bioText", user.bio || "소개가 없습니다.");

    // 4) 편집 버튼
    const editBtn = document.getElementById("editBtn");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        location.href = "/profile-edit.html";
      });
    }

    // 5) 미니 갤러리 (있으면 표시, 없어도 조용히 패스)
    try {
      const uid = user.id || sess.userId;
      if (uid) {
        // 최근 업로드 이미지 목록 (Worker: /api/images/recent)
        const photoRes = await apiFetch(`/api/images/recent?limit=60`, {
          credentials: "include",
        });
        const photoJson = await safeJson(photoRes);
        const wrap = $("#gallery");
        if (wrap) {
          wrap.innerHTML = "";
          (photoJson.items || []).forEach((p) => {
            const img = document.createElement("img");
            img.src = p.image_url;
            img.alt = p.date || "photo";
            wrap.appendChild(img);
          });
        }
      }
    } catch (err) {
      console.warn("mini gallery failed", err);
    }
  } catch (err) {
    console.error("me.js failed", err);
    // 네트워크 오류 등에서 즉시 리다이렉트하지 않음(루프 방지)
  }
}
