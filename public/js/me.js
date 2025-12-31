import { API_BASE, AUTH_HEADERS, apiFetch, ensureCsrfToken, setUserId } from "./config.js";

const $ = (sel) => document.querySelector(sel);

let diaryMap = new Map();

const els = {
  avatarImg: $("#avatarImg"),
  avatarBtn: $("#avatarBtn"),
  avatarInput: $("#avatarInput"),
  nickname: $("#nickname"),
  username: $("#username"),
  bio: $("#bio"),
  diaryCount: $("#diaryCount"),
  photoCount: $("#photoCount"),
  friendCount: $("#friendCount"),
  timelineView: $("#timelineView"),
  calendarView: $("#calendarView"),
  tabList: $("#tabList"),
  tabCalendar: $("#tabCalendar"),
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
let pendingRequests = [];
let friendList = [];

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

async function fetchPhotoDiaries(userId, limit = 120) {
  try {
    const res = await apiFetch(`/api/diary/${encodeURIComponent(userId)}/photos?limit=${limit}`, { credentials: "include" });
    const data = await safeJson(res);
    if (res.status === 401 || res.status === 404) return [];
    if (!res.ok) throw new Error(data?.error || "사진 목록을 불러오지 못했습니다.");
    return data.items || [];
  } catch (err) {
    console.warn("photo diary list fallback", err?.message || err);
    return [];
  }
}

async function fetchOverview(year, month) {
  const res = await apiFetch(`/api/calendar/overview?year=${year}&month=${month}`, { credentials: "include" });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "달력 데이터를 불러오지 못했습니다.");
  return data.days || [];
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
  if (els.avatarImg) els.avatarImg.src = user.avatar_url || "/image/avatar-default.png";
  if (els.nickname) els.nickname.textContent = user.nickname || "닉네임 없음";
  if (els.username) els.username.textContent = user.username ? `@${user.username}` : "";
  if (els.bio) els.bio.textContent = user.bio || "소개가 없습니다.";
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
        btn.innerHTML = `
          <div class="timeline-date">
            <div class="timeline-date-day">${dt.getDate()}</div>
            <div class="timeline-date-dow">${dow[dt.getDay()]}</div>
          </div>
          <div class="timeline-content">
            ${entry.photos?.[0] ? `<img class="timeline-thumb" src="${entry.photos[0]}" alt="${entry.date} 사진" />` : `<div class="timeline-thumb" style="display:grid;place-items:center;color:rgba(0,0,0,.35);font-size:12px;">No Image</div>`}
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
      const card = document.createElement("div");
      card.className = "timeline-item";
      card.innerHTML = `
        <div class="timeline-content" style="align-items:center; gap:12px;">
          <img class="timeline-thumb" src="${r.avatar_url || "/image/avatar-default.png"}" alt="${r.nickname || r.username}" />
          <div class="timeline-text-preview">
            <div class="timeline-text" style="font-weight:700;">${r.nickname || r.username || "사용자"}</div>
            <div class="timeline-meta">@${r.username || ""}</div>
            <div class="timeline-meta" style="margin-top:6px;">친구 요청을 보냈습니다.</div>
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="btn accept-btn" data-id="${r.id}" style="flex:1; background:#111; color:#fff; border:1px solid rgba(0,0,0,.2);">수락</button>
              <button class="btn ghost reject-btn" data-id="${r.id}" style="flex:1; background:#fff; color:#111; border:1px solid rgba(0,0,0,.2);">거절</button>
            </div>
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
    const a = document.createElement("a");
    a.className = "timeline-item";
    a.href = `/otherprofile.html?id=${encodeURIComponent(f.id)}&username=${encodeURIComponent(f.username)}`;
    a.innerHTML = `
      <div class="timeline-content" style="align-items:center; gap:12px;">
        <img class="timeline-thumb" src="${f.avatar_url || "/image/avatar-default.png"}" alt="${f.nickname || f.username}" />
        <div class="timeline-text-preview">
          <div class="timeline-text" style="font-weight:700;">${f.nickname || f.username || "사용자"}</div>
          <div class="timeline-meta">@${f.username || ""}</div>
        </div>
      </div>
    `;
    els.friendsView.appendChild(a);
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

function bindTabs() {
  if (els.tabList && els.tabCalendar) {
    els.tabList.addEventListener("click", () => {
      els.tabList.classList.add("active");
      els.tabCalendar.classList.remove("active");
      els.tabAlerts?.classList.remove("active");
      if (els.friendsView) els.friendsView.style.display = "none";
      if (els.timelineView) els.timelineView.style.display = "flex";
      if (els.calendarView) els.calendarView.style.display = "none";
      if (els.requestsView) els.requestsView.style.display = "none";
    });
    els.tabCalendar.addEventListener("click", () => {
      els.tabCalendar.classList.add("active");
      els.tabList.classList.remove("active");
      els.tabAlerts?.classList.remove("active");
      if (els.friendsView) els.friendsView.style.display = "none";
      if (els.timelineView) els.timelineView.style.display = "none";
      if (els.calendarView) els.calendarView.style.display = "block";
      if (els.requestsView) els.requestsView.style.display = "none";
    });
    els.tabAlerts?.addEventListener("click", () => {
      els.tabAlerts.classList.add("active");
      els.tabList.classList.remove("active");
      els.tabCalendar.classList.remove("active");
      if (els.friendsView) els.friendsView.style.display = "flex";
      if (els.timelineView) els.timelineView.style.display = "none";
      if (els.calendarView) els.calendarView.style.display = "none";
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
  if (els.avatarImg && data.avatar_url) els.avatarImg.src = data.avatar_url;
}

async function collectDiaryDates() {
  const dates = new Set();
  const now = new Date();
  const targets = [0, -1, -2].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  for (const { y, m } of targets) {
    const days = await fetchOverview(y, m);
    (days || [])
      .filter((d) => d.hasDiary || d.diaryThumb || d.diaryCount)
      .forEach((d) => dates.add(d.date));
  }
  return dates;
}

async function loadDiaries(userId) {
  diaryMap = new Map();

  try {
    const candidateDates = new Set();

    const photoRows = await fetchPhotoDiaries(userId, 180);
    photoRows.forEach((row) => {
      const date = String(row.date || "").slice(0, 10);
      if (!date) return;
      candidateDates.add(date);
      const found = diaryMap.get(date) || { date, text: "", photos: [] };
      if (!found.text && row.text) found.text = row.text;
      const img = row.image_data || row.image_url;
      if (img) found.photos.push(img);
      diaryMap.set(date, found);
    });

    const overviewDates = await collectDiaryDates();
    overviewDates.forEach((d) => candidateDates.add(d));

  if (!candidateDates.size) {
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      candidateDates.add(dateStr);
    }
  }

  // 가장 최근 날짜부터 최대 60일치만 병렬(적은 동시성)로 불러온다.
  const datesToFetch = Array.from(candidateDates)
    .sort()
    .reverse()
    .filter((date) => !(diaryMap.has(date) && diaryMap.get(date).text))
    .slice(0, 60);

  const chunkSize = 5;
  for (let i = 0; i < datesToFetch.length; i += chunkSize) {
    const chunk = datesToFetch.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (date) => {
        try {
          const data = await fetchDay(date);
          if (data?.entry || (data?.photos || []).length) {
            const photos = (data.photos || []).map((p) => p.base64_data || p.image_data || p.image_url || p.url).filter(Boolean);
            diaryMap.set(date, { date, text: data.entry?.text || "", photos });
          }
        } catch (err) {
          console.warn("일기 로드 실패:", date, err);
        }
      })
    );
  }
  } catch (err) {
    console.warn("다이어리 로드 실패:", err);
  }

  const list = Array.from(diaryMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  const photoCount = list.reduce((acc, cur) => acc + (cur.photos?.length || 0), 0);

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
