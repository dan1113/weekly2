import { API_BASE, AUTH_HEADERS, apiFetch, setUserId } from "./config.js";
import { uploadFile } from "./uploader.js";
import { toImageUrl } from "./image-url.js";

const fileEl = document.getElementById("file");
const preview = document.getElementById("preview");
const bioEl = document.getElementById("bio");
const saveBtn = document.getElementById("save");

let pendingFile = null;
let previewUrl = null;

init();

async function init() {
  await loadProfile();
  fileEl?.addEventListener("change", handleFileChange);
  saveBtn?.addEventListener("click", handleSave);
}

async function loadProfile() {
  try {
    const sess = await apiFetch("/api/auth/session").then((r) => r.json());
    if (!sess?.loggedIn) {
      location.replace("/login.html");
      return;
    }
    if (sess.userId) setUserId(sess.userId);

    const profileRes = await apiFetch(`/api/users/${encodeURIComponent(sess.userId)}`);
    const profile = await profileRes.json();
    if (profile?.user) {
      const avatarSrc = toImageUrl(profile.user.avatar_url || profile.user.avatarKey) || "/image/avatar-default.png";
      if (preview) preview.src = avatarSrc;
      if (bioEl) bioEl.value = profile.user.bio || "";
    }
  } catch (err) {
    console.error(err);
    alert("프로필 정보를 불러오지 못했습니다.");
  }
}

function handleFileChange() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const file = fileEl?.files?.[0] || null;
  pendingFile = file;
  if (file && preview) {
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
  }
}

async function handleSave() {
  if (!saveBtn) return;
  saveBtn.disabled = true;
  const original = saveBtn.textContent;
  saveBtn.textContent = "저장 중...";

  try {
    // 아바타는 워커가 multipart 업로드를 직접 처리하도록 전송
    if (pendingFile) {
      const fd = new FormData();
      fd.append("file", pendingFile);
      await apiFetch(`/api/profile/avatar`, {
        method: "POST",
        body: fd,
      }).then(checkOk("아바타 저장에 실패했습니다."));
    }

    if (bioEl) {
      await apiFetch(`/api/users/me/bio`, {
        method: "POST",
        headers: AUTH_HEADERS({ "Content-Type": "application/json" }),
        body: JSON.stringify({ bio: bioEl.value.trim() }),
      }).then(checkOk("소개 저장에 실패했습니다."));
    }

    alert("저장되었습니다.");
    location.href = "/me.html";
  } catch (err) {
    console.error(err);
    alert(err.message || "저장 중 오류가 발생했습니다.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = original;
  }
}

function checkOk(message) {
  return async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || message);
    }
    return res;
  };
}
