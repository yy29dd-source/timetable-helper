// =====================================================================
// app.js — 화면 전환, 이벤트, 저장 (계산은 logic.js)
// =====================================================================

const STORAGE_KEY = "sigan-helper-v1";
const ENTRY_YEARS = [2022, 2023, 2024, 2025, 2026];
const CUSTOM_AREAS = ["기본전공", "심화전공", "대학특화", "기초교양", "핵심교양", "일반교양", "공학기초", "일반선택"];

// ---------------------------------------------------------------
// 저장 (localStorage 키 하나에 JSON)
// ---------------------------------------------------------------

function emptyState() {
  return {
    entryYear: null,
    currentTerm: null,
    leaves: [],
    checked: {},
    custom: [],
    conditions: { credits: null, freeDay: null, timeOff: null },
    excluded: [],
    myTimetable: null
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return Object.assign(emptyState(), JSON.parse(raw));
  } catch (e) {
    console.warn("저장된 기록을 읽지 못했어요:", e);
    return emptyState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("저장하지 못했어요:", e);
  }
}

function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 무시 */ }
  state = emptyState();
}

function hasRecord() {
  return !!state.entryYear;
}

let state = loadState();

// 화면에서만 쓰는 값 (저장하지 않음)
const ui = {
  screen: "start",
  history: [],
  tabIndex: 0,
  search: "",
  draftYear: null,
  detailOpen: false,
  draftCond: null,   // 6번에서 고르는 중인 조건
  result: null,      // 마지막 추천 결과
  planIndex: 0       // 7번에서 보는 안 (A=0)
};

// ---------------------------------------------------------------
// 공통 도우미
// ---------------------------------------------------------------

const $app = () => document.getElementById("app");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

// 아래 고정 버튼 높이만큼 내용 아래쪽 여백을 맞춤
function fitBottom() {
  const b = document.querySelector("#app .bottom");
  document.documentElement.style.setProperty("--bottom-h", (b ? b.offsetHeight : 0) + "px");
}

function topbar(title, opts = {}) {
  return `
    <header class="topbar">
      ${opts.noBack ? "" : `<button class="icon-btn" data-act="back" aria-label="뒤로 가기">‹</button>`}
      <div class="title">${title ? `<h1>${title}</h1>` : ""}</div>
      ${opts.right || ""}
    </header>`;
}

// ---------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------

const screens = {}; // 이름 → { render(), bind() }

function go(name, opts = {}) {
  if (!opts.replace && ui.screen !== name) ui.history.push(ui.screen);
  ui.screen = name;
  render();
  window.scrollTo(0, 0);
}

function back() {
  const prev = ui.history.pop();
  ui.screen = prev || "start";
  render();
  window.scrollTo(0, 0);
}

function render() {
  const s = screens[ui.screen];
  $app().innerHTML = s.render();
  if (s.bind) s.bind();
  fitBottom();
  rememberScreen();
}

// 새로고침해도 보던 화면을 다시 보여 주기 (같은 탭에서만, sessionStorage)
const UI_KEY = "sigan-helper-ui";
function rememberScreen() {
  try {
    sessionStorage.setItem(UI_KEY, JSON.stringify({ screen: ui.screen, history: ui.history, tabIndex: ui.tabIndex, planIndex: ui.planIndex }));
  } catch (e) { /* 저장 못 해도 동작에는 문제 없음 */ }
}
function restoreScreen() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(UI_KEY) || "null");
    if (!saved || !screens[saved.screen] || !hasRecord()) return;
    Object.assign(ui, { screen: saved.screen, history: saved.history || [], tabIndex: saved.tabIndex || 0, planIndex: saved.planIndex || 0 });
    if (ui.screen === "year") ui.draftYear = state.entryYear;
  } catch (e) { /* 무시 */ }
}

// 화면 안의 버튼은 data-act 로 처리
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === "back") return back();
  const s = screens[ui.screen];
  if (s.actions && s.actions[act]) s.actions[act](el, e);
});

window.addEventListener("resize", fitBottom);

// 체크리스트에서 옆으로 밀어서 학기 이동 (한 번만 등록)
(function () {
  let sx = 0, sy = 0;
  document.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  document.addEventListener("touchend", e => {
    if (ui.screen !== "checklist" || document.querySelector(".sheet")) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) moveTab(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

// =====================================================================
// 1. 시작 화면
// =====================================================================

screens.start = {
  render() {
    const buttons = hasRecord()
      ? `<button class="btn btn-primary" data-act="continue">이어서 하기</button>
         <button class="btn" data-act="reset">처음부터 다시</button>`
      : `<button class="btn btn-primary" data-act="begin">시간표 만들러 가기</button>`;
    return `
      <section class="hero">
        <h1>시간표 만들기 도우미</h1>
        <p>들은 과목만 체크하면 남은 졸업학점과 다음 학기 시간표를 알려 드려요.</p>
        <ol class="steps" aria-label="사용 순서">
          <li><span class="num" aria-hidden="true">1</span>들은 과목 체크하기</li>
          <li><span class="num" aria-hidden="true">2</span>남은 학점 확인하기</li>
          <li><span class="num" aria-hidden="true">3</span>다음 학기 시간표 추천받기</li>
        </ol>
        ${hasRecord() ? `<p class="small muted" style="margin-top:16px">저장된 기록이 있어요 · ${state.entryYear}학번</p>` : ""}
      </section>
      <div class="bottom">${buttons}</div>`;
  },
  actions: {
    begin() { ui.draftYear = state.entryYear; go("year"); },
    continue() { go("status"); },
    reset() {
      if (!confirm("기록이 모두 지워져요. 처음부터 다시 할까요?")) return;
      clearState();
      ui.history = [];
      ui.draftYear = null;
      go("year");
    }
  }
};

// =====================================================================
// 2. 입학년도 설정
// =====================================================================

screens.year = {
  render() {
    const y = ui.draftYear;
    const current = state.currentTerm || Logic.getCurrentTerm();
    let preview = `<p class="muted small">입학년도를 고르면 학기별 체크리스트를 만들어 드려요.</p>`;
    if (y) {
      const terms = Logic.listTerms(y, current);
      preview = terms.length
        ? `<p style="margin:0 0 8px"><strong>체크리스트 ${terms.length}개를 만들어요</strong></p>
           <p class="muted small" style="margin:0 0 10px">${terms[0]} ~ ${terms[terms.length - 1]}</p>
           <div class="chips">${terms.map(t => `<span class="chip">${t}</span>`).join("")}</div>`
        : `<p class="muted small">아직 입학 전이에요. 이번 학기는 ${current}이에요.</p>`;
    }
    return `
      ${topbar("입학년도 설정")}
      <h2>몇 년도에 입학했나요?</h2>
      <div class="choices" role="group" aria-label="입학년도">
        ${ENTRY_YEARS.map(v => `<button class="choice" data-act="pick" data-year="${v}" aria-pressed="${v === y}">${v}</button>`).join("")}
      </div>
      <div class="card" style="margin-top:16px">${preview}</div>
      <div class="bottom">
        <button class="btn btn-primary" data-act="next" ${y && Logic.listTerms(y, current).length ? "" : "disabled"}>다음</button>
      </div>`;
  },
  actions: {
    pick(el) { ui.draftYear = Number(el.dataset.year); render(); },
    next() {
      const y = ui.draftYear;
      const hasChecks = Object.values(state.checked).some(a => a.length) || state.custom.length;
      if (state.entryYear && state.entryYear !== y && hasChecks) {
        if (!confirm("입학년도를 바꾸면 지금까지 체크한 내용이 지워져요. 바꿀까요?")) return;
        const keep = { conditions: state.conditions };
        state = Object.assign(emptyState(), keep);
      }
      state.entryYear = y;
      if (!state.currentTerm) state.currentTerm = Logic.getCurrentTerm();
      const terms = Logic.listTerms(y, state.currentTerm);
      terms.forEach(t => { if (!state.checked[t]) state.checked[t] = []; });
      saveState();
      ui.tabIndex = 0;
      ui.search = "";
      go("checklist");
    }
  }
};

// =====================================================================
// 3. 학기별 체크리스트
// =====================================================================

// 지금 보는 탭 정보
function currentTab() {
  const tabs = Logic.termTabs(state);
  ui.tabIndex = Math.max(0, Math.min(ui.tabIndex, tabs.length - 1));
  return { tabs, tab: tabs[ui.tabIndex] };
}

// 과목 한 줄에 필요한 정보
function courseRow(c, term, opts = {}) {
  const checkedHere = (state.checked[term] || []).includes(c.code);
  const elsewhere = checkedHere ? null : Logic.findCheckedTerm(state, c.code, term);
  const old = c.oldName ? ` <span class="muted">(구 ${esc(c.oldName)})</span>` : "";
  const area = c.sub && c.sub !== "공통기초" ? `${c.area} · ${c.sub}` : c.area;
  const where = opts.showGrade && c.grade ? ` · ${c.grade}학년 ${c.term === 0 ? "전체" : c.term + "학기"}` : "";
  const badge = opts.badge ? `<span class="badge req">${opts.badge}</span>` : "";
  const note = elsewhere ? ` · ${elsewhere}에서 체크함` : "";
  return `
    <label class="row${checkedHere ? " checked" : ""}">
      <input type="checkbox" data-code="${esc(c.code)}" ${checkedHere ? "checked" : ""}>
      <span class="name"><strong>${esc(c.name)}</strong>${old}${badge}
        <span class="meta">${esc(area)}${where}${note}</span></span>
      <span class="credit">${fmt(c.credit)}학점</span>
    </label>`;
}

// 그 학년·학기의 전공 과목 (4학년 탭에는 '4학년 전체'도)
function majorsFor(tab) {
  return (DATA.curriculum[state.entryYear] || []).filter(c =>
    c.grade === tab.grade && (c.term === tab.sem || (tab.grade === 4 && c.term === 0)));
}

// 교양: 그 학년·학기의 교양필수를 맨 위에, 나머지는 가나다순
function generalsFor(tab) {
  const all = DATA.general[state.entryYear] || [];
  const reqHere = (DATA.requiredGeneral[state.entryYear] || []).filter(g => g.grade === tab.grade && g.term === tab.sem);
  const top = reqHere.map(g => {
    const info = all.find(x => x.code === g.code) || { code: g.code, name: g.name, area: "기초교양", sub: null, credit: g.credit };
    return { course: info, badge: g.choice ? "택1 필수" : "교양필수" };
  });
  const topCodes = new Set(top.map(t => t.course.code));
  const rest = all.filter(c => !topCodes.has(c.code)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { top, rest };
}

// 검색: 모든 학년 전공 + 교양에서 과목명 포함
function searchCourses(q) {
  const norm = s => s.replace(/\s+/g, "").toLowerCase();
  const nq = norm(q);
  if (!nq) return [];
  const majors = (DATA.curriculum[state.entryYear] || []).filter(c => norm(c.name).includes(nq) || (c.oldName && norm(c.oldName).includes(nq)));
  const gens = (DATA.general[state.entryYear] || []).filter(c => norm(c.name).includes(nq));
  return majors.concat(gens.sort((a, b) => a.name.localeCompare(b.name, "ko")));
}

function listHTML(tab) {
  if (tab.leave) {
    return `<div class="leave-box"><strong>휴학한 학기예요</strong><span class="muted small">휴학을 취소하려면 위의 [휴학 취소]를 눌러 주세요.</span></div>`;
  }
  const term = tab.term;

  if (ui.search.trim()) {
    const found = searchCourses(ui.search);
    return `
      <div class="section-title">검색 결과 ${found.length}개</div>
      ${found.length
        ? `<div class="list">${found.map(c => courseRow(c, term, { showGrade: true })).join("")}</div>
           <p class="tiny muted" style="margin:8px 4px">체크하면 지금 보는 ${term} 학기에 저장돼요.</p>`
        : `<div class="list"><div class="empty">"${esc(ui.search)}"이(가) 들어간 과목이 없어요.<br>직접 입력으로 추가할 수 있어요.</div></div>`}`;
  }

  const majors = majorsFor(tab);
  const { top, rest } = generalsFor(tab);
  const customs = customsForTab(term);
  // 위 목록에 없는데 이 학기에 체크된 과목 (다른 학년 전공을 검색으로 체크, [다음 학기로 이동]으로 들어온 과목 등)
  const shown = new Set(majors.map(c => c.code).concat(top.map(t => t.course.code), rest.map(c => c.code)));
  const extras = (state.checked[term] || []).filter(code => !shown.has(code))
    .map(code => Logic.findCourse(state.entryYear, code)).filter(Boolean);
  return `
    ${extras.length ? `
      <div class="section-title">그 외 체크한 과목</div>
      <div class="list">${extras.map(c => courseRow(c, term)).join("")}</div>` : ""}
    <div class="section-title">전공</div>
    <div class="list">${majors.length ? majors.map(c => courseRow(c, term)).join("") : `<div class="empty">이 학기 교육과정에 전공 과목이 없어요.</div>`}</div>
    ${customs.length ? `
      <div class="section-title">직접 입력</div>
      <div class="list">${customs.map(c => `
        <div class="row checked">
          <span class="name"><strong>${esc(c.name)}</strong><span class="badge custom">직접 입력</span>
            <span class="meta">${esc(c.area)}${c.term !== term ? " · " + Logic.termName(c.term) : ""}</span></span>
          <span class="credit">${fmt(c.credit)}학점</span>
          <button class="del" data-act="delCustom" data-id="${esc(c.id)}" aria-label="${esc(c.name)} 삭제">×</button>
        </div>`).join("")}</div>` : ""}
    <div class="section-title">교양</div>
    <div class="list">
      ${top.map(t => courseRow(t.course, term, { badge: t.badge })).join("")}
      ${rest.map(c => courseRow(c, term)).join("")}
    </div>`;
}

// 이 탭에 보여 줄 직접 입력 과목 (여름학기는 1학기 탭에, 겨울학기는 2학기 탭에 함께)
function customsForTab(term) {
  const { year, sem } = Logic.parseTerm(term);
  const season = year + (sem === "1" ? "-S" : "-W");
  return state.custom.filter(c => c.term === term || c.term === season);
}

screens.checklist = {
  render() {
    const { tabs, tab } = currentTab();
    const isLast = ui.tabIndex === tabs.length - 1;
    const leaveBtn = `<button class="btn-small${tab.leave ? " on" : ""}" data-act="leave" aria-pressed="${tab.leave}">${tab.leave ? "휴학 취소" : "휴학했어요"}</button>`;
    return `
      <header class="topbar term-head">
        <button class="icon-btn" data-act="back" aria-label="뒤로 가기">‹</button>
        <div class="title">
          <h1>${tab.term}</h1>
          <p>${tab.label} · ${ui.tabIndex + 1} / ${tabs.length}</p>
        </div>
        ${leaveBtn}
      </header>
      <div class="dots" aria-hidden="true">
        ${tabs.map((t, i) => `<span class="dot${i === ui.tabIndex ? " on" : ""}${t.leave ? " leave" : ""}"></span>`).join("")}
      </div>
      ${tab.leave ? "" : `
      <div class="search">
        <label for="q" class="sr-only">과목 검색</label>
        <input id="q" type="search" placeholder="과목명 검색 (전체 학년 전공 + 교양)" value="${esc(ui.search)}" autocomplete="off">
        ${ui.search ? `<button class="clear" data-act="clearSearch" aria-label="검색어 지우기">×</button>` : ""}
      </div>`}
      <div id="list">${listHTML(tab)}</div>
      <div class="bottom">
        ${tab.leave ? "" : `<button class="btn-link" data-act="openCustom">들었던 과목이 없나요? 직접 입력하기</button>`}
        <div class="btn-row">
          <button class="btn" data-act="prev" ${ui.tabIndex === 0 ? "disabled" : ""}>이전 학기</button>
          ${isLast
            ? `<button class="btn btn-primary" style="min-height:48px;font-size:16px" data-act="done">체크 완료</button>`
            : `<button class="btn" data-act="next">다음 학기</button>`}
        </div>
      </div>`;
  },

  bind() {
    const q = document.getElementById("q");
    if (q) {
      q.addEventListener("input", () => {
        ui.search = q.value;
        refreshList();
        const clear = document.querySelector(".search .clear");
        if (ui.search && !clear) q.insertAdjacentHTML("afterend", `<button class="clear" data-act="clearSearch" aria-label="검색어 지우기">×</button>`);
        if (!ui.search && clear) clear.remove();
      });
    }
    // 체크박스
    document.getElementById("list").addEventListener("change", e => {
      const box = e.target;
      if (box.type !== "checkbox") return;
      toggleCourse(box.dataset.code, box.checked, box);
    });
  },

  actions: {
    prev() { moveTab(-1); },
    next() { moveTab(1); },
    done() { saveState(); go("status"); },
    clearSearch() { ui.search = ""; render(); },
    leave() {
      const { tabs, tab } = currentTab();
      if (tab.leave) {
        state.leaves = state.leaves.filter(t => t !== tab.term);
        saveState();
        toast(`${tab.term} 휴학을 취소했어요`);
        render();
        return;
      }
      const n = (state.checked[tab.term] || []).length;
      if (n && !confirm(`${tab.term}에 체크한 ${n}과목이 지워져요. 휴학으로 표시할까요?`)) return;
      state.leaves.push(tab.term);
      state.checked[tab.term] = [];
      saveState();
      toast(`${tab.term}을(를) 휴학으로 표시했어요`);
      if (ui.tabIndex < tabs.length - 1) ui.tabIndex += 1;
      ui.search = "";
      render();
    },
    openCustom() { openCustomSheet(); },
    delCustom(el) {
      const c = state.custom.find(x => x.id === el.dataset.id);
      if (!c || !confirm(`'${c.name}'을(를) 삭제할까요?`)) return;
      state.custom = state.custom.filter(x => x.id !== c.id);
      saveState();
      refreshList();
    }
  }
};

function refreshList() {
  const { tab } = currentTab();
  document.getElementById("list").innerHTML = listHTML(tab);
}

function moveTab(step) {
  const { tabs } = currentTab();
  const i = ui.tabIndex + step;
  if (i < 0 || i >= tabs.length) return;
  saveState();
  ui.tabIndex = i;
  ui.search = "";
  render();
  window.scrollTo(0, 0);
}

// 체크/해제 → 지금 보는 학기에 저장
function toggleCourse(code, on, box) {
  const { tab } = currentTab();
  const list = state.checked[tab.term] || (state.checked[tab.term] = []);
  if (on) {
    const other = Logic.findCheckedTerm(state, code, tab.term);
    if (other) {
      box.checked = false;
      toast(`이미 체크한 과목이에요 (${other})`);
      return;
    }
    // 같은 과목(동일교과목)을 이 학기에 이미 체크했으면 저장하지 않음
    if (list.some(c => Logic.courseKey(state.entryYear, c) === Logic.courseKey(state.entryYear, code))) {
      box.checked = false;
      toast(`이미 체크한 과목이에요 (${tab.term})`);
      return;
    }
    list.push(code);
  } else {
    state.checked[tab.term] = list.filter(c => c !== code);
  }
  saveState();
  const row = box.closest(".row");
  if (row) row.classList.toggle("checked", on);
  if (ui.search.trim()) refreshList();
}

// =====================================================================
// 4. 직접 입력 창 (아래에서 올라오는 시트)
// =====================================================================

function customTermOptions() {
  const tabs = Logic.termTabs(state).filter(t => !t.leave);
  const opts = [];
  tabs.forEach(t => {
    opts.push({ value: t.term, label: `${t.term} (${t.label})` });
    const { year, sem } = Logic.parseTerm(t.term);
    if (sem === "1") opts.push({ value: year + "-S", label: Logic.termName(year + "-S") });
    if (sem === "2") opts.push({ value: year + "-W", label: Logic.termName(year + "-W") });
  });
  return opts;
}

function openCustomSheet() {
  const { tab } = currentTab();
  const root = document.getElementById("sheet-root");
  const opts = customTermOptions();
  root.innerHTML = `
    <div class="sheet-backdrop" data-close="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="grip" aria-hidden="true"></div>
        <h2 id="sheet-title">들은 과목 직접 입력</h2>
        <div class="field">
          <label for="c-name">과목명</label>
          <input id="c-name" type="text" maxlength="40" placeholder="예: 컴퓨터활용실습" autocomplete="off">
        </div>
        <div class="field">
          <label for="c-area">영역</label>
          <select id="c-area">${CUSTOM_AREAS.map(a => `<option${a === "일반교양" ? " selected" : ""}>${a}</option>`).join("")}</select>
        </div>
        <div class="field">
          <span class="label" id="c-credit-label">학점</span>
          <div class="seg" role="group" aria-labelledby="c-credit-label">
            ${[1, 2, 3].map(n => `<button type="button" class="choice" data-credit="${n}" aria-pressed="${n === 3}">${n}</button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="c-term">들은 학기</label>
          <select id="c-term">${opts.map(o => `<option value="${o.value}"${o.value === tab.term ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>
        </div>
        <div class="btn-row" style="margin-top:20px">
          <button type="button" class="btn" id="c-cancel">취소</button>
          <button type="button" class="btn btn-primary" style="min-height:48px;font-size:16px" id="c-add" disabled>추가</button>
        </div>
      </div>
    </div>`;

  const name = document.getElementById("c-name");
  const add = document.getElementById("c-add");
  let credit = 3;
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  name.addEventListener("input", () => { add.disabled = !name.value.trim(); });
  root.querySelectorAll("[data-credit]").forEach(b => b.addEventListener("click", () => {
    credit = Number(b.dataset.credit);
    root.querySelectorAll("[data-credit]").forEach(x => x.setAttribute("aria-pressed", x === b));
  }));
  root.querySelector(".sheet-backdrop").addEventListener("click", e => { if (e.target.dataset.close) close(); });
  document.getElementById("c-cancel").addEventListener("click", close);
  add.addEventListener("click", () => {
    const n = name.value.trim();
    if (!n) return;
    const term = document.getElementById("c-term").value;
    state.custom.push({ id: "c" + Date.now(), name: n, area: document.getElementById("c-area").value, credit, term });
    saveState();
    close();
    // 계절학기로 넣었으면 그 앞 학기 탭에서 보이도록 안내
    toast(term.includes("-S") || term.includes("-W") ? `${Logic.termName(term)}에 '${n}'을(를) 추가했어요` : `${term}에 '${n}'을(를) 추가했어요`);
    refreshList();
  });
  name.focus();
}

// =====================================================================
// 5. 학점 현황
// =====================================================================

const ICON_CHECK = `<svg class="ico" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M5.8 10.3l2.7 2.7 5.7-5.9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_EMPTY = `<svg class="ico" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;

function bar(value, max, extra) {
  const pct = max ? Math.min(100, value / max * 100) : 0;
  const ex = extra ? Math.min(100 - pct, extra / max * 100) : 0;
  return `<div class="bar" aria-hidden="true"><span style="width:${pct}%"></span>${ex ? `<span class="soft" style="width:${ex}%"></span>` : ""}</div>`;
}

function areaRow(name, a) {
  return `
    <div class="area">
      <div class="area-head">
        <span><strong>${name}</strong>${a.max ? ` <span class="tiny muted">${a.min}~${a.max}</span>` : ` <span class="tiny muted">${a.min} 이상</span>`}</span>
        <span><strong>${fmt(a.earned)}</strong> / ${a.min}학점</span>
      </div>
      ${bar(a.earned, a.min)}
    </div>`;
}

screens.status = {
  render() {
    const s = Logic.summary(state);
    const c = s.credits;
    const g = c.areas["교양"].detail;
    const detail = ui.detailOpen ? `
      <div class="card" id="detail">
        ${areaRow("기본전공", c.areas["기본전공"])}
        ${areaRow("심화전공", c.areas["심화전공"])}
        ${areaRow("대학특화", c.areas["대학특화"])}
        ${areaRow("교양 전체", c.areas["교양"])}
        <div class="gen-grid">
          <span>기초교양 <strong>${fmt(g["기초교양"])}</strong></span>
          <span>핵심교양 <strong>${fmt(g["핵심교양"])}</strong></span>
          <span>일반교양 <strong>${fmt(g["일반교양"])}</strong></span>
          <span>공학기초 <strong>${fmt(g["공학기초"])}</strong></span>
        </div>
        <ul class="core-list" aria-label="핵심교양 영역">
          ${Object.entries(c.core).map(([sub, v]) => `
            <li class="${v.done ? "done" : ""}">${v.done ? ICON_CHECK : ICON_EMPTY}<span>${sub}</span><span class="sr-only">${v.done ? "들음" : "아직 안 들음"}</span></li>`).join("")}
        </ul>
        ${c.unrecognized > 0 ? `<p class="small muted" style="margin:6px 0 0">인정되지 않은 학점 ${fmt(c.unrecognized)} <span class="tiny">(교양 소영역당 6학점까지만 인정)</span></p>` : ""}
        <div class="free-row"><span>일반선택</span><strong>${fmt(c.free)}학점</strong></div>
      </div>` : "";

    const missing = s.missing.length ? `
      <section class="must" aria-labelledby="must-title">
        <h3 id="must-title">아직 듣지 않은 필수과목 ${s.missing.length}개</h3>
        <ul>${s.missing.map(m => `<li><span>${esc(m.label)}</span><span class="tiny">${fmt(m.credit)}학점${m.grade ? ` · ${m.grade}학년${m.term ? " " + m.term + "학기" : ""}` : ""}</span></li>`).join("")}</ul>
      </section>` : `
      <section class="must done"><h3>필수과목을 모두 들었어요</h3></section>`;

    return `
      ${topbar("학점 현황")}
      <div class="card total">
        <p class="big"><strong>${fmt(c.total)}</strong> / ${c.required} 학점</p>
        ${bar(c.total, c.required)}
        <div class="total-foot"><span>${c.percent}% 완료</span><span>남은 학점 <strong>${fmt(c.remain)}</strong></span></div>
        <p class="tiny muted" style="margin:6px 0 0">${state.entryYear}학번 · 이번 학기 ${state.currentTerm} · 남은 학기 ${s.remainingTerms}</p>
        ${s.delayRisk ? `<p class="warn">이대로면 졸업이 늦어질 수 있어요</p>` : ""}
      </div>
      <button class="btn" data-act="toggle" aria-expanded="${!!ui.detailOpen}" aria-controls="detail" style="margin-bottom:12px">${ui.detailOpen ? "접기" : "구체적으로 보기"}</button>
      ${detail}
      ${missing}
      <div class="bottom">
        <button class="btn btn-primary" data-act="recommend">다음 학기 시간표 추천받기</button>
        <button class="btn" data-act="edit">체크리스트 수정</button>
      </div>`;
  },
  actions: {
    toggle() { ui.detailOpen = !ui.detailOpen; render(); },
    recommend() { ui.draftCond = null; go("conditions"); },
    edit() { ui.search = ""; go("checklist"); }
  }
};

// =====================================================================
// 공통: 조건 칩, 출처 안내, 주간 시간표 격자
// =====================================================================

const DAYS = ["월", "화", "수", "목", "금"];
const GRID_FIRST = 1;  // 1교시 = 09:00
const GRID_LAST = 13;  // 13교시 = 21:00~22:00 (09~22시 고정)
const HOUR_PX = 30;

function condChips(cond) {
  const c = cond || {};
  const chips = [
    c.credits ? `${c.credits}학점` : "학점 상관없음",
    c.freeDay ? `${c.freeDay}요일 공강` : "공강 상관없음",
    c.timeOff ? `${c.timeOff} 제외` : "오전·오후 상관없음"
  ];
  return `<div class="chips" aria-label="고른 조건">${chips.map((t, i) => `<span class="chip${[c.credits, c.freeDay, c.timeOff][i] ? "" : " gray"}">${t}</span>`).join("")}</div>`;
}

function sourceNote(sourceTerm) {
  return sourceTerm ? `<p class="source-note">${sourceTerm} 개설 강좌 기준으로 추천했어요</p>` : "";
}

function areaClass(area) {
  if (area === "기본전공" || area === "심화전공") return "major";
  if (area === "대학특화") return "special";
  if (["기초교양", "핵심교양", "일반교양", "공학기초"].includes(area)) return "general";
  return "etc";
}

// 교수 이름이 여러 명이면 "김진수 외 4"
function profShort(prof) {
  if (!prof) return "";
  const ps = prof.split(",").map(s => s.trim()).filter(Boolean);
  return ps.length > 1 ? `${ps[0]} 외 ${ps.length - 1}` : ps[0];
}

// 연속된 교시끼리 묶기: [1,2,4] → [[1,2],[4]]
function runs(periods) {
  const ps = periods.slice().sort((a, b) => a - b);
  const out = [];
  ps.forEach(p => {
    const last = out[out.length - 1];
    if (last && p === last[last.length - 1] + 1) last.push(p); else out.push([p]);
  });
  return out;
}

function weekGrid(sections) {
  const days = DAYS.slice();
  const all = sections.flatMap(o => o.slots || []);
  if (all.some(s => s.day === "토")) days.push("토");
  if (all.some(s => s.day === "일")) days.push("일");
  const last = Math.max(GRID_LAST, ...all.flatMap(s => s.periods));
  const rows = last - GRID_FIRST + 1;
  const h = rows * HOUR_PX;
  const times = Array.from({ length: rows }, (_, i) => `<span style="top:${i * HOUR_PX}px">${8 + GRID_FIRST + i}</span>`).join("");
  const cols = days.map(d => {
    const blocks = [];
    sections.forEach(o => (o.slots || []).filter(s => s.day === d).forEach(s => runs(s.periods).forEach(r => {
      const prof = profShort(o.prof);
      blocks.push(`
        <div class="blk ${areaClass(o.area)}" style="top:${(r[0] - GRID_FIRST) * HOUR_PX}px;height:${r.length * HOUR_PX}px">
          <strong>${esc(o.name)}</strong>${prof ? `<span>${esc(prof)}</span>` : ""}
        </div>`);
    })));
    const free = !blocks.length && DAYS.includes(d);
    return `<div class="tt-col${free ? " free" : ""}" style="height:${h}px">${free ? `<span class="free-label">공강</span>` : blocks.join("")}</div>`;
  }).join("");
  const label = sections.map(o => `${o.name} ${Logic.slotText(o.slots)}`).join(", ");
  return `
    <div class="tt" style="--cols:${days.length}" role="img" aria-label="주간 시간표: ${esc(label)}">
      <div class="tt-head"><span></span>${days.map(d => `<span>${d}</span>`).join("")}</div>
      <div class="tt-body" style="--hour:${HOUR_PX}px">
        <div class="tt-times" style="height:${h}px">${times}</div>
        ${cols}
      </div>
    </div>`;
}

// 개설 강좌 id → 강좌 (id 앞 6글자가 학기)
function offeringById(id) {
  return Logic.findOffering(id.slice(0, 6), id);
}

function sectionCount(sourceTerm, code) {
  return ((DATA.offerings[sourceTerm] || []).filter(o => o.code === code)).length;
}

// 조건 때문에 빠진 필수과목 안내 (판단 규칙 4)
function blockedBox(blocked, withButton) {
  if (!blocked || !blocked.length) return "";
  return `
    <section class="must blocked" aria-labelledby="blocked-title">
      <h3 id="blocked-title">조건 때문에 빠진 필수과목이 있어요</h3>
      <ul>${blocked.map(b => `<li><span>필수과목 <strong>${esc(b.name)}</strong>이(가) ${esc(b.reason)}이라 빠졌어요.</span></li>`).join("")}</ul>
      <p class="small" style="margin:8px 0 0">조건을 바꾸면 넣을 수 있어요.</p>
      ${withButton ? `<button class="btn" data-act="recond" style="margin-top:10px">조건 다시 선택하기</button>` : ""}
    </section>`;
}

function runRecommend() {
  ui.result = Logic.recommend(state);
  ui.planIndex = 0;
  return ui.result;
}

// =====================================================================
// 6. 조건 선택
// =====================================================================

const COND_OPTIONS = {
  credits: { label: "희망 학점", values: [15, 16, 17, 18, 19], text: v => v + "학점" },
  freeDay: { label: "희망 공강 요일", values: ["월", "화", "수", "목", "금"], text: v => v },
  timeOff: { label: "오전·오후 수업 제외", values: ["오전", "오후"], text: v => v + " 제외" }
};

screens.conditions = {
  render() {
    if (!ui.draftCond) ui.draftCond = Object.assign({ credits: null, freeDay: null, timeOff: null }, state.conditions);
    const next = Logic.nextTerm(state.currentTerm);
    const source = Logic.offeringSourceTerm(next);
    const d = ui.draftCond;
    const group = key => {
      const o = COND_OPTIONS[key];
      const opts = o.values.map(v => ({ v, t: o.text(v) })).concat([{ v: null, t: "상관없음" }]);
      return `
        <fieldset class="cond">
          <legend>${o.label}</legend>
          <div class="cond-opts ${key}">
            ${opts.map(x => `<button class="choice" data-act="pick" data-key="${key}" data-val="${x.v === null ? "" : x.v}" aria-pressed="${d[key] === x.v}">${x.t}</button>`).join("")}
          </div>
        </fieldset>`;
    };
    return `
      ${topbar(next + " 시간표 조건")}
      ${sourceNote(source)}
      ${group("credits")}
      ${group("freeDay")}
      ${group("timeOff")}
      <p class="tiny muted">학점을 '상관없음'으로 두면 남은 학점과 남은 학기로 정해요 (12~19학점).</p>
      <div class="bottom"><button class="btn btn-primary" data-act="submit">추천받기</button></div>`;
  },
  actions: {
    pick(el) {
      const key = el.dataset.key;
      const raw = el.dataset.val;
      ui.draftCond[key] = raw === "" ? null : (key === "credits" ? Number(raw) : raw);
      render();
    },
    submit() {
      state.conditions = Object.assign({}, ui.draftCond);
      state.excluded = [];
      saveState();
      const r = runRecommend();
      ui.draftCond = null;
      go(r.plans.length ? "result" : "none");
    }
  }
};

// 6번으로 돌아가기 (이전 조건이 선택된 상태)
function backToConditions() {
  ui.draftCond = null;
  go("conditions");
}

// =====================================================================
// 6-1. 조건에 맞는 시간표 없음 (판단 규칙 1)
// =====================================================================

screens.none = {
  render() {
    const r = ui.result || runRecommend();
    return `
      ${topbar("")}
      <section class="notice">
        <h2>조건에 맞는 시간표가 없어요</h2>
        <p class="muted">고른 조건이 너무 많아 만들 수 있는 시간표가 0개예요. 조건을 하나만 바꿔 보세요.</p>
        <p class="small" style="margin:16px 0 6px"><strong>지금 고른 조건</strong></p>
        ${condChips(r.conditions)}
      </section>
      ${blockedBox(r.blocked, false)}
      <div class="bottom"><button class="btn btn-primary" data-act="recond">조건 다시 선택하기</button></div>`;
  },
  actions: { recond: backToConditions }
};

// =====================================================================
// 7. 추천 시간표
// =====================================================================

screens.result = {
  render() {
    const r = ui.result || runRecommend();
    if (!r.plans.length) { ui.screen = "allShown"; return screens.allShown.render(); }
    ui.planIndex = Math.min(ui.planIndex || 0, r.plans.length - 1);
    const p = r.plans[ui.planIndex];
    const req = new Set(p.requiredCodes);
    const tabs = r.plans.map((q, i) => `
      <button role="tab" id="tab-${i}" class="tab" data-act="plan" data-i="${i}" aria-selected="${i === ui.planIndex}" aria-controls="plan-panel">${"ABC"[i]}안 · ${fmt(q.credits)}학점</button>`).join("");
    const list = p.sections.map(o => {
      const n = sectionCount(r.sourceTerm, o.code);
      return `
        <div class="row">
          <span class="name"><strong>${esc(o.name)}</strong>${req.has(o.code) ? `<span class="badge req">필수</span>` : ""}
            <span class="meta">${esc(Logic.slotText(o.slots))} · ${esc(o.sub && o.sub !== "공통기초" ? o.area + "·" + o.sub : o.area)} · ${fmt(o.credit)}학점</span>
            <span class="meta">${esc(o.prof ? profShort(o.prof) : "")}${o.prof && o.room ? " · " : ""}${esc(o.room || "")}${n > 1 ? ` · ${n}개 분반 중 ${esc(o.section)}분반` : ""}</span></span>
          <button class="btn-small" data-act="drop" data-id="${esc(o.id)}" aria-label="${esc(o.name)} 빼기">빼기</button>
        </div>`;
    }).join("");
    return `
      ${topbar(r.term + " 추천 시간표")}
      ${sourceNote(r.sourceTerm)}
      ${condChips(r.conditions)}
      ${blockedBox(r.blocked, true)}
      <div class="tabs" role="tablist" aria-label="추천 시간표">${tabs}</div>
      <div id="plan-panel" role="tabpanel" aria-labelledby="tab-${ui.planIndex}">
        ${weekGrid(p.sections)}
        <div class="legend tiny"><span class="lg major"></span>전공 <span class="lg special"></span>대학특화 <span class="lg general"></span>교양</div>
        <div class="list" style="margin-top:12px">${list}</div>
      </div>
      <div class="bottom">
        <button class="btn btn-primary" data-act="choose">이 시간표로 할게요</button>
        <button class="btn" data-act="recond">조건 다시 선택하기</button>
      </div>`;
  },
  actions: {
    plan(el) { ui.planIndex = Number(el.dataset.i); render(); },
    drop(el) {
      const o = offeringById(el.dataset.id);
      if (!state.excluded.includes(el.dataset.id)) state.excluded.push(el.dataset.id);
      saveState();
      const r = runRecommend();
      if (o) toast(`${o.name}을(를) 뺐어요`);
      if (!r.plans.length) go("allShown", { replace: true }); else render();
    },
    choose() {
      const r = ui.result;
      const p = r.plans[ui.planIndex];
      if (state.myTimetable && state.myTimetable.offeringIds.join() !== p.offeringIds.join()) {
        if (!confirm("저장한 내 시간표가 이 시간표로 바뀌어요. 바꿀까요?")) return;
      }
      state.myTimetable = { term: r.term, offeringIds: p.offeringIds.slice() };
      saveState();
      go("mine");
    },
    recond: backToConditions
  }
};

// =====================================================================
// 7-1. 추천 시간표 모두 보여 줌 (판단 규칙 2)
// =====================================================================

screens.allShown = {
  render() {
    const names = [...new Set(state.excluded.map(id => (offeringById(id) || { name: id }).name))];
    return `
      ${topbar("")}
      <section class="notice">
        <h2>조건에 맞는 시간표를 모두 보여드렸어요</h2>
        <p class="muted">뺀 과목을 빼고 더 만들 수 있는 시간표가 없어요.</p>
        <p class="small" style="margin:16px 0 6px"><strong>지금까지 뺀 과목</strong></p>
        <ul class="struck">${names.map(n => `<li><s>${esc(n)}</s></li>`).join("")}</ul>
      </section>
      <div class="bottom">
        <button class="btn btn-primary" data-act="again">추천 시간표 다시 보기</button>
        <button class="btn" data-act="recond">조건 다시 선택하기</button>
      </div>`;
  },
  actions: {
    again() {
      state.excluded = [];
      saveState();
      const r = runRecommend();
      go(r.plans.length ? "result" : "none", { replace: true });
    },
    recond: backToConditions
  }
};

// =====================================================================
// 8. 내 시간표 (7단계)
// =====================================================================

// 내 시간표 과목을 다음 학기에 들은 것으로 친 가상 상태
function stateWithMine(sections, term) {
  const s = JSON.parse(JSON.stringify(state));
  s.checked[term] = (s.checked[term] || []).concat(sections.map(o => o.code));
  return s;
}

screens.mine = {
  render() {
    const mt = state.myTimetable;
    if (!mt) {
      return `${topbar("내 시간표")}
        <div class="card"><p class="muted" style="margin:0">저장한 시간표가 없어요.</p></div>
        <div class="bottom"><button class="btn" data-act="status">학점 현황 보기</button></div>`;
    }
    const sections = mt.offeringIds.map(offeringById).filter(Boolean);
    const before = Logic.calcCredits(state);
    const futureState = stateWithMine(sections, mt.term);
    const after = Logic.calcCredits(futureState);
    const missingAfter = Logic.missingRequired(futureState, after);
    const thisTerm = Math.round((after.total - before.total) * 10) / 10;

    // 영역별 학점 합
    const byArea = {};
    sections.forEach(o => { byArea[o.area] = (byArea[o.area] || 0) + o.credit; });
    const order = ["기본전공", "심화전공", "대학특화", "기초교양", "핵심교양", "일반교양", "공학기초", "일반선택"];
    const total = sections.reduce((s, o) => s + o.credit, 0);

    return `
      ${topbar("내 시간표 · " + esc(mt.term))}
      ${sourceNote(mt.offeringIds[0] ? mt.offeringIds[0].slice(0, 6) : null)}
      ${weekGrid(sections)}
      <div class="legend tiny"><span class="lg major"></span>전공 <span class="lg special"></span>대학특화 <span class="lg general"></span>교양</div>
      <div class="card" style="margin-top:12px">
        <div class="area-sum">
          ${order.filter(a => byArea[a]).map(a => `<span><span class="dotc ${areaClass(a)}"></span>${a} <strong>${fmt(byArea[a])}</strong></span>`).join("")}
        </div>
        <p class="small muted" style="margin:8px 0 0">이번 학기 합계 ${fmt(total)}학점 · ${sections.length}과목</p>
      </div>
      <div class="card total">
        <p style="margin:0;font-size:16px">이 시간표까지 들으면</p>
        <p class="big"><strong>${fmt(before.total)} → ${fmt(after.total)}</strong> / ${after.required} 학점</p>
        ${bar(before.total, after.required, thisTerm)}
        <div class="legend tiny" style="margin:2px 0 6px"><span class="lg done"></span>들은 학점 <span class="lg soon"></span>이번 학기</div>
        <p style="margin:0">남은 학점 <strong>${fmt(after.remain)}</strong> · 남은 필수과목 <strong>${missingAfter.length}</strong>개</p>
        ${missingAfter.length ? `<p class="tiny muted" style="margin:4px 0 0">${missingAfter.map(m => esc(m.label)).join(", ")}</p>` : ""}
      </div>
      <div class="list" style="margin-bottom:12px">
        ${sections.map(o => `
          <div class="row">
            <span class="name"><strong>${esc(o.name)}</strong>
              <span class="meta">${esc(Logic.slotText(o.slots))} · ${esc(o.area)} · ${fmt(o.credit)}학점${o.room ? " · " + esc(o.room) : ""}</span></span>
          </div>`).join("")}
      </div>
      <div class="test-box">
        <p class="tiny muted" style="margin:0 0 6px">테스트 버튼</p>
        <div class="btn-row">
          <button class="btn" data-act="moveNext">다음 학기로 이동</button>
          <button class="btn danger" data-act="resetAll">처음부터 다시</button>
        </div>
      </div>
      <div class="bottom"><button class="btn btn-primary" data-act="status">학점 현황 보기</button></div>`;
  },
  actions: {
    status() { go("status"); },

    // 테스트 버튼: 내 시간표 과목을 새 학기 탭에 '들은 과목'으로 넣고 한 학기 넘기기
    moveNext() {
      const mt = state.myTimetable;
      const sections = mt.offeringIds.map(offeringById).filter(Boolean);
      if (!confirm(`내 시간표 ${sections.length}과목을 ${mt.term}에 들은 과목으로 넣고, 이번 학기를 ${mt.term}(으)로 넘길까요?`)) return;
      const list = state.checked[mt.term] || (state.checked[mt.term] = []);
      sections.forEach(o => {
        if (!list.includes(o.code) && !Logic.findCheckedTerm(state, o.code, mt.term)) list.push(o.code);
      });
      state.currentTerm = mt.term;
      state.myTimetable = null;  // 사용자 결정: 내 시간표·뺀 과목은 비우고 조건은 남김
      state.excluded = [];
      saveState();
      ui.result = null;
      ui.history = ["start"];
      ui.screen = "status";
      render();
      window.scrollTo(0, 0);
      toast(`${mt.term} 학기로 이동했어요`);
    },

    resetAll() {
      if (!confirm("기록이 모두 지워져요. 처음부터 다시 할까요?")) return;
      clearState();
      Object.assign(ui, { history: [], tabIndex: 0, search: "", draftYear: null, draftCond: null, result: null, planIndex: 0, detailOpen: false });
      ui.screen = "start";
      render();
      window.scrollTo(0, 0);
    }
  }
};

// ---------------------------------------------------------------
// 시작
// ---------------------------------------------------------------
restoreScreen();
render();
