// ===== Utilities =====
const pad = n => String(n).padStart(2, "0");
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ===== State =====
let viewDate = new Date();
let selectedDate = null;
const today = new Date();

// DOM
const monthLabel = document.getElementById("monthLabel");
const grid = document.getElementById("calendarGrid");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const todayBtn = document.getElementById("todayBtn");
const selectedInfo = document.getElementById("selectedInfo");
const todayText = document.getElementById("todayText");
todayText.textContent = fmt(today);

// ===== Local Storage =====
const KEY = "diaryCalendar:v4"; // { [date]: { text, images:[], schedule?:[] } }
const loadAll = () => JSON.parse(localStorage.getItem(KEY) || "{}");
const saveAll = (data) => localStorage.setItem(KEY, JSON.stringify(data));
const getEntry = (dateStr) => loadAll()[dateStr] || null;
const setEntry = (dateStr, entry) => {
  const all = loadAll();
  all[dateStr] = entry;
  saveAll(all);
};
const deleteEntry = (dateStr) => {
  const all = loadAll();
  delete all[dateStr];
  saveAll(all);
};

// ===== Calendar Utils =====
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

// ===== Calendar Render =====
function render() {
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth() + 1;
  monthLabel.textContent = `${y}년 ${m}월`;

  grid.innerHTML = "";
  const first = startOfMonth(viewDate);
  const last = endOfMonth(viewDate);
  const leading = first.getDay();
  const totalDays = leading + last.getDate();
  const rows = Math.ceil(totalDays / 7);
  const cells = rows * 7;

  const start = new Date(first);
  start.setDate(first.getDate() - leading);

  for (let i = 0; i < cells; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const inThisMonth = d.getMonth() === viewDate.getMonth();
    const isToday = d.toDateString() === today.toDateString();
    const isSelected = selectedDate && d.toDateString() === selectedDate.toDateString();

    const cell = document.createElement("div");
    cell.className = "cell" + (isSelected ? " selected" : "");
    if (!inThisMonth) cell.classList.add("dim");
    if (isToday) {
      cell.style.background = "#fff";
      cell.style.color = "#000";
      cell.style.fontWeight = "600";
    }

    const dateStr = fmt(d);
    const entry = getEntry(dateStr);

    // 다이어리 썸네일
    if (entry?.images?.length) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = entry.images[0];
      img.alt = dateStr;
      cell.appendChild(img);
      cell.classList.add("has-image");
    }
    // 일정 점 표시
    if (entry?.schedule?.length) {
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
  selectedInfo.textContent = selectedDate
    ? `선택: ${fmt(selectedDate)}`
    : "선택 날짜 없음";
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
  qDateEl.textContent = dateStr;
  qNote.value = "";
  qFiles.value = "";
  qPreview.innerHTML = "";
  qSheet.classList.add("open");
}
function closeQuickDiary() {
  qSheet.classList.remove("open");
  qCurrentDateStr = null;
}

qFiles.addEventListener("change", () => {
  qPreview.innerHTML = "";
  [...(qFiles.files || [])].forEach((f) => {
    const url = URL.createObjectURL(f);
    const img = document.createElement("img");
    img.src = url;
    img.style.width = "100%";
    img.style.height = "110px";
    img.style.objectFit = "cover";
    qPreview.appendChild(img);
  });
});

qSave.addEventListener("click", () => {
  if (!qCurrentDateStr) return;
  const all = loadAll();
  const text = qNote.value.trim();
  const files = qFiles.files;
  const images = [];

  if (files?.length) {
    for (const f of files) {
      const reader = new FileReader();
      reader.onload = () => {
        images.push(reader.result);
        if (images.length === files.length) {
          all[qCurrentDateStr] = { ...(all[qCurrentDateStr] || {}), text, images };
          saveAll(all);
          closeQuickDiary();
          render();
        }
      };
      reader.readAsDataURL(f);
    }
  } else {
    all[qCurrentDateStr] = { ...(all[qCurrentDateStr] || {}), text };
    saveAll(all);
    closeQuickDiary();
    render();
  }
});

qClose.addEventListener("click", closeQuickDiary);

// ===== Click Event =====
function onClickDate(d) {
  selectedDate = new Date(d);
  updateSelectedInfo();
  const dateStr = fmt(d);
  const todayStr = fmt(today);
  const entry = getEntry(dateStr) || {};

  if (dateStr < todayStr) {
    // ✅ 과거 날짜: 다이어리
    openQuickDiary(dateStr);
    if (entry?.schedule?.length) {
      // 일정이 있으면 그대로 유지
      setEntry(dateStr, entry);
    }
  } else if (dateStr > todayStr) {
    // ✅ 미래 날짜: 일정 추가
    const title = prompt("일정 제목 입력");
    if (!title) return;
    entry.schedule = entry.schedule || [];
    entry.schedule.push({ title, created: new Date().toISOString() });
    setEntry(dateStr, entry);
    render();
  } else {
    // ✅ 오늘: 선택 가능
    if (confirm("오늘을 기록할까요?")) {
      openQuickDiary(dateStr);
    } else {
      const title = prompt("일정 제목 입력");
      if (!title) return;
      entry.schedule = entry.schedule || [];
      entry.schedule.push({ title, created: new Date().toISOString() });
      setEntry(dateStr, entry);
      render();
    }
  }
}

// ===== Controls =====
prevBtn.addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  render();
});
nextBtn.addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  render();
});
todayBtn.addEventListener("click", () => {
  viewDate = new Date();
  selectedDate = new Date(today);
  updateSelectedInfo();
  render();
});

// ===== Style for Quick Sheet =====
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

// ===== Init =====
render();
