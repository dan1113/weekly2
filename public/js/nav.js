// /public/js/nav.js
(async function mountNav(){
  // 현재 경로
  const path = location.pathname;

  // 세션 조회 (내 프로필 링크에 필요)
  let me = null;
  try{
    const r = await fetch("/api/auth/session", { credentials: "include" });
    const j = await r.json();
    if (j.loggedIn) me = j;
  }catch(e){ /* ignore */ }

  // 링크 결정
  const toCalendar = "/calendar.html";
  const toSearch   = "/search.html"; // 아직 없다면 나중에 만들 페이지
  const toProfile  = me?.loggedIn && me.userId ? "/me.html" : "/login.html";

   

  // 엘리먼트 생성
  const bar = document.createElement("nav");
  bar.className = "navbar";
  bar.innerHTML = `
    <a class="navbtn" data-key="search"   href="${toSearch}"   aria-label="검색">
      <strong>검색</strong>
      <span>friends</span>
    </a>
    <a class="navbtn" data-key="calendar" href="${toCalendar}" aria-label="달력">
      <strong>달력</strong>
      <span>calendar</span>
    </a>
    <a class="navbtn" data-key="profile"  href="${toProfile}"  aria-label="내 프로필">
      <strong>프로필</strong>
      <span>me</span>
    </a>
  `;

  document.body.appendChild(bar);

  // active 표시
  const keyByPath = (() => {
    if (path.includes("/calendar")) return "calendar";
    if (path.includes("/profile"))  return "profile";
    if (path.includes("/search"))   return "search";
    return "calendar"; // 기본
  })();

  const active = bar.querySelector(`.navbtn[data-key="${keyByPath}"]`);
  if (active) active.classList.add("active");

  // 접근성: 키보드 포커스가 갔을 때 active 스타일 유지
  bar.querySelectorAll(".navbtn").forEach(a=>{
    a.addEventListener("focus", ()=>a.classList.add("active"));
    a.addEventListener("blur",  ()=>{ if(a !== active) a.classList.remove("active"); });
  });
})();
