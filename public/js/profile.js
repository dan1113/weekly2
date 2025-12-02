import { API_BASE, AUTH_HEADERS, apiFetch } from "./config.js";

const $ = (sel) => document.querySelector(sel);

async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

async function getSession() {
  const res = await apiFetch(`/api/auth/session`);
  return safeJson(res);
}

async function getCsrf() {
  try {
    const res = await apiFetch(`/api/csrf`, {
      credentials: "include",
      headers: AUTH_HEADERS(),
    });
    const data = await safeJson(res);
    if (res.ok && data?.csrfToken) return data.csrfToken;
  } catch {}
  return "dev";
}

async function postJson(path, payload) {
  const token = await getCsrf();
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
  const me = await getSession();
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) {
    alert("유효하지 않은 사용자입니다.");
    history.back();
    return;
  }
  if (me?.loggedIn && me.userId === id) {
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
    const res = await apiFetch(`/api/diary/${encodeURIComponent(userId)}/photos?limit=60`);
    const data = await safeJson(res);
    const wrap = $("#gallery");
    wrap.innerHTML = "";
    (data.items || []).forEach((p) => {
      const img = document.createElement("img");
      img.src = p.image_url;
      img.alt = p.date || "photo";
      wrap.appendChild(img);
    });
  } catch (err) {
    console.warn("gallery load failed", err);
  }
}

function setupFriendButtons(me, relation, id) {
  const addBtn = $("#addBtn");
  const acceptBtn = $("#acceptBtn");
  const rejectBtn = $("#rejectBtn");

  const show = (...targets) => {
    [addBtn, acceptBtn, rejectBtn].forEach((btn) => {
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
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.textContent = "이미 친구";
    }
    show(addBtn);
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
}


