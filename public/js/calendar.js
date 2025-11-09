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
if (todayText) todayText.textContent = fmt(today);

// ===== Local Storage =====
let STORAGE_KEY = "diaryCalendar:v4:guest";

async function initStorageKey() {
  try {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then(r=>r.json());
    const uid = (sess && sess.loggedIn && sess.userId) ? sess.userId : "guest";
    STORAGE_KEY = `diaryCalendar:v4:${uid}`;
  } catch {
    STORAGE_KEY = "diaryCalendar:v4:guest";
  }
}

const loadAll = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
const saveAll = (data) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) {
    alert('저장공간이 부족하거나 브라우저 설정으로 저장이 차단되었어요. 이미지 개수/크기를 줄여보세요.');
    console.error(e);
  }
};

const getEntry = (dateStr) => loadAll()[dateStr] || null;
const setEntry = (dateStr, entry) => { const all = loadAll(); all[dateStr] = entry; saveAll(all); };
const deleteEntry = (dateStr) => { const all = loadAll(); delete all[dateStr]; saveAll(all); };

// ===== Calendar Utils =====
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

// ===== Calendar Render =====
function render() {
  if (!grid) return;
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth() + 1;
  if (monthLabel) monthLabel.textContent = `${y}년 ${m}월`;

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

    if (entry?.images?.length) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = entry.images[0];
      img.alt = dateStr;
      cell.appendChild(img);
      cell.classList.add("has-image");
    }
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
  if (!selectedInfo) return;
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

  // 한 장당 4MB 제한 검사
  const validFiles = [];
  for (const f of qFiles.files) {
    if (f.size > 4 * 1024 * 1024) {
      alert(`"${f.name}" 파일이 4MB를 초과했어요. 제외됩니다.`);
      continue;
    }
    validFiles.push(f);
  }

  // 미리보기
  validFiles.forEach((f) => {
    const url = URL.createObjectURL(f);
    const img = document.createElement("img");
    img.src = url;
    img.style.width = "100%";
    img.style.height = "110px";
    img.style.objectFit = "cover";
    qPreview.appendChild(img);
  });

  // 선택된 파일 중 4MB 이하만 다시 반영
  qFiles._validFiles = validFiles; // 커스텀 속성으로 임시 저장
});


qSave.addEventListener("click", () => {
  if (!qCurrentDateStr) return;
  const all = loadAll();
  const text = qNote.value.trim();
  const files = qFiles._validFiles || qFiles.files; // 4MB 이하만 저장
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
  const dateStr  = fmt(d);
  const todayStr = fmt(today);
  const entry    = getEntry(dateStr) || {};

  const hasContent =
    (entry.text && entry.text.trim()) ||
    (entry.images && entry.images.length) ||
    (entry.schedule && entry.schedule.length);

  if (hasContent) { openViewer(dateStr); return; }

  if (dateStr < todayStr) {
    openQuickDiary(dateStr);                     // 과거: 다이어리
  } else if (dateStr > todayStr) {
    const title = prompt("일정 제목 입력");     // 미래: 일정
    if (!title) return;
    entry.schedule = entry.schedule || [];
    entry.schedule.push({ title, created: new Date().toISOString() });
    setEntry(dateStr, entry);
    render();
  } else {
    if (confirm("오늘 기록을 남길까요?")) openQuickDiary(dateStr);
    else {
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
if (prevBtn) prevBtn.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); render(); });
if (nextBtn) nextBtn.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); render(); });
if (todayBtn) todayBtn.addEventListener("click", () => {
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

// ===== View Sheet (읽기 전용) =====
function openViewer(dateStr){
  const entry = getEntry(dateStr) || {};
  const sheet     = document.getElementById('view-sheet');
  // 뷰어 카드 래퍼가 없으면 생성하여 기존 자식들을 이동
  let card = document.getElementById('v-card');
  if (sheet && !card){
    card = document.createElement('div');
    card.className = 'viewer-card';
    card.id = 'v-card';
    while (sheet.firstChild){ card.appendChild(sheet.firstChild); }
    sheet.appendChild(card);
  }
  const dateEl    = document.getElementById('v-date');
  const metaEl    = document.getElementById('v-meta');
  const photosEl  = document.getElementById('v-photos');
  const textEl    = document.getElementById('v-text');
  const schedWrap = document.getElementById('v-schedules-wrap');
  const schedEl   = document.getElementById('v-schedules');
  const editBtn   = document.getElementById('v-edit');
  const closeBtn  = document.getElementById('v-close');

  if (dateEl) dateEl.textContent = dateStr;
  const imgCount = (entry.images && entry.images.length) || 0;
  const schCount = (entry.schedule && entry.schedule.length) || 0;
  if (metaEl) metaEl.textContent = [
    imgCount ? `${imgCount}장 사진` : null,
    schCount ? `${schCount}개 일정` : null,
  ].filter(Boolean).join(' • ');

  if (photosEl){
    photosEl.innerHTML = '';
    if (imgCount){
      entry.images.forEach((src, i) => {
        const img = document.createElement('img');
        img.src = src; img.alt = `${dateStr} 사진 ${i+1}`;
        photosEl.appendChild(img);
      });
    } else {
      const ph = document.createElement('div');
      ph.className = 'ph';
      ph.textContent = '사진이 없습니다';
      photosEl.appendChild(ph);
    }
  }

  if (textEl){
    const txt = (entry.text || '').trim();
    if (txt){ textEl.classList.remove('empty'); textEl.textContent = txt; }
    else { textEl.classList.add('empty'); textEl.textContent = '작성된 내용이 없어요.'; }
  }

  if (schedEl){
    schedEl.innerHTML = '';
    if (schCount){
      if (schedWrap) schedWrap.style.display = '';
      entry.schedule.forEach((s) => {
        const li = document.createElement('li');
        const left = document.createElement('div');
        const right = document.createElement('div');
        left.innerHTML = `
          <div class="title">${(s.title || '').trim() || '(제목 없음)'}</div>
          <div class="time">${s.created ? new Date(s.created).toLocaleString() : ''}</div>
        `;
        const btn = document.createElement('button');
        btn.className = 'edit';
        btn.type = 'button';
        btn.textContent = '수정';
        btn.addEventListener('click', () => {
          const choice = prompt('일정 제목을 수정하거나 빈칸으로 삭제합니다.', s.title || '');
          if (choice === null) return;
          const t = (choice || '').trim();
          if (!t) {
            // 삭제
            const all = loadAll();
            const ent = all[dateStr] || {};
            ent.schedule = (ent.schedule || []).filter(x => x !== s);
            if (ent.schedule.length === 0 && !ent.text && !ent.images?.length) delete all[dateStr]; else all[dateStr] = ent;
            saveAll(all);
          } else {
            s.title = t;
            setEntry(dateStr, entry);
          }
          openViewer(dateStr); render();
        });
        right.appendChild(btn);
        li.appendChild(left);
        li.appendChild(right);
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        schedEl.appendChild(li);
      });
    } else if (schedWrap){
      schedWrap.style.display = 'none';
    }
  }

  if (editBtn) editBtn.onclick = () => { closeViewer(); openQuickDiary(dateStr); };
  if (closeBtn) closeBtn.onclick = () => closeViewer();

  if (sheet) sheet.classList.add('open');
  // 포커스 이동 (접근성)
  const cardEl = document.getElementById('v-card');
  if (cardEl) cardEl.focus();
}
function closeViewer(){
  const sheet = document.getElementById('view-sheet');
  if (sheet) sheet.classList.remove('open');
}

// 배경(빈칸) 클릭 시 닫기
document.addEventListener('click', (e) => {
  const sheet = document.getElementById('view-sheet');
  if (!sheet || !sheet.classList.contains('open')) return;
  if (e.target && e.target.id === 'view-sheet') closeViewer();
});

document.head.appendChild(style);

// 상세보기 스타일(백드롭 + 카드)
const vStyle = document.createElement('style');
vStyle.textContent = `
#v-delete{ display:none !important; }
#view-sheet{ position:fixed; inset:0; display:flex; justify-content:center; align-items:flex-end; padding:16px 0 calc(16px + env(safe-area-inset-bottom)); background:rgba(0,0,0,.5); z-index:100; opacity:0; visibility:hidden; transition:opacity .25s ease; }
#view-sheet.open{ opacity:1; visibility:visible; }
#view-sheet .sheet-head{ position:sticky; top:0; background:#111; z-index:1; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.10); }
#view-sheet .sheet-head .date{ font-weight:700; font-size:18px; }
#view-sheet .sheet-head .meta{ font-size:12px; opacity:.6; }
#view-sheet .sheet-actions{ display:flex; gap:8px; }
#view-sheet .viewer-photos{ display:grid; grid-auto-flow:column; grid-auto-columns:100%; overflow-x:auto; scroll-snap-type:x mandatory; border-top:1px solid rgba(255,255,255,.12); border-bottom:1px solid rgba(255,255,255,.12); margin-top:8px; }
#view-sheet .viewer-photos img, #view-sheet .viewer-photos .ph{ width:100%; height:220px; object-fit:cover; display:block; scroll-snap-align:start; border-radius:8px; }
#view-sheet .viewer-photos .ph{ display:grid; place-items:center; opacity:.6; }
#view-sheet .viewer-section{ padding:0 14px 14px; }
#view-sheet .viewer-text{ white-space:pre-wrap; line-height:1.5; }
#view-sheet .viewer-text.empty{ opacity:.6; }
#view-sheet .sched-list{ list-style:none; padding:0; margin:0; }
#view-sheet .sched-list li{ padding:10px 0; border-bottom:1px solid rgba(255,255,255,.08); }
#view-sheet .sched-list .title{ font-size:14px; }
#view-sheet .sched-list .time{ font-size:12px; opacity:.6; }
#view-sheet .edit{ font-size:12px; border:1px solid rgba(255,255,255,.18); border-radius:8px; padding:4px 8px; background:transparent; color:#fff; }
#view-sheet .edit:hover{ border-color:rgba(255,255,255,.28); }
#view-sheet .sheet-handle{ width:40px; height:5px; background:rgba(255,255,255,.25); border-radius:999px; margin:8px auto; }
.btn.primary{ background:transparent; border:1px solid rgba(255,255,255,.6); color:#fff; }
.btn.ghost{ background:transparent; border:1px solid rgba(255,255,255,.18); }
.viewer-card{ width:min(520px,92vw); max-height:88dvh; background:#111; color:#fff; border-radius:16px; overflow:auto; transform:translateY(24px); transition:transform .25s ease; box-shadow:0 10px 30px rgba(0,0,0,.5); }
#view-sheet.open .viewer-card{ transform:translateY(0); }
@media (min-width:520px){ #view-sheet{ align-items:flex-end; padding:24px 0 24px; } }
`;
document.head.appendChild(vStyle);

// ESC 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeViewer();
});

// 핸들 드래그로 닫기
(() => {
  const sheet = document.getElementById('view-sheet');
  let startY = 0; let dragging = false;
  function onStart(ev){ dragging = true; startY = (ev.touches? ev.touches[0].clientY : ev.clientY); }
  function onMove(ev){ if (!dragging) return; const y = (ev.touches? ev.touches[0].clientY : ev.clientY); const dy = Math.max(0, y - startY); sheet.querySelector('.viewer-card')?.style.setProperty('transform', `translateY(${24+dy}px)`); }
  function onEnd(){ if (!dragging) return; dragging = false; const card = sheet.querySelector('.viewer-card'); if (!card) return; const current = card.style.transform.match(/translateY\((\d+)px\)/); const moved = current ? parseInt(current[1],10) - 24 : 0; if (moved > 80) closeViewer(); card.style.transform = ''; }
  document.addEventListener('mousedown', (e)=>{ if (e.target && e.target.classList.contains('sheet-handle')) onStart(e); });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchstart', (e)=>{ if (e.target && e.target.classList.contains('sheet-handle')) onStart(e); }, {passive:true});
  document.addEventListener('touchmove', onMove, {passive:true});
  document.addEventListener('touchend', onEnd);
})();

// ===== Init =====
(async () => {
  await initStorageKey();
  render();
})();
