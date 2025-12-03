import { API_BASE, AUTH_HEADERS, apiFetch } from "./config.js";

// ===== Constants =====
const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const RESIZE_THRESHOLD = 2 * 1024 * 1024;

// ===== Utilities =====
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();

function isValidDate(str = "") {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resizeImageFile(file, { maxWidth = 1600, maxHeight = 1600, quality = 0.85 } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          cleanup();
          if (!blob) return resolve(file);
          const base = file.name ? file.name.replace(/\.[^.]+$/, "") : "image";
          const newFile = new File([blob], `${base}.jpg`, { type: "image/jpeg" });
          resolve(newFile);
        }, "image/jpeg", quality);
      } catch {
        cleanup();
        resolve(file);
      }
    };
    img.onerror = () => {
      cleanup();
      resolve(file);
    };
    img.src = url;
  });
}

// ===== State & DOM =====
let viewDate = new Date();
let selectedDate = null;
let qSelectedFiles = [];
let qCurrentDateStr = null;

const monthLabel = document.getElementById("monthLabel");
const grid = document.getElementById("calendarGrid");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const todayBtn = document.getElementById("todayBtn");
const selectedInfo = document.getElementById("selectedInfo");
const todayText = document.getElementById("todayText");
if (todayText) todayText.textContent = fmt(today);

const overviewCache = new Map();
const overviewKey = (year, month) => `${year}-${pad(month)}`;

const qDateEl = document.getElementById("qDate");
const qFiles = document.getElementById("qFiles");
const qPreview = document.getElementById("qPreview");
const qNote = document.getElementById("qNote");
const qSave = document.getElementById("qSave");
const qClose = document.getElementById("qClose");
const qSheet = document.getElementById("quickSheet");

// ===== CSRF =====
let csrfReady = null;
async function ensureCsrf() {
  if (csrfReady) return csrfReady;
  csrfReady = (async () => {
    const res = await fetch(`${API_BASE}/api/csrf`, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!data?.csrfToken) throw new Error("CSRF token fetch failed");
    let meta = document.querySelector('meta[name="csrf-token"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "csrf-token";
      document.head.appendChild(meta);
    }
    meta.content = data.csrfToken;
  })();
  return csrfReady;
}

// ===== API Helpers =====
async function fetchOverview(year, month) {
  try {
    const res = await apiFetch(`/api/calendar/overview?year=${year}&month=${month}`);
    if (!res.ok) throw new Error("fail");
    return res.json();
  } catch {
    return { days: [] };
  }
}

async function fetchDiaryDay(dateStr) {
  try {
    const res = await apiFetch(`/api/diary/day/${dateStr}`);
    if (!res.ok) throw new Error("fail");
    return res.json();
  } catch {
    return { entry: null, photos: [] };
  }
}

async function fetchSchedulesDay(dateStr) {
  try {
    const res = await apiFetch(`/api/schedules/day/${dateStr}`);
    if (!res.ok) throw new Error("fail");
    return res.json();
  } catch {
    return { items: [] };
  }
}

function invalidateOverview(dateStr) {
  const [yy, mm] = (dateStr || "").split("-");
  if (!yy || !mm) return;
  overviewCache.delete(overviewKey(Number(yy), Number(mm)));
}

async function uploadDiaryBase64(dateStr, files, text) {
  await ensureCsrf();
  const prepared = await Promise.all(
    files.map(async (f) => {
      const resized = f.size > RESIZE_THRESHOLD ? await resizeImageFile(f) : f;
      const b64 = await fileToBase64(resized);
      if (b64.length > 7 * 1024 * 1024) throw new Error("파일이 5MB를 초과합니다.");
      return b64;
    })
  );

  const payload = prepared.map((b64, i) => ({
    filename: files[i].name,
    base64: b64,
    mime: files[i].type || "image/jpeg",
    order: i,
  }));

  const res = await fetch(`${API_BASE}/api/diary/upload-base64`, {
    method: "POST",
    credentials: "include",
    headers: AUTH_HEADERS({ "Content-Type": "application/json" }),
    body: JSON.stringify({ date: dateStr, files: payload, text: text || "" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error || "업로드 실패");
  return data;
}

// ===== Render =====
async function render() {
  if (!grid) return;
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth() + 1;
  if (monthLabel) monthLabel.textContent = `${y}년 ${m}월`;

  const key = overviewKey(y, m);
  let overview = overviewCache.get(key);
  if (!overview) {
    overview = await fetchOverview(y, m);
    overviewCache.set(key, overview);
  }
  const dayMap = new Map((overview.days || []).map((d) => [d.date, d]));

  grid.innerHTML = "";
  const first = new Date(y, viewDate.getMonth(), 1);
  const last = new Date(y, viewDate.getMonth() + 1, 0);
  const leading = first.getDay();
  const totalCells = Math.ceil((leading + last.getDate()) / 7) * 7;
  const cursor = new Date(first);
  cursor.setDate(first.getDate() - leading);

  for (let i = 0; i < totalCells; i++) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() + i);
    const cell = document.createElement("div");
    const inMonth = d.getMonth() === viewDate.getMonth();
    const dateStr = fmt(d);
    const ov = dayMap.get(dateStr);
    cell.className = "cell" + (selectedDate && d.toDateString() === selectedDate.toDateString() ? " selected" : "");
    if (!inMonth) cell.classList.add("dim");
    if (d.toDateString() === today.toDateString()) {
      cell.style.background = "#fff";
      cell.style.color = "#000";
      cell.style.fontWeight = "600";
    }

    if (ov?.diaryThumb) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = ov.diaryThumb;
      img.alt = dateStr;
      cell.appendChild(img);
      cell.classList.add("has-image");
    }
    if (ov?.scheduleCount) {
      const dot = document.createElement("div");
      dot.className = "dot";
      cell.appendChild(dot);
    }

    const num = document.createElement("div");
    num.className = "num";
    num.textContent = d.getDate();
    cell.appendChild(num);

    const hit = document.createElement("div");
    hit.className = "hit";
    hit.addEventListener("click", () => onClickDate(d));
    cell.appendChild(hit);
    grid.appendChild(cell);
  }

  updateSelectedInfo();
}

function updateSelectedInfo() {
  if (!selectedInfo) return;
  selectedInfo.textContent = selectedDate ? `선택: ${fmt(selectedDate)}` : "선택된 날짜 없음";
}

// ===== Quick Diary =====
function openQuickDiary(dateStr) {
  qCurrentDateStr = dateStr;
  qSelectedFiles = [];
  if (qDateEl) qDateEl.textContent = dateStr;
  if (qNote) qNote.value = "";
  if (qFiles) qFiles.value = "";
  if (qPreview) qPreview.innerHTML = "";
  if (qSheet) {
    qSheet.setAttribute("aria-hidden", "false");
    qSheet.classList.add("open");
  }
  fetchDiaryDay(dateStr)
    .then((data) => {
      if (qNote && data?.entry && !qNote.value.trim()) {
        qNote.value = data.entry.text || "";
      }
    })
    .catch(() => {});
}

function closeQuickDiary() {
  if (qSheet) {
    qSheet.classList.remove("open");
    qSheet.setAttribute("aria-hidden", "true");
  }
  qCurrentDateStr = null;
}

if (qFiles) qFiles.addEventListener("change", () => {
  if (!qPreview) return;
  qPreview.innerHTML = "";
  qSelectedFiles = [...(qFiles.files || [])].slice(0, MAX_FILES);
  qSelectedFiles.forEach((file) => {
    const url = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = url;
    img.style.width = "100%";
    img.style.height = "110px";
    img.style.objectFit = "cover";
    img.onload = img.onerror = () => URL.revokeObjectURL(url);
    qPreview.appendChild(img);
  });
});

if (qSave) qSave.addEventListener("click", async () => {
  if (!qCurrentDateStr) return;
  if (!isValidDate(qCurrentDateStr)) return alert("날짜 형식이 올바르지 않습니다.");
  const text = qNote ? qNote.value.trim() : "";
  if (!qSelectedFiles.length && !text) {
    alert("메모나 사진을 입력해 주세요.");
    return;
  }
  if (qSelectedFiles.length > MAX_FILES) return alert(`사진은 최대 ${MAX_FILES}장까지 업로드 가능합니다.`);
  for (const f of qSelectedFiles) {
    if (f.size > MAX_BYTES) return alert(`${f.name} 파일이 5MB를 초과합니다.`);
  }
  const originalLabel = qSave.textContent;
  qSave.disabled = true;
  qSave.textContent = "저장 중...";
  try {
    await uploadDiaryBase64(qCurrentDateStr, qSelectedFiles, text);
    invalidateOverview(qCurrentDateStr);
    await render();
    closeQuickDiary();
    alert("저장 완료!");
  } catch (e) {
    console.error(e);
    alert(`저장 실패: ${e.message}`);
  } finally {
    qSave.disabled = false;
    qSave.textContent = originalLabel;
  }
});

if (qClose) qClose.addEventListener("click", closeQuickDiary);

// ===== View Sheet =====
async function openViewer(dateStr) {
  const sheet = document.getElementById("view-sheet");
  if (!sheet) return;
  const dateEl = document.getElementById("v-date");
  const metaEl = document.getElementById("v-meta");
  const photosEl = document.getElementById("v-photos");
  const textEl = document.getElementById("v-text");
  const schedWrap = document.getElementById("v-schedules-wrap");
  const schedEl = document.getElementById("v-schedules");
  const editBtn = document.getElementById("v-edit");
  const deleteBtn = document.getElementById("v-delete");
  const closeBtn = document.getElementById("v-close");

  if (dateEl) dateEl.textContent = dateStr;
  let diaryData = { entry: null, photos: [] };
  let schedules = { items: [] };
  try {
    [diaryData, schedules] = await Promise.all([fetchDiaryDay(dateStr), fetchSchedulesDay(dateStr)]);
  } catch (e) {
    console.error(e);
  }

  const entry = diaryData.entry || { text: "" };
  const photos = (diaryData.photos || []).map((p, idx) => ({
    url: p.base64_data || p.url,
    order_index: p.order_index ?? idx,
  }));
  const schedItems = schedules.items || [];

  if (metaEl) {
    const meta = [];
    if (photos.length) meta.push(`${photos.length}장 사진`);
    if (schedItems.length) meta.push(`${schedItems.length}건 일정`);
    metaEl.textContent = meta.length ? meta.join(" | ") : "일정/사진 없음";
  }

  if (photosEl) {
    photosEl.innerHTML = "";
    photos.forEach((p) => {
      const img = document.createElement("img");
      img.src = p.url;
      img.alt = `사진 ${((p.order_index ?? 0) + 1)}`;
      photosEl.appendChild(img);
    });
  }

  if (textEl) {
    if (entry.text) {
      textEl.textContent = entry.text;
      textEl.classList.remove("empty");
    } else {
      textEl.textContent = "작성된 내용이 없어요.";
      textEl.classList.add("empty");
    }
  }

  if (schedEl) {
    schedEl.innerHTML = "";
    if (schedItems.length && schedWrap) schedWrap.style.display = "block";
    else if (schedWrap) schedWrap.style.display = "none";
    schedItems.forEach((s) => {
      const li = document.createElement("li");
      const left = document.createElement("div");
      const time = document.createElement("span");
      const title = document.createElement("span");
      time.className = "time";
      title.className = "title";
      time.textContent = (s.start_at || "T00:00:00").slice(11, 16);
      title.textContent = s.title;
      left.appendChild(time);
      left.appendChild(title);
      li.appendChild(left);
      schedEl.appendChild(li);
    });
  }

  if (editBtn) editBtn.onclick = () => { closeViewer(); openQuickDiary(dateStr); };
  if (closeBtn) closeBtn.onclick = () => closeViewer();
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm("이 날짜의 메모와 사진을 삭제할까요?")) return;
      try {
        await apiFetch(`/api/diary/day/${dateStr}`, { method: "DELETE" });
        invalidateOverview(dateStr);
        await render();
        closeViewer();
      } catch (e) {
        alert("삭제 실패");
      }
    };
  }

  sheet.classList.add("open");
}

function closeViewer() {
  const sheet = document.getElementById("view-sheet");
  if (sheet) sheet.classList.remove("open");
}

document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "view-sheet") closeViewer();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeViewer();
});

// ===== Controls =====
if (prevBtn)
  prevBtn.addEventListener("click", async () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    await render();
  });
if (nextBtn)
  nextBtn.addEventListener("click", async () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    await render();
  });
if (todayBtn)
  todayBtn.addEventListener("click", async () => {
    viewDate = new Date();
    selectedDate = new Date(today);
    updateSelectedInfo();
    await render();
  });

// ===== Init =====
(async () => {
  await ensureCsrf().catch((e) => console.error("CSRF init failed", e));
  await render();
})();

// ===== Click handler for cells =====
async function onClickDate(d) {
  selectedDate = d;
  updateSelectedInfo();
  const dateStr = fmt(d);

  const ov = overviewCache.get(overviewKey(d.getFullYear(), d.getMonth() + 1));
  const day = Array.isArray(ov?.days) ? ov.days.find((x) => x.date === dateStr) : null;
  let hasData = !!(day && (day.diaryThumb || (day.scheduleCount ?? 0) > 0));

  if (!hasData) {
    try {
      const diaryData = await fetchDiaryDay(dateStr);
      const schedData = await fetchSchedulesDay(dateStr);
      hasData = !!((diaryData?.entry) || (diaryData?.photos?.length) || (schedData?.items?.length));
    } catch {
      hasData = false;
    }
  }

  if (hasData) openViewer(dateStr);
  else openQuickDiary(dateStr);

  await render();
}
