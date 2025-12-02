import { API_BASE, AUTH_HEADERS, apiFetch } from "./config.js";
import { selectFiles, presignBatch, uploadWithRetry, complete } from "./uploader.js";
import { toImageUrl } from "./image-url.js";

// ===== Utilities =====
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const RESIZE_THRESHOLD = 2 * 1024 * 1024; // 2MB 이상이면 리사이즈

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
const overviewKey = (year, month) => `${year}-${pad(month)}`;
let qSelectedFiles = [];

// ===== Server Helpers =====
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
// 기존 HTML에 quickSheet가 있으면 그것을 사용하고, 없으면 동적 생성
let qSheet = document.getElementById("quickSheet");
if (!qSheet) {
  qSheet = document.createElement("div");
  qSheet.className = "quick-sheet";
  qSheet.id = "quickSheet";
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
        <label class="label" for="qFiles">사진</label>
        <input id="qFiles" type="file" accept="image/*" multiple />
        <div id="qPreview" class="quick-preview"></div>
      </div>
      <div class="field">
        <label class="label" for="qNote">메모</label>
        <textarea id="qNote" placeholder="간단히 기록해요."></textarea>
      </div>
    </div>
  `;
  document.body.appendChild(qSheet);
}

const qDateEl = document.getElementById("qDate");
const qFiles = document.getElementById("qFiles");
const qPreview = document.getElementById("qPreview");
const qNote = document.getElementById("qNote");
const qSave = document.getElementById("qSave");
const qClose = document.getElementById("qClose");
let qCurrentDateStr = null;

// 사진 업로드 버튼(없다면 동적으로 생성) → 클릭 시 파일 선택창 오픈
(() => {
  if (!qFiles) return;
  let addBtn = document.getElementById('addPhoto');
  if (!addBtn) {
    addBtn = document.createElement('button');
    addBtn.id = 'addPhoto';
    addBtn.type = 'button';
    addBtn.textContent = '사진 추가';
    // 파일 입력 바로 뒤에 버튼 삽입
    qFiles.insertAdjacentElement('afterend', addBtn);
  }
  addBtn.addEventListener('click', () => qFiles.click());
})();

// 선택된 사진 업로드 공통 로직
async function doPhotoUpload(btn) {
  if (!qCurrentDateStr) return alert('날짜를 먼저 선택하세요.');
  if (!qSelectedFiles.length) return alert('업로드할 사진을 선택하세요.');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '업로드 중...';
  try {
    const prepared = await Promise.all(qSelectedFiles.map((f) => prepareImageForUpload(f)));
    const presigned = await presignBatch(qCurrentDateStr, prepared);
    const payload = [];
    for (let i = 0; i < presigned.length; i++) {
      const p = presigned[i];
      const f = prepared[i];
      await uploadWithRetry(f, p, () => {});
      payload.push({ key: p.key, bytes: f.size, width: null, height: null, mime: f.type, order: i });
    }
    if (payload.length) await complete(qCurrentDateStr, payload);
    invalidateOverview(qCurrentDateStr);
    await render();
    alert('사진 업로드 완료');
  } catch (e) {
    console.error(e);
    alert(`업로드 실패: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// 선택된 사진만 먼저 업로드하는 전용 버튼 추가 (미리보기 아래)
(() => {
  if (!qFiles) return;
  let upBtn = document.getElementById('qUpload');
  if (!upBtn) {
    upBtn = document.createElement('button');
    upBtn.id = 'qUpload';
    upBtn.type = 'button';
    upBtn.textContent = '사진 업로드';
    (qPreview || qFiles).insertAdjacentElement('afterend', upBtn);
  }
  upBtn.addEventListener('click', () => doPhotoUpload(upBtn));
})();

// 닫기 버튼 옆에 업로드 버튼 추가
(() => {
  const head = qClose ? qClose.parentElement : null;
  if (!head) return;
  let headBtn = document.getElementById('qUploadHead');
  if (!headBtn) {
    headBtn = document.createElement('button');
    headBtn.id = 'qUploadHead';
    headBtn.type = 'button';
    headBtn.textContent = '업로드';
    qClose.insertAdjacentElement('afterend', headBtn);
  }
  headBtn.addEventListener('click', () => doPhotoUpload(headBtn));
})();

function openQuickDiary(dateStr) {
  qCurrentDateStr = dateStr;
  qSelectedFiles = [];
  if (qDateEl) qDateEl.textContent = dateStr;
  if (qNote) qNote.value = "";
  if (qFiles) qFiles.value = "";
  if (qPreview) qPreview.innerHTML = "";
  if (qSheet) qSheet.setAttribute("aria-hidden", "false");
  qSheet.classList.add("open");
  fetchDiaryDay(dateStr)
    .then((data) => {
      if (qNote && data?.entry && !qNote.value.trim()) {
        qNote.value = data.entry.text || "";
      }
    })
    .catch(() => {});
}

function closeQuickDiary() {
  qSheet.classList.remove("open");
  qCurrentDateStr = null;
  if (qSheet) qSheet.setAttribute("aria-hidden", "true");
}

// 닫기 버튼 동작 연결
if (qClose) qClose.addEventListener("click", closeQuickDiary);

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

if (qFiles) qFiles.addEventListener("change", () => {
  if (!qPreview) return;
  qPreview.innerHTML = "";
  qSelectedFiles = [...(qFiles.files || [])];
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
  const text = qNote ? qNote.value.trim() : "";
  if (!qSelectedFiles.length && !text) {
    alert("내용이나 이미지를 입력해 주세요.");
    return;
  }
  const originalLabel = qSave.textContent;
  qSave.disabled = true;
  qSave.textContent = "업로드 중...";
  try {
    // 1) 이미지 전처리(선택)
    const prepared = await Promise.all(qSelectedFiles.map((f) => prepareImageForUpload(f)));
    // 2) 프리사인 요청
    const presigned = prepared.length ? await presignBatch(qCurrentDateStr, prepared) : [];
    // 3) 각각 업로드
    const payload = [];
    for (let i = 0; i < presigned.length; i++) {
      const p = presigned[i];
      const f = prepared[i];
      await uploadWithRetry(f, p, () => {});
      payload.push({ key: p.key, bytes: f.size, width: null, height: null, mime: f.type, order: i });
    }
    // 4) 메타데이터 저장
    if (payload.length) await complete(qCurrentDateStr, payload);
    // 5) 텍스트 일기 저장(있을 때)
    if (text) {
      const res = await fetch(`${API_BASE}/api/diary`, {
        method: "POST",
        credentials: "include",
        headers: AUTH_HEADERS({ "Content-Type": "application/json" }),
        body: JSON.stringify({ date: qCurrentDateStr, text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "일기 저장에 실패했습니다.");
    }
    
    invalidateOverview(qCurrentDateStr);
    await render();
    closeQuickDiary();
    alert("저장 성공!");
  } catch (e) {
    console.error(e);
    alert(`저장 중 오류 발생: ${e.message}`);
  } finally {
    qSave.disabled = false;
    qSave.textContent = originalLabel;
  }
});

function onClickDate(d) {
  selectedDate = d;
  updateSelectedInfo();
  render();
  openViewer(fmt(d));
}

async function handleScheduleAdd(dateStr) {
  const title = prompt("일정 제목을 입력하세요");
  if (!title) return;
  try {
    const res = await fetch(`${API_BASE}/api/schedules`, {
      method: "POST",
      credentials: "include",
      headers: AUTH_HEADERS({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        title: title.trim(),
        start_at: `${dateStr}T09:00:00`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error || "일정 저장에 실패했습니다.");
      return;
    }
    invalidateOverview(dateStr);
    await render();
  } catch (e) {
    console.error(e);
    alert("일정 저장 중 오류가 발생했습니다.");
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
  let images = { items: [] };
  try {
    [diaryData, schedules, images] = await Promise.all([
      fetchDiaryDay(dateStr),
      fetchSchedulesDay(dateStr),
      (async () => {
        const r = await apiFetch(`/api/calendar/images?date=${encodeURIComponent(dateStr)}`);
        if (!r.ok) return { items: [] };
        return r.json();
      })(),
    ]);
  } catch (e) {
    console.error(e);
  }

  const entry = diaryData.entry || { text: "" };
  // 우선 서버 이미지 목록을 사용하고, 없을 때만 구형 필드 사용
  const photos = (images.items && images.items.length)
    ? images.items.map((it, idx) => ({ url: it.url, order_index: it.order ?? idx }))
    : (diaryData.photos || []).map((p, idx) => ({ url: toImageUrl(p.key), order_index: p.order_index ?? idx }));
  const schedItems = schedules.items || [];

  if (metaEl) {
    const meta = [];
    if (photos.length) meta.push(`${photos.length}장 사진`);
    if (schedItems.length) meta.push(`${schedItems.length}건 일정`);
    metaEl.textContent = meta.length ? meta.join(" | ") : "기록 없음";
  }

  if (photosEl) {
    photosEl.innerHTML = "";
    if (photos.length) {
      photos.forEach((p) => {
        const img = document.createElement("img");
        img.src = p.url;
        img.alt = `사진 ${((p.order_index ?? 0) + 1)}`;
        photosEl.appendChild(img);
      });
    }
  }

  if (textEl) {
    textEl.textContent = entry.text || "작성된 내용이 없습니다.";
    if (!entry.text) textEl.classList.add("empty");
    else textEl.classList.remove("empty");
  }

  if (schedEl) {
    schedEl.innerHTML = "";
    if (schedItems.length) {
      if (schedWrap) schedWrap.style.display = "block";
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
    } else if (schedWrap) {
      schedWrap.style.display = "none";
    }
  }

  if (editBtn)
    editBtn.onclick = () => {
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

// ===== Quick Sheet Styles (Quick Sheet DOM 생성 시점에 추가) =====
const style = document.createElement("style");
style.textContent = ` 
  .quick-sheet { 
    /* ... (CSS 코드 유지) ... */ 
  }
  .quick-sheet.open { 
    transform: translateY(0); 
  }
  /* ... (나머지 CSS 코드 유지) ... */
`;
document.head.appendChild(style);


// ===== View Sheet Styles (View Sheet DOM 생성 시점에 추가) =====
const vStyle = document.createElement("style");
vStyle.textContent = `
  /* ... (View Sheet CSS 코드 유지) ... */
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
    const delta = currentY - startY;
    if (delta > 0) {
      card().style.transform = `translateY(${delta}px)`;
    }
  };
  const onEnd = (ev) => {
    if (!dragging) return;
    dragging = false;
    const currentY = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
    const delta = currentY - startY;
    card().style.transform = '';
    if (delta > 100) closeViewer();
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

// === Multi-image uploader (non-intrusive wiring) ===
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t) return;
  if (t.matches('[data-add-photo],#add-photo,#addPhoto')) {
    const originalLabel = t.textContent; // 버튼 원래 텍스트 저장
    try {
      const dateStr = selectedDate ? fmt(selectedDate) : fmt(today);
      const files = await selectFiles({ multiple: true, accept: 'image/*' });
      if (!files || !files.length) return;
      
      t.textContent = '업로드 준비 중...';
      
      // 🔥 [수정]: presignBatch를 호출하고 오류 발생 시 catch 블록으로 이동합니다.
      const presigned = await presignBatch(dateStr, files); 
      
      const payload = [];
      for (let i=0;i<presigned.length;i++){
        const p = presigned[i];
        const f = files[i];
        t.textContent = `업로드 중 (${i+1}/${presigned.length})...`;
        await uploadWithRetry(f, p, (pct)=>{ t.setAttribute('data-progress', String(pct)); });
        payload.push({ key: p.key, bytes: f.size, width: null, height: null, mime: f.type, order: i, url: p.url });
      }
      
      // 업로드 완료 후 complete 요청
      t.textContent = '저장 중...';
      await complete(dateStr, payload); 

      t.textContent = originalLabel;
      t.removeAttribute('data-progress');
      
      // UI 갱신 (선택한 날짜의 썸네일 업데이트 등)
      invalidateOverview(dateStr);
      await render();
      
    } catch (error) {
      // 403 (CSRF 실패), 500 (Presign 실패) 등 모든 오류가 여기서 잡힙니다.
      console.error('File upload process failed:', error);
      alert(`사진 업로드 실패: ${error.message}. 서버 로그를 확인하세요.`);
      
      t.textContent = originalLabel;
      t.removeAttribute('data-progress');
    }
  }
});
