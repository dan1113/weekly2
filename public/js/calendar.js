import { API_BASE, AUTH_HEADERS, apiFetch, ensureCsrfToken } from "./config.js";

// ===== Constants =====
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILE_COUNT = 5; // 최대 5장
const RESIZE_THRESHOLD = 2 * 1024 * 1024; // 2MB 이상이면 리사이즈

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
const titleEl = document.querySelector(".title");
if (todayText) todayText.textContent = fmt(today);

// ===== Cache =====
const overviewCache = new Map();
const overviewKey = (year, month) => `${year}-${pad(month)}`;
let qSelectedFiles = [];
let qPhotosLocked = false;

// ===== File Validation =====
function validateFiles(files) {
  const errors = [];
  
  if (files.length > MAX_FILE_COUNT) {
    errors.push(`최대 ${MAX_FILE_COUNT}장까지 업로드 가능합니다.`);
  }
  
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      errors.push(`${file.name}은(는) 이미지 파일이 아닙니다.`);
    }
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name}의 크기가 5MB를 초과합니다.`);
    }
  }
  
  return errors;
}

// ===== Image Resize =====
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

// ===== Base64 Encoding =====
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== Server API =====
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

// ===== Upload Base64 Images =====
async function uploadBase64Images(dateStr, files) {
  await ensureCsrfToken();
  const prepared = await Promise.all(files.map((f) => prepareImageForUpload(f)));
  const base64Files = await Promise.all(
    prepared.map(async (file, index) => {
      const base64 = await fileToBase64(file);
      return {
        filename: file.name,
        base64: base64,
        mime: file.type,
        order: index
      };
    })
  );

  const res = await fetch(`${API_BASE}/api/diary/upload-base64`, {
    method: "POST",
    credentials: "include",
    headers: AUTH_HEADERS({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      date: dateStr,
      files: base64Files
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "이미지 업로드에 실패했습니다.");
  
  return data;
}

// ===== Calendar Render =====
function playSlideAnimation(direction) {
  if (!grid || !direction) return;
  const cls = direction === "next" ? "slide-from-right" : "slide-from-left";
  grid.classList.remove("slide-from-right", "slide-from-left");
  // force reflow
  void grid.offsetWidth;
  grid.classList.add(cls);
  setTimeout(() => grid.classList.remove(cls), 300);
}

async function render(direction) {
  if (!grid) return;
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth() + 1;
  if (monthLabel) monthLabel.textContent = `${y}년 ${m}월`;
  if (titleEl) titleEl.textContent = `${m}월`;

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
  playSlideAnimation(direction);
}

function updateSelectedInfo() {
  if (!selectedInfo) return;
  selectedInfo.textContent = selectedDate ? `선택: ${fmt(selectedDate)}` : "선택 날짜 없음";
}

// ===== Quick Diary Sheet =====
const qSheet = document.getElementById("quickSheet");
const qDateEl = document.getElementById("qDate");
const qFiles = document.getElementById("qFiles");
const qPreview = document.getElementById("qPreview");
const qNote = document.getElementById("qNote");
const qSave = document.getElementById("qSave");
const qClose = document.getElementById("qClose");
const uploadTrigger = document.getElementById("uploadTrigger");
let qCurrentDateStr = null;
let viewSheetDateStr = null;

function openQuickDiary(dateStr, options = {}) {
  const { lockPhotos = false, noteText = "" } = options;
  qCurrentDateStr = dateStr;
  qSelectedFiles = [];
  qPhotosLocked = lockPhotos;
  if (qDateEl) qDateEl.textContent = dateStr;
  if (qNote) qNote.value = noteText || "";
  if (qFiles) {
    qFiles.value = "";
    qFiles.disabled = false;
    if (lockPhotos) qFiles.disabled = true;
  }
  if (qPreview) qPreview.innerHTML = "";
  if (qSheet) {
    qSheet.classList.remove("photos-locked");
    if (lockPhotos) qSheet.classList.add("photos-locked");
  }
  
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
  if (qFiles) qFiles.blur();
  if (qNote) qNote.blur();
  qPhotosLocked = false;
  if (qSheet) qSheet.classList.remove("photos-locked");
  
  qSheet.classList.remove("open");
  qCurrentDateStr = null;
}

if (qClose) qClose.addEventListener("click", closeQuickDiary);

// ===== File Selection Preview =====
if (qFiles) {
  qFiles.addEventListener("change", () => {
    if (!qPreview) return;
    if (qPhotosLocked) return;
    qPreview.innerHTML = "";
    qSelectedFiles = [...(qFiles.files || [])];
    
    // 파일 검증
    const errors = validateFiles(qSelectedFiles);
    if (errors.length > 0) {
      console.warn(errors.join("\\n"));
      qFiles.value = "";
      qSelectedFiles = [];
      return;
    }
    
    qSelectedFiles.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = document.createElement("img");
      img.src = url;
      img.onload = img.onerror = () => URL.revokeObjectURL(url);
      qPreview.appendChild(img);
    });
  });
}

if (uploadTrigger) {
  uploadTrigger.addEventListener("click", () => {
    if (qPhotosLocked) return;
    if (qFiles) qFiles.click();
  });
}

// ===== Save Diary =====
// ===== Save Diary ===== 부분 수정
if (qSave) {
  qSave.addEventListener("click", async () => {
    if (!qCurrentDateStr) return;
    const text = qNote ? qNote.value.trim() : "";
    
    if (!qSelectedFiles.length && !text) {
      console.warn("내용이나 이미지를 입력해 주세요.");
      return;
    }

    const originalLabel = qSave.textContent;
    qSave.disabled = true;
    qSave.textContent = "저장 중...";
    
    try {
      // ⭐ CSRF 토큰 먼저 확보
      console.log("🔐 Ensuring CSRF token...");
      const token = await ensureCsrfToken();
      console.log("✅ CSRF token ready:", token ? "YES" : "NO");
      
      if (!token) {
        throw new Error("CSRF 토큰을 가져올 수 없습니다. 페이지를 새로고침해주세요.");
      }
      
      // 1) 이미지 업로드 (base64)
      if (qSelectedFiles.length > 0 && !qPhotosLocked) {
        console.log("📤 Uploading images...");
        await uploadBase64Images(qCurrentDateStr, qSelectedFiles);
        console.log("✅ Images uploaded");
      }
      
      // 2) 텍스트 일기 저장
      if (text) {
        console.log("📤 Saving diary text...");
        const res = await fetch(`${API_BASE}/api/diary`, {
          method: "POST",
          credentials: "include",
          headers: AUTH_HEADERS({ "Content-Type": "application/json" }),
          body: JSON.stringify({ date: qCurrentDateStr, text })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "일기 저장에 실패했습니다.");
        console.log("✅ Diary text saved");
      }
      
      invalidateOverview(qCurrentDateStr);
      await render();
      
      if (viewSheetDateStr === qCurrentDateStr) {
        openViewer(qCurrentDateStr);
      }
      closeQuickDiary();
      console.log("✅ 저장 완료");
    } catch (e) {
      console.error("❌ Save error:", e);
      alert(`저장 중 오류 발생: ${e.message}`);
    } finally {
      qSave.disabled = false;
      qSave.textContent = originalLabel;
    }
  });
}

// ===== View Sheet =====
async function openViewer(dateStr) {
  const sheet = document.getElementById("view-sheet");
  if (!sheet) return;
  viewSheetDateStr = dateStr;
  
  const dateEl = document.getElementById("v-date");
  const metaEl = document.getElementById("v-meta");
  const photosEl = document.getElementById("v-photos");
  const textEl = document.getElementById("v-text");
  const schedWrap = document.getElementById("v-schedules-wrap");
  const schedEl = document.getElementById("v-schedules");
  const schedTime = document.getElementById("schedTime");
  const schedTitle = document.getElementById("schedTitle");
  const schedAdd = document.getElementById("schedAdd");
  const editBtn = document.getElementById("v-edit");
  const addBtn = document.getElementById("v-add");
  const deleteBtn = document.getElementById("v-delete");
  const closeBtn = document.getElementById("v-close");
  const cardEl = document.getElementById("v-card");
  let firstRatio = null;

  // 즉시 표시 + 애니메이션 초기화
  sheet.classList.add("open");
  if (cardEl) {
    cardEl.style.transform = "";
    cardEl.classList.remove("anim-in");
    void cardEl.offsetWidth; // reflow
    cardEl.classList.add("anim-in");
  }
  if (dateEl) dateEl.textContent = dateStr;
  if (metaEl) metaEl.textContent = "";
  if (photosEl) photosEl.innerHTML = "";
  if (textEl) {
    textEl.textContent = "작성된 내용이 없어요.";
    textEl.classList.add("empty");
  }
  if (schedEl) schedEl.innerHTML = "";
  if (schedWrap) schedWrap.style.display = "none";

  let diaryData = { entry: null, photos: [] };
  let schedules = { items: [] };
  
  try {
    [diaryData, schedules] = await Promise.all([
      fetchDiaryDay(dateStr),
      fetchSchedulesDay(dateStr)
    ]);
  } catch (e) {
    console.error(e);
  }

  const entry = diaryData.entry || { text: "" };
  const photos = diaryData.photos || [];
  const schedItems = schedules.items || [];

  if (cardEl) {
    cardEl.classList.remove("compact", "with-photos");
    cardEl.classList.add(photos.length ? "with-photos" : "compact");
  }

  if (metaEl) {
    const meta = [];
    if (photos.length) meta.push(`${photos.length}장 사진`);
    if (schedItems.length) meta.push(`${schedItems.length}건 일정`);
    metaEl.textContent = meta.length ? meta.join(" | ") : "기록 없음";
  }

  if (photosEl) {
    photosEl.innerHTML = "";
    if (photos.length) {
      // 첫 번째 업로드된 사진이 먼저 나오도록 정렬
      photos.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      photos.forEach((p) => {
        const img = document.createElement("img");
        img.src = p.base64_data || p.url || "";
        img.alt = `사진`;
        photosEl.appendChild(img);
      });
      photosEl.scrollLeft = 0;
    }
  }

  if (textEl) {
    textEl.textContent = entry.text || "작성된 내용이 없어요.";
    if (!entry.text) textEl.classList.add("empty");
    else textEl.classList.remove("empty");
  }

  if (schedEl) {
    schedEl.innerHTML = "";
    if (schedItems.length) {
      if (schedWrap) schedWrap.style.display = "block";
      schedItems.forEach((s) => {
        const li = document.createElement("li");
        const time = document.createElement("span");
        const title = document.createElement("span");
        time.className = "time";
        title.className = "title";
        time.textContent = (s.start_at || "T00:00:00").slice(11, 16);
        title.textContent = s.title;
        li.appendChild(time);
        li.appendChild(title);
        schedEl.appendChild(li);
      });
    } else if (schedWrap) {
      schedWrap.style.display = "none";
    }
  }
  if (schedTime) schedTime.value = "";
  if (schedTitle) schedTitle.value = "";

  if (editBtn) {
    editBtn.onclick = () => {
      closeViewer();
      openQuickDiary(dateStr, {
        lockPhotos: true,
        noteText: entry.text || "",
      });
    };
  }

  if (addBtn) {
    addBtn.onclick = () => {
      closeViewer();
      openQuickDiary(dateStr, {
        lockPhotos: false,
        noteText: entry.text || "",
      });
    };
  }
  
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm("이 날짜의 일기를 삭제하시겠습니까?")) return;
      
      try {
        const res = await fetch(`${API_BASE}/api/diary/day/${dateStr}`, {
          method: "DELETE",
          credentials: "include",
          headers: AUTH_HEADERS()
        });
        
        if (!res.ok) throw new Error("삭제 실패");
        
        invalidateOverview(dateStr);
        await render();
        closeViewer();
        console.log("삭제되었습니다.");
      } catch (e) {
        console.error(e);
        console.error("삭제 중 오류가 발생했습니다.");
      }
    };
  }
  
  if (closeBtn) closeBtn.onclick = () => closeViewer();

  if (schedAdd) {
    schedAdd.onclick = async () => {
      if (!viewSheetDateStr) return;
      const title = schedTitle ? schedTitle.value.trim() : "";
      if (!title) {
        console.warn("일정 제목을 입력해 주세요.");
        return;
      }
      const timeVal = schedTime && schedTime.value ? schedTime.value : "00:00";
      const startAt = `${viewSheetDateStr}T${timeVal}:00`;
      schedAdd.disabled = true;
      try {
        await apiFetch("/api/schedules", {
          method: "POST",
          headers: AUTH_HEADERS({ "Content-Type": "application/json" }),
          body: JSON.stringify({ title, start_at: startAt }),
        }).then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || "일정 저장 실패");
          invalidateOverview(viewSheetDateStr);
          const refreshed = await fetchSchedulesDay(viewSheetDateStr);
          if (refreshed?.items && schedEl) {
            schedEl.innerHTML = "";
            refreshed.items.forEach((s) => {
              const li = document.createElement("li");
              const time = document.createElement("span");
              const titleSpan = document.createElement("span");
              time.className = "time";
              titleSpan.className = "title";
              time.textContent = (s.start_at || "T00:00:00").slice(11, 16);
              titleSpan.textContent = s.title;
              li.appendChild(time);
              li.appendChild(titleSpan);
              schedEl.appendChild(li);
            });
            if (schedWrap) schedWrap.style.display = refreshed.items.length ? "block" : "none";
          }
        });
      } catch (err) {
        console.error(err);
      } finally {
        schedAdd.disabled = false;
      }
    };
  }
}

function closeViewer() {
  const sheet = document.getElementById("view-sheet");
  if (sheet) sheet.classList.remove("open");
}

// Swipe down to close the view sheet
function bindViewSheetDrag() {
  const sheet = document.getElementById("view-sheet");
  const card = document.getElementById("v-card");
  if (!sheet || !card) return;
  let startY = 0;
  let dragging = false;
  let currentY = 0;

  const onStart = (y) => {
    if (!sheet.classList.contains("open")) return;
    dragging = true;
    startY = y;
    currentY = 0;
    card.style.transition = "transform 0s";
  };
  const onMove = (y) => {
    if (!dragging) return;
    currentY = y - startY;
    if (currentY > 0) card.style.transform = `translateY(${currentY}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    card.style.transition = "transform 0.2s ease";
    if (currentY > 80) {
      closeViewer();
    } else {
      card.style.transform = "";
    }
  };

  card.addEventListener("touchstart", (e) => onStart(e.touches[0].clientY), { passive: true });
  card.addEventListener("touchmove", (e) => onMove(e.touches[0].clientY), { passive: true });
  card.addEventListener("touchend", onEnd, { passive: true });
  card.addEventListener("mousedown", (e) => onStart(e.clientY));
  card.addEventListener("mousemove", (e) => onMove(e.clientY));
  card.addEventListener("mouseup", onEnd);
  card.addEventListener("mouseleave", onEnd);
}

document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "view-sheet") closeViewer();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeViewer();
    closeQuickDiary();
  }
});

// ===== Swipe Gesture for Calendar Navigation =====
let touchStartX = 0;
let touchEndX = 0;
let touchStartY = 0;
let touchEndY = 0;

function handleSwipeGesture() {
  const diffX = touchEndX - touchStartX;
  const diffY = touchEndY - touchStartY;
  
  // 수평 스와이프가 수직 스와이프보다 크고, 최소 거리(50px) 이상일 때만 처리
  if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
    if (diffX > 0) {
      // 오른쪽 스와이프 → 이전 달
      if (prevBtn) prevBtn.click();
    } else {
      // 왼쪽 스와이프 → 다음 달
      if (nextBtn) nextBtn.click();
    }
  }
}

if (grid) {
  grid.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  grid.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipeGesture();
  }, { passive: true });
}

// ===== Date Click =====
function onClickDate(d) {
  selectedDate = d;
  updateSelectedInfo();
  openViewer(fmt(d));
  render();
}

// ===== Controls =====
if (prevBtn) {
  prevBtn.addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    render("prev");
  });
}

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    render("next");
  });
}

if (todayBtn) {
  todayBtn.addEventListener("click", () => {
    viewDate = new Date();
    selectedDate = new Date(today);
    updateSelectedInfo();
    render("today");
  });
}

// ===== Init =====
(async () => {
  await render();
  bindViewSheetDrag();
})();
