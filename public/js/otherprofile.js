import { AUTH_HEADERS, apiFetch, ensureCsrfToken } from "./config.js";

const $ = (sel) => document.querySelector(sel);

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
  renderGallery(user.id);
  renderTimeline(user.id);
  setupFriendButtons(me, relation, id);
})();

function renderProfile(user) {
  $("#avatar").src = user.avatar_url || "/image/avatar-default.png";
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
