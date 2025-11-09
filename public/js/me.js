// /public/js/me.js
(async () => {
  const sess = await fetch("/api/auth/session", { credentials: "include" }).then(r=>r.json());
  if (!sess.loggedIn) { location.replace("/login.html"); return; }

  const uid = sess.userId;
  const r = await fetch(`/api/users/${uid}`, { credentials: "include" });
  const j = await r.json();
  if (!r.ok) { alert(j.error || "ë¡œë“œ ?¤íŒ¨"); return; }

  const u = j.user;
  const $ = (s)=>document.querySelector(s);
  $("#avatar").src = u.avatar_url || "/image/logoblack.svg";
  $("#nickname").textContent = u.nickname || "(?‰ë„¤???†ìŒ)";
  $("#username").textContent = "@" + u.username;
  $("#bioText").textContent = u.bio || "?Œê°œê°€ ?†ìŠµ?ˆë‹¤.";

  document.getElementById("editBtn").addEventListener("click", () => {
    location.href = "/profile-edit.html";
  });

  // ë¯¸ë‹ˆ ê°¤ëŸ¬ë¦???ê²?
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

