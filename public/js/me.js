import { AUTH_HEADERS, apiFetch, ensureCsrfToken, setUserId } from "./config.js";

const $ = (sel) => document.querySelector(sel);

let diaryMap = new Map();
let pendingRequests = [];
let friendList = [];
const avatarSvgs = [
  `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32 8L38 10L40 16L38 54L32 56L26 54L24 16L26 10Z" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="26" y="4" width="12" height="6" rx="1" stroke="#111" stroke-width="2" fill="none"/><line x1="26" y1="7" x2="38" y2="7" stroke="#111" stroke-width="1.5"/><path d="M28 54L32 60L36 54" fill="#111" stroke="#111" stroke-width="2" stroke-linejoin="round"/><line x1="24" y1="20" x2="24" y2="48" stroke="#111" stroke-width="2"/><line x1="40" y1="20" x2="40" y2="48" stroke="#111" stroke-width="2"/></svg>`,
  `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="28" y="8" width="8" height="48" rx="1" stroke="#111" stroke-width="2.5"/><rect x="28" y="8" width="8" height="12" rx="1" stroke="#111" stroke-width="2.5" fill="none"/><path d="M36 8C38 8 40 10 40 12C40 14 40 16 40 18" stroke="#111" stroke-width="2" stroke-linecap="round"/><circle cx="40" cy="18" r="1.5" fill="#111"/><line x1="28" y1="24" x2="36" y2="24" stroke="#111" stroke-width="1.5"/><line x1="28" y1="28" x2="36" y2="28" stroke="#111" stroke-width="1.5"/><line x1="28" y1="32" x2="36" y2="32" stroke="#111" stroke-width="1.5"/><path d="M28 56L30 60L32 62L34 60L36 56" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/><line x1="32" y1="60" x2="32" y2="62" stroke="#111" stroke-width="2"/></svg>`,
  `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="28" y="4" width="8" height="14" rx="1" stroke="#111" stroke-width="2.5" fill="none"/><path d="M36 6C38 6 40 7 40 9C40 11 40 14 40 16" stroke="#111" stroke-width="2" stroke-linecap="round"/><circle cx="40" cy="16" r="1.5" fill="#111"/><rect x="29" y="18" width="6" height="30" rx="1" stroke="#111" stroke-width="2.5"/><rect x="30" y="22" width="4" height="10" stroke="#111" stroke-width="1.5" fill="none"/><line x1="30" y1="26" x2="34" y2="26" stroke="#111" stroke-width="1"/><path d="M29 48L28 52L30 58L32 60L34 58L36 52L35 48Z" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/><line x1="32" y1="52" x2="32" y2="60" stroke="#111" stroke-width="1.5"/><circle cx="32" cy="54" r="1" fill="#111"/></svg>`
];

function defaultAvatar(seed = "user") {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const idx = hash % avatarSvgs.length;
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvgs[idx])}`;
}

function formatAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

const els = {
  avatarImg: $("#avatarImg"),
  avatarBtn: $("#avatarBtn"),
  avatarInput: $("#avatarInput"),
  avatarDelBtn: $("#avatarDelBtn"),
  editBtn: $("#editProfileBtn"),
  editBackdrop: $("#edit-backdrop"),
  editNick: $("#edit-nickname"),
  editUser: $("#edit-username"),
  editBio: $("#edit-bio"),
  editCancel: $("#edit-cancel"),
  editSave: $("#edit-save"),
  nickname: $("#nickname"),
  username: $("#username"),
  bio: $("#bio"),
  diaryCount: $("#diaryCount"),
  photoCount: $("#photoCount"),
  friendCount: $("#friendCount"),
  timelineView: $("#timelineView"),
  tabList: $("#tabList"),
  tabFriends: $("#tabFriends"),
  tabAlerts: $("#tabAlerts"),
  alertBadge: $("#alertBadge"),
  requestsView: $("#requestsView"),
  friendsView: $("#friendsView"),
  viewSheet: $("#view-sheet"),
  viewerCard: $("#v-card"),
  viewerClose: $("#v-close"),
  viewerDate: $("#v-date"),
  viewerMeta: $("#v-meta"),
  viewerPhotos: $("#v-photos"),
  viewerText: $("#v-text"),
  viewerSchedulesSection: $("#v-schedules-wrap"),
  viewerSchedules: $("#v-schedules"),
};

const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let currentUser = null;

function safeJson(res) {
  return res.json().catch(() => ({}));
}

async function fetchSession() {
  const res = await apiFetch(`/api/auth/session`, { credentials: "include" });
  const data = await safeJson(res);
  if (!data?.loggedIn) throw new Error("로그인이 필요합니다.");
  setUserId(data.userId);
  return data;
}

async function fetchUser(userId) {
  const res = await apiFetch(`/api/users/${encodeURIComponent(userId)}`, { credentials: "include" });
  const data = await safeJson(res);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(data?.error || "프로필을 불러오지 못했습니다.");
  return data.user || data;
}

async function fetchTimeline(userId, limit = 15) {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}&limit=${limit}` : `?limit=${limit}`;
  const res = await apiFetch(`/api/diary/timeline${qs}`, { credentials: "include" });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "타임라인을 불러오지 못했습니다.");
  return data.items || [];
}

async function fetchDay(dateStr) {
  const res = await apiFetch(`/api/diary/day/${dateStr}`, { credentials: "include" });
  const data = await safeJson(res);
  if (res.status === 401 || res.status === 404) return { entry: null, photos: [] };
  if (!res.ok) throw new Error(data?.error || "일기를 불러오지 못했습니다.");
  return data;
}

async function fetchSchedulesDay(dateStr) {
  const res = await apiFetch(`/api/schedules/day/${dateStr}`, { credentials: "include" });
  const data = await safeJson(res);
  if (res.status === 401 || res.status === 404) return { items: [] };
  if (!res.ok) throw new Error(data?.error || "일정 조회에 실패했습니다.");
  return data;
}

async function fetchPendingRequests() {
  const res = await apiFetch(`/api/friends/pending`, { credentials: "include" });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "친구 요청을 불러오지 못했습니다.");
  return data.requests || [];
}

async function fetchFriends() {
  const res = await apiFetch(`/api/friends/list`, { credentials: "include" });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "친구 목록을 불러오지 못했습니다.");
  return data.friends || [];
}

function renderProfile(user) {
  currentUser = { ...(currentUser || {}), ...user };
  const hasCustomAvatar = !!currentUser.avatar_url;
  const avatar = hasCustomAvatar ? currentUser.avatar_url : defaultAvatar(currentUser.id || currentUser.username || "user");
  if (els.avatarImg) els.avatarImg.src = avatar;
  if (els.nickname) els.nickname.textContent = currentUser.nickname || "닉네임 없음";
  if (els.username) els.username.textContent = currentUser.username ? `@${currentUser.username}` : "";
  if (els.bio) els.bio.textContent = currentUser.bio || "소개가 없습니다.";
  if (els.avatarDelBtn) els.avatarDelBtn.style.display = hasCustomAvatar ? "grid" : "none";
}

function formatMeta(entry) {
  const parts = [];
  if (entry.photos?.length) parts.push(`${entry.photos.length}장 사진`);
  if (entry.text && entry.text.trim()) parts.push("텍스트 기록");
  return parts.join(" · ") || "기록 없음";
}

function renderTimeline(list) {
  if (!els.timelineView) return;
  if (!list.length) {
    els.timelineView.innerHTML = `<div class="empty-state">작성된 일기가 없습니다.</div>`;
    return;
  }

  const months = new Map();
  list.forEach((item) => {
    const dt = new Date(`${item.date}T00:00:00`);
    const key = `${dt.getFullYear()}-${dt.getMonth()}`;
    const label = `${dt.getFullYear()}년 ${String(dt.getMonth() + 1).padStart(2, "0")}월`;
    if (!months.has(key)) months.set(key, { label, items: [] });
    months.get(key).items.push(item);
  });

  const monthArr = Array.from(months.values());
  els.timelineView.innerHTML = "";

  monthArr.forEach((month) => {
    const box = document.createElement("div");
    box.className = "timeline-month";
    box.innerHTML = `<div class="timeline-month-title">${month.label}</div>`;
    const listEl = document.createElement("div");
    listEl.className = "timeline-items";

    month.items
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((entry) => {
        const dt = new Date(`${entry.date}T00:00:00`);
        const btn = document.createElement("button");
        btn.className = "timeline-item";
        btn.dataset.date = entry.date;
        const thumb = entry.photos?.[0] || entry.thumbnail_url || "";
        btn.innerHTML = `
          <div class="timeline-date">
            <div class="timeline-date-day">${dt.getDate()}</div>
            <div class="timeline-date-dow">${dow[dt.getDay()]}</div>
          </div>
          <div class="timeline-content">
            ${thumb ? `<img class="timeline-thumb" src="${thumb}" alt="${entry.date} 사진" />` : `<div class="timeline-thumb" style="display:grid;place-items:center;color:rgba(0,0,0,.35);font-size:12px;">No Image</div>`}
            <div class="timeline-text-preview">
              <div class="timeline-text">${(entry.text || "작성된 내용이 없습니다.").replace(/\n+/g, " ").slice(0, 140)}</div>
              <div class="timeline-meta">${formatMeta(entry)}</div>
            </div>
          </div>
        `;
        btn.addEventListener("click", () => openViewer(entry.date));
        listEl.appendChild(btn);
      });

    box.appendChild(listEl);
    els.timelineView.appendChild(box);
  });
}

function openViewer(dateStr) {
  if (!els.viewSheet) return;
  els.viewSheet.classList.add("open");
  if (els.viewerDate) els.viewerDate.textContent = dateStr;
  if (els.viewerMeta) els.viewerMeta.textContent = "";
  if (els.viewerPhotos) els.viewerPhotos.innerHTML = "";
  if (els.viewerText) {
    els.viewerText.textContent = "작성된 내용이 없어요.";
    els.viewerText.classList.add("empty");
  }
  if (els.viewerSchedules) els.viewerSchedules.innerHTML = "";
  if (els.viewerSchedulesSection) els.viewerSchedulesSection.style.display = "none";

  (async () => {
    try {
      const [diary, sched] = await Promise.all([fetchDay(dateStr), fetchSchedulesDay(dateStr)]);
      const entry = diary.entry || { text: "" };
      const photos = diary.photos || [];
      const schedItems = sched.items || [];

      if (els.viewerMeta) {
        const parts = [];
        if (photos.length) parts.push(`${photos.length}장 사진`);
        if (schedItems.length) parts.push(`${schedItems.length}건 일정`);
        els.viewerMeta.textContent = parts.length ? parts.join(" | ") : "기록 없음";
      }

      if (els.viewerPhotos) {
        photos
          .slice()
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
          .forEach((p, idx) => {
            const img = document.createElement("img");
            img.src = p.base64_data || p.image_url || p.image_data || p.url || "";
            img.alt = `${dateStr} 사진 ${idx + 1}`;
            els.viewerPhotos.appendChild(img);
          });
        if (!photos.length) {
          const empty = document.createElement("div");
          empty.className = "viewer-text empty";
          empty.textContent = "사진이 없습니다.";
          els.viewerPhotos.appendChild(empty);
        }
      }

      if (els.viewerText) {
        const hasText = entry.text && entry.text.trim();
        els.viewerText.textContent = hasText ? entry.text : "작성된 내용이 없어요.";
        els.viewerText.classList.toggle("empty", !hasText);
      }

      if (els.viewerSchedules) {
        if (schedItems.length && els.viewerSchedulesSection) {
          els.viewerSchedulesSection.style.display = "block";
        }
        schedItems.forEach((s) => {
          const li = document.createElement("li");
          li.innerHTML = `<span class="time">${(s.start_at || "").slice(11, 16)}</span><span class="title">${s.title || ""}</span>`;
          els.viewerSchedules.appendChild(li);
        });
      }
    } catch (err) {
      console.error("viewer load failed", err);
    }
  })();
}

function closeViewer() {
  if (els.viewSheet) els.viewSheet.classList.remove("open");
}

function bindViewer() {
  els.viewerClose?.addEventListener("click", closeViewer);
  els.viewSheet?.addEventListener("click", (e) => {
    if (e.target === els.viewSheet) closeViewer();
  });
}

function renderRequests(list) {
  pendingRequests = list;
  if (!els.requestsView) return;
  if (!list.length) {
    els.requestsView.innerHTML = `<div class="empty-state">새 친구 요청이 없습니다.</div>`;
  } else {
    els.requestsView.innerHTML = "";
    list.forEach((r) => {
      const avatar = r.avatar_url || defaultAvatar(r.id || r.username || "user");
      const card = document.createElement("div");
      card.className = "request-card";
      card.innerHTML = `
        <img class="avatar-small" src="${avatar}" alt="${r.nickname || r.username}" />
        <div style="flex:1; min-width:0;">
          <div class="timeline-text" style="font-weight:700; margin-bottom:2px;">${r.nickname || r.username || "사용자"}</div>
          <div class="timeline-meta">@${r.username || ""}</div>
          <div class="request-meta">${formatAgo(r.created_at)}</div>
          <div class="request-actions">
            <button class="pill-btn primary accept-btn" data-id="${r.id}">수락</button>
            <button class="pill-btn reject-btn" data-id="${r.id}">거절</button>
          </div>
        </div>
      `;
      els.requestsView.appendChild(card);
    });
  }
  if (els.alertBadge) {
    if (list.length) {
      els.alertBadge.style.display = "inline-block";
      els.alertBadge.textContent = String(list.length);
    } else {
      els.alertBadge.style.display = "none";
    }
  }

  els.requestsView.querySelectorAll(".accept-btn").forEach((btn) => {
    btn.addEventListener("click", () => respondFriend(btn.dataset.id, "accept"));
  });
  els.requestsView.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", () => respondFriend(btn.dataset.id, "reject"));
  });
}

function renderFriends(list) {
  friendList = list;
  if (els.friendCount) els.friendCount.textContent = String(list.length);
  if (!els.friendsView) return;
  if (!list.length) {
    els.friendsView.innerHTML = `<div class="empty-state">친구가 없습니다.</div>`;
    return;
  }
  els.friendsView.innerHTML = "";
  list.forEach((f) => {
    const avatar = f.avatar_url || defaultAvatar(f.id || f.username || "user");
    const row = document.createElement("div");
    row.className = "friend-row";
    row.innerHTML = `
      <a class="timeline-content" style="align-items:center; gap:12px; text-decoration:none; color:inherit; flex:1; padding:0;" href="/otherprofile.html?id=${encodeURIComponent(f.id)}&username=${encodeURIComponent(f.username)}">
        <img class="avatar-small" src="${avatar}" alt="${f.nickname || f.username}" />
        <div class="friend-info">
          <p class="friend-name">${f.nickname || f.username || "사용자"}</p>
          <p class="friend-handle">@${f.username || ""}</p>
        </div>
      </a>
      <button class="icon-btn friend-del" data-id="${f.id}" aria-label="친구 삭제">
        <svg class="trash-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    `;
    els.friendsView.appendChild(row);
  });

  els.friendsView.querySelectorAll(".friend-del").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      if (!confirm("이 친구를 삭제할까요?")) return;
      deleteFriend(id);
    });
  });
}

async function respondFriend(fromUserId, action) {
  try {
    const token = await ensureCsrfToken();
    const res = await apiFetch(`/api/friends/respond`, {
      method: "POST",
      credentials: "include",
      headers: AUTH_HEADERS({
        "Content-Type": "application/json",
        "CSRF-Token": token,
      }),
      body: JSON.stringify({ fromUserId, action }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "처리에 실패했습니다.");
    const next = pendingRequests.filter((p) => p.id !== fromUserId);
    renderRequests(next);
  } catch (err) {
    alert(err.message || "처리에 실패했습니다.");
  }
}

async function deleteFriend(friendId) {
  try {
    const token = await ensureCsrfToken();
    const res = await apiFetch(`/api/friends/delete`, {
      method: "POST",
      credentials: "include",
      headers: AUTH_HEADERS({
        "Content-Type": "application/json",
        "CSRF-Token": token,
      }),
      body: JSON.stringify({ friendId }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.error || "삭제에 실패했습니다.");
    const next = friendList.filter((f) => f.id !== friendId);
    renderFriends(next);
  } catch (err) {
    alert(err.message || "삭제에 실패했습니다.");
  }
}

function bindTabs() {
  if (els.tabList && els.tabFriends) {
    els.tabList.addEventListener("click", () => {
      els.tabList.classList.add("active");
      els.tabFriends.classList.remove("active");
      els.tabAlerts?.classList.remove("active");
      if (els.friendsView) els.friendsView.style.display = "none";
      if (els.timelineView) els.timelineView.style.display = "flex";
      if (els.requestsView) els.requestsView.style.display = "none";
    });
    els.tabFriends.addEventListener("click", () => {
      els.tabFriends.classList.add("active");
      els.tabList.classList.remove("active");
      els.tabAlerts?.classList.remove("active");
      if (els.timelineView) els.timelineView.style.display = "none";
      if (els.friendsView) els.friendsView.style.display = "flex";
      if (els.requestsView) els.requestsView.style.display = "none";
    });
    els.tabAlerts?.addEventListener("click", () => {
      els.tabAlerts.classList.add("active");
      els.tabList.classList.remove("active");
      els.tabFriends.classList.remove("active");
      if (els.friendsView) els.friendsView.style.display = "none";
      if (els.timelineView) els.timelineView.style.display = "none";
      if (els.requestsView) els.requestsView.style.display = "flex";
    });
  }
}

function bindAvatarUpload() {
  if (!els.avatarBtn || !els.avatarInput) return;
  els.avatarBtn.addEventListener("click", () => els.avatarInput.click());
  els.avatarInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadAvatar(file);
    } catch (err) {
      alert(err.message || "업로드에 실패했습니다.");
    } finally {
      els.avatarInput.value = "";
    }
  });
}

async function uploadAvatar(file) {
  const token = await ensureCsrfToken();
  const fd = new FormData();
  fd.append("file", file);
  fd.append("avatar", file);
  const res = await apiFetch(`/api/users/me/avatar`, {
    method: "POST",
    credentials: "include",
    headers: AUTH_HEADERS({ "CSRF-Token": token }),
    body: fd,
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "업로드에 실패했습니다.");
  if (data.avatar_url) {
    currentUser = { ...(currentUser || {}), avatar_url: data.avatar_url };
    if (els.avatarImg) els.avatarImg.src = data.avatar_url;
    if (els.avatarDelBtn) els.avatarDelBtn.style.display = "grid";
  }
}

function bindAvatarDelete() {
  if (!els.avatarDelBtn) return;
  els.avatarDelBtn.addEventListener("click", async () => {
    if (!currentUser?.avatar_url) {
      alert("기본 프로필은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm("프로필 사진을 삭제할까요?")) return;
    try {
      await deleteAvatar();
    } catch (err) {
      alert(err.message || "삭제에 실패했습니다.");
    }
  });
}

async function deleteAvatar() {
  const token = await ensureCsrfToken();
  const res = await apiFetch(`/api/users/me/avatar`, {
    method: "DELETE",
    credentials: "include",
    headers: AUTH_HEADERS({ "CSRF-Token": token }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "삭제에 실패했습니다.");
  currentUser = { ...(currentUser || {}), avatar_url: null };
  const fallback = defaultAvatar(currentUser.id || currentUser.username || "user");
  if (els.avatarImg) els.avatarImg.src = fallback;
  if (els.avatarDelBtn) els.avatarDelBtn.style.display = "none";
}

function bindEditModal() {
  if (!els.editBtn || !els.editBackdrop) return;
  const open = () => {
    if (els.editNick) els.editNick.value = currentUser?.nickname || "";
    if (els.editUser) els.editUser.value = currentUser?.username || "";
    if (els.editBio) els.editBio.value = currentUser?.bio || "";
    els.editBackdrop.classList.add("open");
  };
  const close = () => els.editBackdrop.classList.remove("open");
  els.editBtn.addEventListener("click", open);
  els.editCancel?.addEventListener("click", close);
  els.editBackdrop.addEventListener("click", (e) => {
    if (e.target === els.editBackdrop) close();
  });
  els.editSave?.addEventListener("click", async () => {
    const nickname = (els.editNick?.value || "").trim();
    const bio = (els.editBio?.value || "").trim();
    if (!nickname) return alert("닉네임을 입력해주세요.");
    try {
      const token = await ensureCsrfToken();
      const res = await apiFetch(`/api/users/me`, {
        method: "PATCH",
        credentials: "include",
        headers: AUTH_HEADERS({
          "Content-Type": "application/json",
          "CSRF-Token": token,
        }),
        body: JSON.stringify({ nickname, bio }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || "저장에 실패했습니다.");
      currentUser = { ...(currentUser || {}), nickname: data.nickname || nickname, bio: data.bio ?? bio };
      renderProfile(currentUser);
      close();
    } catch (err) {
      alert(err.message || "저장에 실패했습니다.");
    }
  });
}

async function loadDiaries(userId) {
  diaryMap = new Map();
  let timelineItems = [];
  try {
    timelineItems = await fetchTimeline(userId, 15);
    timelineItems.forEach((item) => {
      const photos = [];
      if (item.thumbnail_url) photos.push(item.thumbnail_url);
      diaryMap.set(item.date, {
        date: item.date,
        text: item.text_preview || "",
        photos,
      });
    });
  } catch (err) {
    console.warn("타임라인 로드 실패:", err);
  }

  const list = Array.from(diaryMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  const photoCount = (timelineItems || []).reduce((acc, cur) => acc + (cur.photo_count || 0), 0);

  if (els.diaryCount) els.diaryCount.textContent = String(list.length);
  if (els.photoCount) els.photoCount.textContent = String(photoCount);

  renderTimeline(list);
}

(async function init() {
  try {
    const session = await fetchSession();
    const user = await fetchUser(session.userId);
    renderProfile(
      user || {
        avatar_url: null,
        nickname: session.nickname || "닉네임 없음",
        username: session.username || "",
        bio: "소개가 없습니다.",
      }
    );
    bindTabs();
    bindViewer();
    bindAvatarUpload();
    bindAvatarDelete();
    bindEditModal();
    await loadDiaries(session.userId);
    const reqs = await fetchPendingRequests();
    renderRequests(reqs);
    const friends = await fetchFriends();
    renderFriends(friends);
  } catch (err) {
    console.error(err);
    alert(err.message || "로그인을 불러오지 못했습니다.");
    if (String(err.message || "").includes("로그인")) {
      location.replace("/login.html");
    }
  }
})();
