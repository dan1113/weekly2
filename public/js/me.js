// /public/js/me.js
(async () => {
  const sess = await fetch("/api/auth/session", { credentials: "include" }).then(r=>r.json());
  if (!sess.loggedIn) { location.replace("/login.html"); return; }

  const uid = sess.userId;
  const r = await fetch(`/api/users/${uid}`, { credentials: "include" });
  const j = await r.json();
  if (!r.ok) { alert(j.error || "로드 실패"); return; }

  const u = j.user;
  const $ = (s)=>document.querySelector(s);
  $("#avatar").src = u.avatar_url || "/image/avatar-default.png";
  $("#nickname").textContent = u.nickname || "(닉네임 없음)";
  $("#username").textContent = "@" + u.username;
  $("#bioText").textContent = u.bio || "소개가 없습니다.";

  document.getElementById("editBtn").addEventListener("click", () => {
    location.href = "/profile-edit.html";
  });

  // 미니 갤러리(내 것)
  try {
    const rg = await fetch(`/api/diary/${uid}/photos?limit=60`, { credentials: "include" });
    const pj = await rg.json();
    const wrap = $("#gallery");
    wrap.innerHTML = "";
    (pj.items || []).forEach(p => {
      const img = document.createElement("img");
      img.src = p.image_url; img.alt = p.date;
      wrap.appendChild(img);
    });
  } catch {}
})();
