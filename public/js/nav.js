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
      <strong>검색\n(비활성)</strong>
      <span>friends</span>
    </a>
    <a class="navbtn" data-key="calendar" href="${toCalendar}" aria-label="캘린더">
      <strong>캘린더</strong>
      <span>calendar</span>
    </a>
    <a class="navbtn" data-key="profile" href="${toProfile}" aria-label="내 프로필">
      <strong>내 프로필</strong>
      <span>me</span>
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

