// ===== Utilities =====
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ===== State =====
let viewDate = new Date();
let selectedDate = null;
const today = new Date();

// ===== DOM =====
const monthLabel = document.getElementById("monthLabel");
const grid = document.getElementById("calendarGrid");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const todayBtn = document.getElementById("todayBtn");
const selectedInfo = document.getElementById("selectedInfo");
const todayText = document.getElementById("todayText");
if (todayText) todayText.textContent = fmt(today);

// ===== Config =====
const overviewCache = new Map();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const RESIZE_THRESHOLD = 2 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|heic|heif)$/i;
const overviewKey = (year, month) => `${year}-${pad(month)}`;
let qSelectedFiles = [];

// ===== Server Helpers =====
async function getCsrfToken() {
  try {
    const res = await fetch("/api/csrf", { credentials: "include" });
    return (await res.json()).csrfToken;
  } catch {
    return "";
  }
}

async function fetchOverview(year, month) {
  try {
    const res = await fetch(`/api/calendar/overview?year=${year}&month=${month}`, { credentials: "include" });
    if (!res.ok) throw new Error("fail");
    return res.json();
  } catch {
    return { days: [] };
  }
}

async function fetchDiaryDay(dateStr) {
  try {
    const res = await fetch(`/api/diary/day/${dateStr}`, { credentials: "include" });
    if (!res.ok) throw new Error("fail");
    return res.json();
  } catch {
    return { entry: null, photos: [] };
  }
}

async function fetchSchedulesDay(dateStr) {
  try {
    const res = await fetch(`/api/schedules/day/${dateStr}`, { credentials: "include" });
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

// ===== Calendar Render =====
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
  selectedInfo.textContent = selectedDate ? `선택: ${fmt(selectedDate)}` : "선택 날짜 없음";
}

// ===== Quick Diary Bottom Sheet =====
const qSheet = document.createElement("div");
qSheet.className = "quick-sheet";
qSheet.innerHTML = `
  <div class="head">
    <div class="sheet-title" id="qDate"></div>
    <div class="sheet-actions">
      <button class="btn" id="qClose">닫기</button>
      <button class="btn primary" id="qSave">저장</button>
    </div>
  </div>
  <div class="body">
    <div class="field">
      <div class="label">사진</div>
      <input id="qFiles" type="file" accept="image/*" multiple />
      <div class="quick-preview" id="qPreview"></div>
    </div>
    <div class="field">
      <label class="label" for="qNote">메모</label>
      <textarea id="qNote" placeholder="간단히 기록해요."></textarea>
    </div>
  </div>
`;
document.body.appendChild(qSheet);

const qDateEl = qSheet.querySelector("#qDate");
const qFiles = qSheet.querySelector("#qFiles");
const qPreview = qSheet.querySelector("#qPreview");
const qNote = qSheet.querySelector("#qNote");
const qSave = qSheet.querySelector("#qSave");
const qClose = qSheet.querySelector("#qClose");
let qCurrentDateStr = null;

function openQuickDiary(dateStr) {
  qCurrentDateStr = dateStr;
  qSelectedFiles = [];
  if (qDateEl) qDateEl.textContent = dateStr;
  if (qNote) qNote.value = "";
  if (qFiles) qFiles.value = "";
  if (qPreview) qPreview.innerHTML = "";
  qSheet.classList.add("open");
  fetchDiaryDay(dateStr).then((data) => {
    if (qNote && data?.entry && !qNote.value.trim()) {
      qNote.value = data.entry.text || "";
    }
  }).catch(() => {});
}

function closeQuickDiary() {
  qSheet.classList.remove("open");
  qCurrentDateStr = null;
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

async function prepareImageForUpload(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) return file;
  if (/heic|heif/i.test(file.type)) return file;
  if (file.size <= RESIZE_THRESHOLD) return file;
  try {
    return await resizeImageFile(file);
  } catch {
    return file;
  }
}

qFiles.addEventListener("change", () => {
  if (!qPreview) return;
  qPreview.innerHTML = "";
  qSelectedFiles = [];
  [...(qFiles.files || [])].forEach((file) => {
    if (!ACCEPTED_IMAGE_TYPES.test(file.type || "")) {
      alert(`"${file.name}"은 지원하지 않는 이미지 형식이에요.`);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      alert(`"${file.name}" 파일은 ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB를 초과했어요.`);
      return;
    }
    qSelectedFiles.push(file);
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

qSave.addEventListener("click", async () => {
  if (!qCurrentDateStr) return;
  const text = qNote ? qNote.value.trim() : "";
  const files = qSelectedFiles.length ? qSelectedFiles : [...(qFiles.files || [])];
  if (!files.length) {
    alert("이미지를 선택해 주세요.");
    return;
  }
  const originalLabel = qSave.textContent;
  qSave.disabled = true;
  qSave.textContent = "업로드 중...";
  try {
    const token = await getCsrfToken();
    const form = new FormData();
    form.append("date", qCurrentDateStr);
    form.append("text", text);
    for (const file of files) {
      const prepared = await prepareImageForUpload(file);
      form.append("images", prepared);
    }
    const res = await fetch("/api/diary", {
      method: "POST",
      credentials: "include",
      headers: { "CSRF-Token": token },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error || "다이어리 업로드 실패");
      return;
    }
    invalidateOverview(qCurrentDateStr);
    qSelectedFiles = [];
    closeQuickDiary();
    await render();
  } catch (e) {
    console.error(e);
    alert("업로드 중 오류가 발생했어요.");
  } finally {
    qSave.disabled = false;
    qSave.textContent = originalLabel || "저장";
  }
});

qClose.addEventListener("click", closeQuickDiary);

// ===== Click Event =====
async function onClickDate(d) {
  selectedDate = new Date(d);
  updateSelectedInfo();
  const dateStr = fmt(d);
  try {
    const [diaryData, schedData] = await Promise.all([
      fetchDiaryDay(dateStr),
      fetchSchedulesDay(dateStr),
    ]);
    const hasContent =
      (diaryData.entry && diaryData.entry.text && diaryData.entry.text.trim()) ||
      (diaryData.photos && diaryData.photos.length) ||
      (schedData.items && schedData.items.length);
    if (hasContent) {
      await openViewer(dateStr);
      return;
    }
  } catch (e) {
    console.error(e);
  }

  if (dateStr < fmt(today)) {
    openQuickDiary(dateStr);
    return;
  }

  if (dateStr === fmt(today)) {
    if (confirm("오늘 기록을 남길까요?")) {
      openQuickDiary(dateStr);
      return;
    }
  }

  const title = prompt("일정 제목을 입력하세요");
  if (!title) return;
  try {
    const token = await getCsrfToken();
    const res = await fetch("/api/schedules", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "CSRF-Token": token },
      body: JSON.stringify({
        title: title.trim(),
        start_at: `${dateStr}T09:00:00`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error || "일정 저장에 실패했어요.");
      return;
    }
    invalidateOverview(dateStr);
    await render();
  } catch (e) {
    console.error(e);
    alert("일정 저장 중 오류가 발생했어요.");
  }
}

// ===== View Sheet =====
async function openViewer(dateStr) {
  const sheet = document.getElementById("view-sheet");
  if (!sheet) return;

  let card = document.getElementById("v-card");
  if (!card) {
    card = document.createElement("div");
    card.className = "viewer-card";
    card.id = "v-card";
    while (sheet.firstChild) card.appendChild(sheet.firstChild);
    sheet.appendChild(card);
  }

  const dateEl = document.getElementById("v-date");
  const metaEl = document.getElementById("v-meta");
  const photosEl = document.getElementById("v-photos");
  const textEl = document.getElementById("v-text");
  const schedWrap = document.getElementById("v-schedules-wrap");
  const schedEl = document.getElementById("v-schedules");
  const editBtn = document.getElementById("v-edit");
  const closeBtn = document.getElementById("v-close");

  if (dateEl) dateEl.textContent = dateStr;
  let diaryData = { entry: null, photos: [] };
  let schedules = { items: [] };
  try {
    [diaryData, schedules] = await Promise.all([
      fetchDiaryDay(dateStr),
      fetchSchedulesDay(dateStr),
    ]);
  } catch (e) {
    console.error(e);
  }
  const entry = diaryData.entry || { text: "" };
  const photos = diaryData.photos || [];
  const schedItems = schedules.items || [];

  if (metaEl) {
    const meta = [];
    if (photos.length) meta.push(`${photos.length}장 사진`);
    if (schedItems.length) meta.push(`${schedItems.length}개 일정`);
    metaEl.textContent = meta.join(" • ");
  }

  if (photosEl) {
    photosEl.innerHTML = "";
    if (photos.length) {
      photos.forEach((p, idx) => {
        const img = document.createElement("img");
        img.src = p.image_url;
        img.alt = `${dateStr} 사진 ${idx + 1}`;
        photosEl.appendChild(img);
      });
    } else {
      const ph = document.createElement("div");
      ph.className = "ph";
      ph.textContent = "사진이 없습니다";
      photosEl.appendChild(ph);
    }
  }

  if (textEl) {
    const txt = (entry.text || "").trim();
    if (txt) {
      textEl.classList.remove("empty");
      textEl.textContent = txt;
    } else {
      textEl.classList.add("empty");
      textEl.textContent = "작성된 내용이 없어요.";
    }
  }

  if (schedEl) {
    schedEl.innerHTML = "";
    if (schedItems.length) {
      if (schedWrap) schedWrap.style.display = "";
      schedItems.forEach((s) => {
        const li = document.createElement("li");
        const left = document.createElement("div");
        left.className = "title-block";
        const title = document.createElement("div");
        title.className = "title";
        title.textContent = s.title || "(제목 없음)";
        const time = document.createElement("div");
        time.className = "time";
        const timeParts = [];
        if (s.start_at) timeParts.push(new Date(s.start_at).toLocaleString());
        if (s.location) timeParts.push(s.location);
        time.textContent = timeParts.join(" · ");
        left.appendChild(title);
        left.appendChild(time);
        li.appendChild(left);
        schedEl.appendChild(li);
      });
    } else if (schedWrap) {
      schedWrap.style.display = "none";
    }
  }

  if (editBtn) editBtn.onclick = () => {
    closeViewer();
    openQuickDiary(dateStr);
  };
  if (closeBtn) closeBtn.onclick = () => closeViewer();

  sheet.classList.add("open");
  card.focus();
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
if (prevBtn) prevBtn.addEventListener("click", async () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  await render();
});
if (nextBtn) nextBtn.addEventListener("click", async () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  await render();
});
if (todayBtn) todayBtn.addEventListener("click", async () => {
  viewDate = new Date();
  selectedDate = new Date(today);
  updateSelectedInfo();
  await render();
});

// ===== Quick Sheet Styles =====
const style = document.createElement("style");
style.textContent = `
.quick-sheet {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: #000;
  border-top: 1px solid rgba(255,255,255,.14);
  transform: translateY(100%);
  transition: transform .25s ease;
  z-index: 100;
  border-radius: 16px 16px 0 0;
}
.quick-sheet.open { transform: translateY(0); }
.quick-sheet .head { padding: 12px 14px; display:flex; justify-content:space-between; align-items:center; }
.quick-sheet .body { padding: 0 14px 14px; display:flex; flex-direction:column; gap:12px; }
.quick-preview { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.quick-preview img { border-radius:8px; }
.quick-sheet textarea {
  background:#000; color:#fff; border:1px solid rgba(255,255,255,.14);
  border-radius:12px; padding:12px; font-size:14px; resize:vertical;
}
`;
document.head.appendChild(style);

// ===== View Sheet Styles =====
const vStyle = document.createElement("style");
vStyle.textContent = `
#view-sheet{ position:fixed; inset:0; display:flex; justify-content:center; align-items:flex-end; padding:16px 0 calc(16px + env(safe-area-inset-bottom)); background:rgba(0,0,0,.5); z-index:100; opacity:0; visibility:hidden; transition:opacity .25s ease; }
#view-sheet.open{ opacity:1; visibility:visible; }
.viewer-card{ width:min(520px,92vw); max-height:88dvh; background:#111; color:#fff; border-radius:16px; overflow:auto; transform:translateY(24px); transition:transform .25s ease; box-shadow:0 10px 30px rgba(0,0,0,.5); outline:none; }
#view-sheet.open .viewer-card{ transform:translateY(0); }
#view-sheet .sheet-head{ position:sticky; top:0; background:#111; z-index:1; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.1); display:flex; justify-content:space-between; align-items:center; }
#view-sheet .viewer-photos{ display:grid; grid-auto-flow:column; grid-auto-columns:100%; overflow-x:auto; scroll-snap-type:x mandatory; border-top:1px solid rgba(255,255,255,.12); border-bottom:1px solid rgba(255,255,255,.12); margin-top:8px; }
#view-sheet .viewer-photos img, #view-sheet .viewer-photos .ph{ width:100%; height:220px; object-fit:cover; display:block; scroll-snap-align:start; border-radius:8px; }
#view-sheet .viewer-section{ padding:0 14px 14px; }
#view-sheet .viewer-text{ white-space:pre-wrap; line-height:1.5; }
#view-sheet .viewer-text.empty{ opacity:.6; }
#view-sheet .sched-list{ list-style:none; padding:0; margin:0; }
#view-sheet .sched-list li{ padding:10px 0; border-bottom:1px solid rgba(255,255,255,.08); display:flex; flex-direction:column; gap:4px; }
#view-sheet .title{ font-size:14px; }
#view-sheet .time{ font-size:12px; opacity:.6; }
.sheet-handle{ width:40px; height:5px; background:rgba(255,255,255,.25); border-radius:999px; margin:8px auto; }
`;
document.head.appendChild(vStyle);

// ===== Drag Handle Close =====
(() => {
  const sheet = document.getElementById("view-sheet");
  if (!sheet) return;
  let startY = 0;
  let dragging = false;
  const card = () => document.getElementById("v-card");
  const onStart = (ev) => {
    const handle = ev.target;
    if (!handle || !handle.classList.contains("sheet-handle")) return;
    dragging = true;
    startY = ev.touches ? ev.touches[0].clientY : ev.clientY;
  };
  const onMove = (ev) => {
    if (!dragging) return;
    const currentY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const delta = Math.max(0, currentY - startY);
    card()?.style.setProperty("transform", `translateY(${24 + delta}px)`);
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    const el = card();
    if (!el) return;
    const match = el.style.transform.match(/translateY\((\d+)px\)/);
    const moved = match ? parseInt(match[1], 10) - 24 : 0;
    el.style.transform = "";
    if (moved > 80) closeViewer();
  };
  document.addEventListener("mousedown", onStart);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onEnd);
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("touchend", onEnd);
})();

// ===== Init =====
(async () => {
  await render();
})();
