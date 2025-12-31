(async function mountNav(){
  const path = location.pathname;

  // 세션 판별 실패로 잘못된 링크가 생성되는 문제를 방지하기 위해
  // 프로필 링크는 항상 /me.html로 고정하고, 페이지 내부에서 권한을 판단합니다.
  const toCalendar = "/calendar.html";
  const toSearch = "/search.html";
  const toProfile = "/me.html";
  const bar = document.createElement("nav");
  bar.className = "navbar";
  bar.innerHTML = `
    <a class="navbtn" data-key="search" href="${toSearch}" aria-label="검색">
      <div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>
      <strong>검색</strong>
    </a>
    <a class="navbtn" data-key="calendar" href="${toCalendar}" aria-label="캘린더">
      <div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
      <strong>캘린더</strong>
    </a>
    <a class="navbtn" data-key="profile" href="${toProfile}" aria-label="내 프로필">
      <div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <strong>내 프로필</strong>
    </a>
  `;

  document.body.appendChild(bar);

  const keyByPath = (() => {
    if (path.includes("/calendar")) return "calendar";
    if (path.includes("/profile") || path.includes("/me")) return "profile";
    if (path.includes("/search")) return "search";
    return "calendar";
  })();

  const active = bar.querySelector(`.navbtn[data-key="${keyByPath}"]`);
  if (active) active.classList.add("active");

  bar.querySelectorAll(".navbtn").forEach((a) => {
    a.addEventListener("focus", () => a.classList.add("active"));
    a.addEventListener("blur", () => {
      if (a !== active) a.classList.remove("active");
    });
  });
})();
