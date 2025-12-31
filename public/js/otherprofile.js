import { AUTH_HEADERS, apiFetch, ensureCsrfToken } from "./config.js";

const $ = (sel) => document.querySelector(sel);

const avatarSvgs = [
  `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32 8L38 10L40 16L38 54L32 56L26 54L24 16L26 10Z" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="26" y="4" width="12" height="6" rx="1" stroke="#111" stroke-width="2" fill="none"/><line x1="26" y1="7" x2="38" y2="7" stroke="#111" stroke-width="1.5"/><path d="M28 54L32 60L36 54" fill="#111" stroke="#111" stroke-width="2" stroke-linejoin="round"/><line x1="24" y1="20" x2="24" y2="48" stroke="#111" stroke-width="2"/><line x1="40" y1="20" x2="40" y2="48" stroke="#111" stroke-width="2"/></svg>`,
  `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="28" y="8" width="8" height="48" rx="1" stroke="#111" stroke-width="2.5"/><rect x="28" y="8" width="8" height="12" rx="1" stroke="#111" stroke-width="2.5" fill="none"/><path d="M36 8C38 8 40 10 40 12C40 14 40 16 40 18" stroke="#111" stroke-width="2" stroke-linecap="round"/><circle cx="40" cy="18" r="1.5" fill="#111"/><line x1="28" y1="24" x2="36" y2="24" stroke="#111" stroke-width="1.5"/><line x1="28" y1="28" x2="36" y2="28" stroke="#111" stroke-width="1.5"/><line x1="28" y1="32" x2="36" y2="32" stroke="#111" stroke-width="1.5"/><path d="M28 56L30 60L32 62L34 60L36 56" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/><line x1="32" y1="60" x2="32" y2="62" stroke="#111" stroke-width="2"/></svg>`,
  `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="28" y="4" width="8" height="14" rx="1" stroke="#111" stroke-width="2.5" fill="none"/><path d="M36 6C38 6 40 7 40 9C40 11 40 14 40 16" stroke="#111" stroke-width="2" stroke-linecap="round"/><circle cx="40" cy="16" r="1.5" fill="#111"/><rect x="29" y="18" width="6" height="30" rx="1" stroke="#111" stroke-width="2.5"/><rect x="30" y="22" width="4" height="10" stroke="#111" stroke-width="1.5" fill="none"/><line x1="30" y1="26" x2="34" y2="26" stroke="#111" stroke-width="1"/><path d="M29 48L28 52L30 58L32 60L34 58L36 52L35 48Z" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/><line x1="32" y1="52" x2="32" y2="60" stroke="#111" stroke-width="1.5"/><circle cx="32" cy="54" r="1" fill="#111"/></svg>`,
  `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="26" y="4" width="12" height="10" rx="2" stroke="#111" stroke-width="2.5" fill="none"/><line x1="28" y1="9" x2="36" y2="9" stroke="#111" stroke-width="1.5"/><rect x="27" y="14" width="10" height="36" rx="2" stroke="#111" stroke-width="2.5"/><line x1="27" y1="20" x2="37" y2="20" stroke="#111" stroke-width="2"/><line x1="27" y1="24" x2="37" y2="24" stroke="#111" stroke-width="2"/><circle cx="32" cy="32" r="4" stroke="#111" stroke-width="2"/><line x1="30" y1="32" x2="34" y2="32" stroke="#111" stroke-width="1.5"/><path d="M27 50L27 54L29 58L32 60L35 58L37 54L37 50Z" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/><rect x="29" y="54" width="6" height="4" fill="#111"/></svg>`
];
function defaultAvatar(seed = "user") {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const idx = hash % avatarSvgs.length;
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvgs[idx])}`;
}

function safeJson(res) {
  return res.json().catch(() => ({}));
}

async function getSession() {
  const res = await apiFetch(`/api/auth/session`, { credentials: "include" });
  const data = await safeJson(res);
  return data;
}

async function postJson(path, payload) {
  const token = await ensureCsrfToken();
  const res = await apiFetch(`${path}`, {
    method: "POST",
    credentials: "include",
    headers: AUTH_HEADERS({
      "Content-Type": "application/json",
      "CSRF-Token": token,
    }),
    body: JSON.stringify(payload),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || "요청 처리에 실패했습니다.");
  return data;
}

(async () => {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) {
    alert("유효하지 않은 사용자입니다.");
    history.back();
    return;
  }

  const me = await getSession();
  if (!me?.loggedIn) {
    location.replace("/login.html");
    return;
  }
  if (me.userId === id) {
    location.replace("/me.html");
    return;
  }

  const userRes = await apiFetch(`/api/users/${encodeURIComponent(id)}`);
  if (!userRes.ok) {
    alert("존재하지 않는 사용자입니다.");
    history.back();
    return;
  }
  const { user, relation } = await safeJson(userRes);
  renderProfile(user);
  const isFriend = relation?.status === "accepted";
  if (isFriend || me.userId === id) {
    renderGallery(user.id);
    renderTimeline(user.id);
  } else {
    const gallery = $("#gallery");
    const tl = $("#timeline");
    if (gallery) gallery.innerHTML = `<div class="viewer-text empty">친구만 볼 수 있습니다.</div>`;
    if (tl) tl.innerHTML = `<div class="viewer-text empty">친구만 볼 수 있습니다.</div>`;
  }
  setupFriendButtons(me, relation, id);
})();

function renderProfile(user) {
  const avatar = user.avatar_url || defaultAvatar(user.id || user.username || "user");
  $("#avatar").src = avatar;
  $("#nickname").textContent = user.nickname || "(닉네임 없음)";
  $("#username").textContent = "@" + user.username;
  $("#bioText").textContent = user.bio || "소개가 없습니다.";
}

async function renderGallery(userId) {
  try {
    const res = await apiFetch(`/api/diary/${encodeURIComponent(userId)}/photos?limit=120`);
    const data = await safeJson(res);
    const wrap = $("#gallery");
    wrap.innerHTML = "";
    const items = data.items || [];
    const dates = new Set();
    items.forEach((p) => {
      const img = document.createElement("img");
      img.src = p.image_url || p.image_data;
      img.alt = p.date || "photo";
      wrap.appendChild(img);
      if (p.date) dates.add(String(p.date).slice(0, 10));
    });
    $("#statPhoto").textContent = String(items.length);
    $("#statDiary").textContent = String(dates.size || items.length);
  } catch (err) {
    console.warn("gallery load failed", err);
  }
}

async function renderTimeline(userId) {
  try {
    const res = await apiFetch(`/api/diary/${encodeURIComponent(userId)}/photos?limit=60`);
    const data = await safeJson(res);
    const wrap = $("#timeline");
    if (!wrap) return;
    wrap.innerHTML = "";
    const items = data.items || [];
    if (!items.length) {
      wrap.innerHTML = `<div class="viewer-text empty">작성된 일기가 없습니다.</div>`;
      return;
    }
    // 날짜별 그룹화
    const map = new Map();
    items.forEach((p) => {
      const date = String(p.date || "").slice(0, 10);
      if (!date) return;
      if (!map.has(date)) map.set(date, []);
      map.get(date).push(p);
    });
    const dates = Array.from(map.keys()).sort().reverse();
    dates.forEach((d) => {
      const entry = map.get(d);
      const first = entry[0];
      const img = first.image_url || first.image_data || "";
      const card = document.createElement("div");
      card.style.border = "1px solid rgba(0,0,0,.12)";
      card.style.borderRadius = "12px";
      card.style.padding = "10px";
      card.style.background = "#fff";
      card.innerHTML = `
        <div style="display:flex; gap:10px; align-items:center;">
          <div style="font-weight:700;">${d}</div>
          <div style="color:rgba(0,0,0,.55); font-size:12px;">${entry.length}장</div>
        </div>
        ${img ? `<img src="${img}" alt="${d}" style="width:100%; margin-top:8px; border-radius:10px; object-fit:cover;">` : ""}
      `;
      wrap.appendChild(card);
    });
  } catch (err) {
    console.warn("timeline load failed", err);
  }
}

function setupFriendButtons(me, relation, id) {
  const addBtn = $("#addBtn");
  const acceptBtn = $("#acceptBtn");
  const rejectBtn = $("#rejectBtn");
  const deleteBtn = $("#deleteBtn");

  const show = (...targets) => {
    [addBtn, acceptBtn, rejectBtn, deleteBtn].forEach((btn) => {
      if (!btn) return;
      btn.style.display = targets.includes(btn) ? "inline-block" : "none";
    });
  };

  if (!relation) {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = "친구 신청";
    }
    show(addBtn);
  } else if (relation.status === "accepted") {
    if (deleteBtn) deleteBtn.style.display = "inline-block";
    show(deleteBtn);
  } else if (relation.status === "pending") {
    const iAmRequester = relation.requester_id === me?.userId;
    if (iAmRequester) {
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = "대기 중";
      }
      show(addBtn);
    } else {
      show(acceptBtn, rejectBtn);
    }
  } else {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = "친구 신청";
    }
    show(addBtn);
  }

  addBtn?.addEventListener("click", async () => {
    try {
      await postJson("/api/friends/request", { toUserId: id });
      addBtn.disabled = true;
      addBtn.textContent = "대기 중";
    } catch (err) {
      alert(err.message || "요청 처리에 실패했습니다.");
    }
  });

  acceptBtn?.addEventListener("click", async () => {
    try {
      await postJson("/api/friends/respond", { fromUserId: id, action: "accept" });
      location.reload();
    } catch (err) {
      alert(err.message || "승인에 실패했습니다.");
    }
  });

  rejectBtn?.addEventListener("click", async () => {
    try {
      await postJson("/api/friends/respond", { fromUserId: id, action: "reject" });
      location.reload();
    } catch (err) {
      alert(err.message || "거절에 실패했습니다.");
    }
  });

  deleteBtn?.addEventListener("click", async () => {
    if (!confirm("친구를 삭제하시겠습니까?")) return;
    try {
      await postJson("/api/friends/delete", { targetUserId: id });
      location.reload();
    } catch (err) {
      alert(err.message || "삭제에 실패했습니다.");
    }
  });
}
