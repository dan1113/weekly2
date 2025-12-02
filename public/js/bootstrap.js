// 프런트 런타임에서 API_BASE를 결정합니다.
// - Pages 배포(https://*.pages.dev)에서는 Workers API로 지정하여 CORS+쿠키를 사용
// - 로컬/동일 출처 개발에서는 빈 문자열로 두어 같은 오리진으로 호출
if (typeof window !== "undefined") {
  try {
    const host = (location.hostname || "").toLowerCase();
    if (host.endsWith("pages.dev")) {
      // Pages 배포 → Workers 서브도메인으로 API 호출
      window.API_BASE = "https://weeklydiary.dan-1113.workers.dev";
    } else if (
      host === "localhost" || host.endsWith(".local") ||
      host === "weeklydiary.store" || host === "www.weeklydiary.store"
    ) {
      // 동일 출처(커스텀 도메인/로컬) → 같은 오리진으로 API 호출
      window.API_BASE = "";
    } else {
      window.API_BASE = window.API_BASE || "";
    }
  } catch {
    window.API_BASE = window.API_BASE || "";
  }
}
