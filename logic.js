// =====================================================================
// logic.js — 학기·학년 계산, 학점 계산, 필수과목 계산 (화면 코드와 분리)
// 데이터: window.DATA (data/*.js), 상태: app.js 가 넘겨 주는 state 객체 (CLAUDE.md 5장)
// =====================================================================

// 개발·테스트용: 오늘 날짜를 고정하려면 "2026-11-19" 처럼 적는다. null 이면 실제 오늘 날짜
const TODAY_OVERRIDE = null;

const Logic = (function () {
  const D = () => window.DATA;
  const R = () => window.DATA.requirements;

  // ---------------------------------------------------------------
  // 1. 학기 계산 (6-1)
  // ---------------------------------------------------------------

  function getToday() {
    if (TODAY_OVERRIDE) {
      const [y, m, d] = TODAY_OVERRIDE.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }

  // 3~8월 → 올해-1, 9~12월 → 올해-2, 1~2월 → 작년-2
  function getCurrentTerm(date) {
    const d = date || getToday();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (m >= 3 && m <= 8) return y + "-1";
    if (m >= 9) return y + "-2";
    return (y - 1) + "-2";
  }

  function parseTerm(term) {
    const [y, s] = term.split("-");
    return { year: Number(y), sem: s }; // sem: "1" | "2" | "S"(여름) | "W"(겨울)
  }

  function nextTerm(term) {
    const { year, sem } = parseTerm(term);
    return sem === "1" ? year + "-2" : (year + 1) + "-1";
  }

  function prevTerm(term) {
    const { year, sem } = parseTerm(term);
    return sem === "2" ? year + "-1" : (year - 1) + "-2";
  }

  // 학기 순서 비교용 숫자 (계절학기: 여름은 1학기 뒤, 겨울은 2학기 뒤)
  function termOrder(term) {
    const { year, sem } = parseTerm(term);
    return year * 10 + ({ "1": 1, "S": 2, "2": 3, "W": 4 }[sem] || 0);
  }

  // "2025-S" → "2025 여름학기"
  function termName(term) {
    const { year, sem } = parseTerm(term);
    if (sem === "S") return year + " 여름학기";
    if (sem === "W") return year + " 겨울학기";
    return term;
  }

  // ---------------------------------------------------------------
  // 2. 학기 탭과 학년 (6-2)
  // ---------------------------------------------------------------

  // 입학년도-1 부터 이번 학기까지 모든 학기 (계절학기 제외)
  function listTerms(entryYear, currentTerm) {
    const list = [];
    let t = entryYear + "-1";
    while (termOrder(t) <= termOrder(currentTerm)) {
      list.push(t);
      t = nextTerm(t);
    }
    return list;
  }

  // k(다닌 학기 순번) → 학년·학기
  function gradeOfK(k) {
    return { grade: Math.min(4, Math.ceil(k / 2)), sem: k % 2 === 1 ? 1 : 2 };
  }

  // 탭 정보: [{ term, leave, k, grade, sem, label }]
  function termTabs(state) {
    const leaves = state.leaves || [];
    let k = 0;
    return listTerms(state.entryYear, state.currentTerm).map(term => {
      const leave = leaves.includes(term);
      if (leave) return { term, leave: true, k: null, grade: null, sem: null, label: "휴학" };
      k += 1;
      const g = gradeOfK(k);
      return { term, leave: false, k, grade: g.grade, sem: g.sem, label: g.grade + "학년 " + g.sem + "학기" };
    });
  }

  // 지금까지 다닌 학기 수 (이번 학기 포함, 휴학 제외)
  function attendedCount(state) {
    return termTabs(state).filter(t => !t.leave).length;
  }

  // 남은 학기 = max(1, 8 − 다닌 학기 수)
  function remainingTerms(state) {
    return Math.max(1, R().totalTerms - attendedCount(state));
  }

  // 다음 학기의 학년·학기
  function nextTermInfo(state) {
    const term = nextTerm(state.currentTerm);
    const g = gradeOfK(attendedCount(state) + 1);
    return { term, grade: g.grade, sem: g.sem, label: g.grade + "학년 " + g.sem + "학기" };
  }

  // ---------------------------------------------------------------
  // 3. 과목 찾기와 동일 과목 연결
  // ---------------------------------------------------------------

  // 과목 사전: 코드 → { code, name, area, sub, credit, kind }
  // 입학년도 교육과정·교양을 먼저, 없으면 다른 연도, 그래도 없으면 개설 강좌(최근 학기 우선)에서 찾는다
  const catalogCache = {};
  function catalog(entryYear) {
    if (catalogCache[entryYear]) return catalogCache[entryYear];
    const map = {};
    const add = (code, info) => { if (code && !map[code]) map[code] = info; };
    const years = [entryYear].concat(Object.keys(D().curriculum).map(Number).filter(y => y !== entryYear).sort((a, b) => b - a));
    years.forEach(y => {
      (D().curriculum[y] || []).forEach(c => add(c.code, { code: c.code, name: c.name, area: c.area, sub: null, credit: c.credit, kind: "major", oldName: c.oldName || null }));
      (D().general[y] || []).forEach(c => add(c.code, { code: c.code, name: c.name, area: c.area, sub: c.sub, credit: c.credit, kind: "general" }));
    });
    Object.keys(D().offerings || {}).sort((a, b) => termOrder(b) - termOrder(a)).forEach(t => {
      D().offerings[t].forEach(o => add(o.code, { code: o.code, name: o.name, area: o.area || "일반선택", sub: o.sub, credit: o.credit, kind: "offering" }));
    });
    catalogCache[entryYear] = map;
    return map;
  }

  function findCourse(entryYear, code) {
    return catalog(entryYear)[code] || null;
  }

  // 동일교과목(sameCourses) + 그 학번의 교양 동일대치표(generalSame)로 같은 과목 묶기
  const rootCache = {};
  function sameRoots(entryYear) {
    if (rootCache[entryYear]) return rootCache[entryYear];
    const parent = {};
    const find = c => { while (parent[c] && parent[c] !== c) c = parent[c]; return c; };
    const union = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };
    (D().sameCourses || []).forEach(([a, b]) => union(a, b));
    ((D().generalSame || {})[entryYear] || []).forEach(([a, b]) => union(a, b));
    rootCache[entryYear] = find;
    return find;
  }

  // 같은 과목이면 같은 값이 나오는 키
  function courseKey(entryYear, code) {
    return sameRoots(entryYear)(code);
  }

  // 이 과목(또는 같은 과목)을 이미 체크한 학기. 없으면 null (exceptTerm 학기는 빼고 찾음)
  function findCheckedTerm(state, code, exceptTerm) {
    const key = courseKey(state.entryYear, code);
    const checked = state.checked || {};
    for (const term of Object.keys(checked)) {
      if (term === exceptTerm) continue;
      if ((checked[term] || []).some(c => courseKey(state.entryYear, c) === key)) return term;
    }
    return null;
  }

  // ---------------------------------------------------------------
  // 4. 들은 과목 모으기 (6-3)
  // ---------------------------------------------------------------

  // [{ key, code, name, area, sub, credit, term, source }] — 같은 과목은 한 번만
  function takenCourses(state) {
    const list = [];
    const seen = new Set();
    const leaves = state.leaves || [];
    const checked = state.checked || {};
    Object.keys(checked).sort((a, b) => termOrder(a) - termOrder(b)).forEach(term => {
      if (leaves.includes(term)) return;
      (checked[term] || []).forEach(code => {
        const key = courseKey(state.entryYear, code);
        if (seen.has(key)) return;
        const info = findCourse(state.entryYear, code);
        if (!info) { console.warn("과목 정보를 찾지 못함:", code); return; }
        seen.add(key);
        list.push({ key, code, name: info.name, area: info.area, sub: info.sub, credit: info.credit, term, source: info.kind });
      });
    });
    (state.custom || []).forEach(c => {
      list.push({ key: "custom:" + c.id, code: null, name: c.name, area: c.area, sub: c.sub || null, credit: Number(c.credit), term: c.term, source: "custom" });
    });
    return list;
  }

  // 들은 과목 키 집합 (같은 과목 포함 판단용)
  function takenKeySet(state) {
    return new Set(takenCourses(state).map(c => c.key));
  }

  function isTaken(state, code, keySet) {
    return (keySet || takenKeySet(state)).has(courseKey(state.entryYear, code));
  }

  // ---------------------------------------------------------------
  // 5. 학점 계산 (6-3, 6-4, 6-5 소영역 상한, 7-1 범위)
  // ---------------------------------------------------------------

  const round = n => Math.round(n * 10) / 10; // 0.5학점(2022 진로설계) 대비

  function calcCredits(state) {
    const req = R();
    const courses = takenCourses(state);
    const raw = { "기본전공": 0, "심화전공": 0, "대학특화": 0, "기초교양": 0, "핵심교양": 0, "일반교양": 0, "공학기초": 0, "일반선택": 0 };
    const subSum = {}; // "핵심교양|분석과 판단" → 학점

    courses.forEach(c => {
      const area = raw[c.area] !== undefined ? c.area : "일반선택";
      raw[area] += c.credit;
      if (req.generalAreas.includes(area) && c.sub && !req.subCapExempt.includes(c.sub)) {
        const k = area + "|" + c.sub;
        subSum[k] = (subSum[k] || 0) + c.credit;
      }
    });

    // 교양 소영역 상한: 소영역당 6학점까지만 인정, 넘는 학점은 총 학점에서도 뺀다
    const unrecognizedBySub = {};
    let unrecognized = 0;
    Object.keys(subSum).forEach(k => {
      const over = subSum[k] - req.subCap;
      if (over > 0) {
        unrecognizedBySub[k] = over;
        unrecognized += over;
        raw[k.split("|")[0]] -= over;
      }
    });

    // 전공 영역: 범위 최대값을 넘는 학점은 일반선택으로
    const areas = {};
    let overflowToFree = 0;
    ["기본전공", "심화전공", "대학특화"].forEach(a => {
      const { min, max } = req.areas[a];
      const earned = Math.min(raw[a], max);
      overflowToFree += raw[a] - earned;
      areas[a] = { earned: round(earned), min, max, remain: round(Math.max(0, min - earned)), raw: round(raw[a]) };
    });

    // 교양 전체
    const gen = {};
    req.generalAreas.forEach(a => { gen[a] = round(raw[a]); });
    const genTotal = req.generalAreas.reduce((s, a) => s + raw[a], 0);
    areas["교양"] = { earned: round(genTotal), min: req.areas["교양"].min, max: null, remain: round(Math.max(0, req.areas["교양"].min - genTotal)), detail: gen };

    // 핵심교양 3개 영역 충족 여부
    const core = {};
    req.coreSubs.forEach(s => {
      const credit = Math.min(subSum["핵심교양|" + s] || 0, req.subCap);
      core[s] = { credit, done: credit >= req.coreMinPerSub };
    });

    const free = raw["일반선택"] + overflowToFree;
    const total = areas["기본전공"].earned + areas["심화전공"].earned + areas["대학특화"].earned + genTotal + free;

    // 남은 학점 = max(130 − 총 학점, 영역별 모자란 학점 합) (사용자 확인)
    // 총 학점을 채웠어도 교양 33 같은 영역 기준이 모자라면 졸업할 수 없으므로
    const areaShort = ["기본전공", "심화전공", "대학특화", "교양"].reduce((s, a) => s + areas[a].remain, 0);

    return {
      total: round(total),
      required: req.total,
      remain: round(Math.max(0, req.total - total, areaShort)),
      remainTotalOnly: round(Math.max(0, req.total - total)),
      areaShort: round(areaShort),
      percent: Math.min(100, Math.floor(total / req.total * 100)),
      areas,
      free: round(free),
      core,
      unrecognized: round(unrecognized),
      unrecognizedBySub,
      courses
    };
  }

  // ---------------------------------------------------------------
  // 6. 아직 듣지 않은 필수과목 (6-5)
  // ---------------------------------------------------------------

  // [{ type: "major"|"general"|"choice"|"core"|"basic", label, codes, credit, area, grade, term }]
  function missingRequired(state, credits) {
    const req = R();
    const year = state.entryYear;
    const keys = takenKeySet(state);
    const taken = code => isTaken(state, code, keys);
    const cr = credits || calcCredits(state);
    const list = [];
    const listed = new Set();
    const push = item => {
      const k = item.codes.join(",");
      if (listed.has(k)) return;
      listed.add(k);
      list.push(item);
    };

    // 전공 필수 (특화필수·심화필수 등)
    (D().curriculum[year] || []).filter(c => c.required && !taken(c.code)).forEach(c => {
      push({ type: "major", label: c.name, codes: [c.code], credit: c.credit, area: c.area, grade: c.grade, term: c.term });
    });

    // 교양 필수 (전공 교육과정의 교양필수 줄) + 택1 묶음
    const genList = D().general[year] || [];
    (D().requiredGeneral[year] || []).forEach(g => {
      if (g.choice) {
        const codes = (req.choiceGroups[g.choice] || []).filter(code => code === g.code || genList.some(x => x.code === code));
        if (codes.some(taken)) return;
        const names = codes.map(code => (genList.find(x => x.code === code) || { name: code }).name);
        push({ type: "choice", label: names.join(" / ") + " 중 1과목", codes, credit: g.credit, area: "기초교양", grade: g.grade, term: g.term });
      } else if (!taken(g.code)) {
        const info = genList.find(x => x.code === g.code);
        push({ type: "general", label: info ? info.name : g.name, codes: [g.code], credit: g.credit, area: info ? info.area : "교양", grade: g.grade, term: g.term });
      }
    });

    // 핵심교양: 비어 있는 영역
    req.coreSubs.forEach(s => {
      if (!cr.core[s].done) push({ type: "core", label: "핵심교양: " + s + " 영역", codes: ["core:" + s], credit: req.coreMinPerSub, area: "핵심교양", sub: s });
    });

    // 기초 → 본 과목
    req.basicToMain.forEach(r => {
      if (taken(r.basic) && !taken(r.main)) {
        const info = genList.find(x => x.code === r.main) || findCourse(year, r.main);
        push({ type: "basic", label: info ? info.name : r.main, codes: [r.main], credit: info ? info.credit : 3, area: info ? info.area : "공학기초" });
      }
    });

    return list;
  }

  // ---------------------------------------------------------------
  // 7. 졸업 지연 경고 (판단 규칙 3)
  // ---------------------------------------------------------------

  function isDelayRisk(state, credits) {
    const cr = credits || calcCredits(state);
    return cr.remain / remainingTerms(state) > R().delayLimit;
  }

  // 5번 화면에 필요한 값을 한 번에
  function summary(state) {
    const credits = calcCredits(state);
    return {
      credits,
      missing: missingRequired(state, credits),
      remainingTerms: remainingTerms(state),
      delayRisk: isDelayRisk(state, credits),
      next: nextTermInfo(state)
    };
  }

  // ---------------------------------------------------------------
  // 8. 다음 학기 목표 학점 (6-6)
  // ---------------------------------------------------------------

  function targetCredits(state, credits) {
    const req = R();
    const cr = credits || calcCredits(state);
    // 학점은 다 채웠어도 아직 안 들은 필수과목이 있으면 그 학점만큼은 들어야 함
    const missingCredits = missingRequired(state, cr).reduce((s, m) => s + (m.credit || 0), 0);
    const need = Math.max(cr.remain, missingCredits);
    let t = state.conditions && state.conditions.credits;
    if (!t) {
      t = Math.ceil(need / remainingTerms(state));
      t = Math.max(req.targetMin, Math.min(req.targetMax, t));
    }
    return Math.min(t, need);
  }

  // ---------------------------------------------------------------
  // 9. 개설 강좌 도우미 (7-4)
  // ---------------------------------------------------------------

  // 다음 학기 추천에 쓸 개설 강좌 학기: 가장 최근의 같은 학기 파일 (2027-1 → 2026-1)
  function offeringSourceTerm(nextT) {
    const sem = parseTerm(nextT).sem;
    const terms = Object.keys(D().offerings || {})
      .filter(t => parseTerm(t).sem === sem && termOrder(t) <= termOrder(nextT))
      .sort((a, b) => termOrder(b) - termOrder(a));
    return terms[0] || null;
  }

  // n교시 = (8 + n)시 시작, 1시간
  const periodStart = p => 8 + p;
  const hhmm = h => String(h).padStart(2, "0") + ":00";

  // [{day, periods}] → "월 14:00–17:00, 수 09:00–11:00"
  function slotText(slots) {
    if (!slots || !slots.length) return "시간 미정";
    return slots.map(s => {
      const ps = s.periods.slice().sort((a, b) => a - b);
      return s.day + " " + hhmm(periodStart(ps[0])) + "–" + hhmm(periodStart(ps[ps.length - 1]) + 1);
    }).join(", ");
  }

  const AM_LAST = 3; // 오전 = 1~3교시

  // 조건(공강 요일, 오전/오후 제외)에 걸리는 이유 목록. 없으면 []
  function conditionConflicts(o, cond) {
    const out = [];
    (o.slots || []).forEach(s => {
      if (cond.freeDay && s.day === cond.freeDay) out.push({ type: "freeDay", label: s.day + "요일 수업", detail: null });
      if (cond.timeOff === "오전") {
        const ps = s.periods.filter(p => p <= AM_LAST);
        if (ps.length) out.push({ type: "timeOff", label: "오전 수업", detail: s.day + " " + rangeText(ps) + "교시" });
      }
      if (cond.timeOff === "오후") {
        const ps = s.periods.filter(p => p > AM_LAST);
        if (ps.length) out.push({ type: "timeOff", label: "오후 수업", detail: s.day + " " + rangeText(ps) + "교시" });
      }
    });
    return out;
  }

  // [{label, detail}] → "오전 수업(월 1–2교시, 토 1–3교시), 금요일 수업"
  function reasonText(conflicts) {
    const byLabel = new Map();
    conflicts.forEach(c => {
      if (!byLabel.has(c.label)) byLabel.set(c.label, []);
      if (c.detail && !byLabel.get(c.label).includes(c.detail)) byLabel.get(c.label).push(c.detail);
    });
    return [...byLabel].map(([label, ds]) => ds.length ? label + "(" + ds.join(", ") + ")" : label).join(", ");
  }

  function rangeText(ps) {
    const a = ps.slice().sort((x, y) => x - y);
    return a.length > 1 ? a[0] + "–" + a[a.length - 1] : String(a[0]);
  }

  // 두 강좌의 시간이 겹치는지
  function overlaps(a, b) {
    return a.slots.some(sa => b.slots.some(sb => sa.day === sb.day && sa.periods.some(p => sb.periods.includes(p))));
  }

  // ---------------------------------------------------------------
  // 10. 시간표 추천 (6-7)
  // ---------------------------------------------------------------

  const SEARCH_LIMIT = 20000;

  function recommend(state) {
    const req = R();
    const cr = calcCredits(state);
    const next = nextTermInfo(state);
    const source = offeringSourceTerm(next.term);
    const cond = Object.assign({ credits: null, freeDay: null, timeOff: null }, state.conditions || {});
    const target = targetCredits(state, cr);
    const result = { term: next.term, grade: next.grade, sourceTerm: source, target, min: Math.max(1, target - 2), plans: [], blocked: [], conditions: cond, reason: null };
    // 시간표가 0개일 때 이유: "graduated"(졸업 요건 다 채움) | "noSource"(개설 강좌 자료 없음) | "conditions"(조건 때문) | "noCandidates"(추천할 과목 없음)
    if (target <= 0) { result.reason = "graduated"; return result; }
    if (!source) { result.reason = "noSource"; return result; }

    const keys = takenKeySet(state);
    const key = code => courseKey(state.entryYear, code);
    const excludedCodes = new Set((state.excluded || []).map(id => (findOffering(source, id) || {}).code).filter(Boolean));

    // 아직 안 들은 필수과목 (과목 키 → 이름)
    const missing = missingRequired(state, cr);
    const requiredKeys = new Map();
    missing.forEach(m => m.codes.forEach(c => { if (!c.startsWith("core:")) requiredKeys.set(key(c), m.label); }));
    const emptyCore = new Set(req.coreSubs.filter(s => !cr.core[s].done));

    // 교양 소영역별로 이미 인정된 학점 (6학점 상한 판단용)
    const subUsed = {};
    cr.courses.forEach(c => {
      if (req.generalAreas.includes(c.area) && c.sub && !req.subCapExempt.includes(c.sub)) {
        subUsed[c.area + "|" + c.sub] = (subUsed[c.area + "|" + c.sub] || 0) + c.credit;
      }
    });
    const genRemain = cr.areas["교양"].remain;
    const noTwo = new RegExp(req.noRecommendGeneralPattern);
    // 택1 묶음 중 하나라도 들었으면 그 묶음 과목 전부를 추천에서 뺀다
    const doneChoiceKeys = new Set();
    Object.values(req.choiceGroups).forEach(codes => {
      if (codes.some(c => keys.has(key(c)))) codes.forEach(c => doneChoiceKeys.add(key(c)));
    });

    // 점수 매기기. null 이면 후보에서 뺀다 (조건과 상관없는 이유)
    function score(o) {
      const k = key(o.code);
      if (keys.has(k)) return null;                       // 이미 들은 과목
      if (excludedCodes.has(o.code)) return null;          // [빼기]로 뺀 과목
      if (!o.slots || !o.slots.length) return null;        // 강의시간 없는 강좌
      const isMajor = o.dept === "지능미디어공학과";
      if (isMajor && o.grade && o.grade > next.grade) return null; // 학년 제한
      if (requiredKeys.has(k)) return 100;
      if (isMajor) {
        const a = cr.areas[o.area];
        if (!a || a.remain <= 0) return null;              // 남은 학점이 0인 영역
        return o.grade === next.grade ? 60 : 50;
      }
      if (req.generalAreas.includes(o.area)) {
        if (noTwo.test(o.name.trim())) return null;        // 교양 Ⅱ 과목은 추천하지 않음
        if (doneChoiceKeys.has(k)) return null;             // 이미 채운 택1 묶음의 다른 과목 (예: 글쓰기)
        for (const ch of req.prereqChains) {               // 기초 → Ⅰ → 고급
          if (k === key(ch.basic) && (keys.has(key(ch.main)) || keys.has(key(ch.advanced)))) return null;
          if (k === key(ch.advanced) && !keys.has(key(ch.main))) return null;
        }
        const subKey = o.area + "|" + o.sub;
        const capped = o.sub && !req.subCapExempt.includes(o.sub);
        if (capped && (subUsed[subKey] || 0) >= req.subCap) return null; // 6학점 채운 소영역
        if (o.area === "핵심교양") return emptyCore.has(o.sub) ? 40 : null;
        return genRemain > 0 ? 20 : null;
      }
      return null; // 일반선택 등은 추천하지 않음
    }

    // 후보 모으기 + 조건 때문에 빠진 필수과목 기록
    const blockedMap = new Map();
    const groups = new Map(); // 과목 키 → { key, score, credit, sections: [] }
    D().offerings[source].forEach(o => {
      const sc = score(o);
      if (sc === null) return;
      const conflicts = conditionConflicts(o, cond);
      const k = key(o.code);
      if (conflicts.length) {
        if (sc === 100) {
          if (!blockedMap.has(k)) blockedMap.set(k, { name: o.name, code: o.code, conflicts: [], sectionsOk: false });
          blockedMap.get(k).conflicts.push(...conflicts);
        }
        return;
      }
      if (sc === 100 && blockedMap.has(k)) blockedMap.get(k).sectionsOk = true; // 다른 분반은 가능
      if (!groups.has(k)) groups.set(k, { key: k, code: o.code, name: o.name, score: sc, credit: o.credit, area: o.area, sub: o.sub, sections: [] });
      const g = groups.get(k);
      // 시간이 똑같은 분반은 하나만 남김 (탐색 줄이기)
      const sig = JSON.stringify(o.slots);
      if (!g.sections.some(s => JSON.stringify(s.slots) === sig)) g.sections.push(o);
    });
    // 모든 분반이 조건에 걸린 필수과목만 안내 (판단 규칙 4)
    blockedMap.forEach((b, k) => { if (!b.sectionsOk && !groups.has(k)) result.blocked.push({ name: b.name, code: b.code, reason: reasonText(b.conflicts) }); });

    const list = [...groups.values()].sort((a, b) => b.score - a.score || b.credit - a.credit || a.name.localeCompare(b.name, "ko"));

    // 깊이 우선 탐색 (DFS)
    const found = [];
    let steps = 0;
    const chosen = [];
    const subPlan = {};
    const choiceOf = new Map(); // 과목 키 → 택1 묶음 이름
    Object.entries(req.choiceGroups).forEach(([name, codes]) => codes.forEach(c => choiceOf.set(key(c), name)));
    const groupUsed = new Set();
    function dfs(i, total, scoreSum) {
      if (++steps > SEARCH_LIMIT) return;
      if (total >= result.min && total <= target) {
        found.push({ sections: chosen.slice(), credits: total, score: scoreSum });
      }
      if (i >= list.length || total >= target) return;
      for (let j = i; j < list.length; j++) {
        if (steps > SEARCH_LIMIT) return;
        const g = list[j];
        if (total + g.credit > target) continue;
        // 교양 소영역 6학점 상한 (이번 학기에 넣는 것까지 포함)
        const subKey = g.area + "|" + g.sub;
        const capped = req.generalAreas.includes(g.area) && g.sub && !req.subCapExempt.includes(g.sub);
        if (capped && (subUsed[subKey] || 0) + (subPlan[subKey] || 0) + g.credit > req.subCap) continue;
        // 비어 있는 핵심교양 영역은 한 과목만
        if (g.area === "핵심교양" && (subPlan[subKey] || 0) > 0) continue;
        // 택1 묶음(글쓰기 등)은 한 안에 한 과목만
        const grp = choiceOf.get(g.key);
        if (grp && groupUsed.has(grp)) continue;
        for (const sec of g.sections) {
          if (chosen.some(c => overlaps(c, sec))) continue;
          chosen.push(sec);
          if (capped) subPlan[subKey] = (subPlan[subKey] || 0) + g.credit;
          if (grp) groupUsed.add(grp);
          dfs(j + 1, total + g.credit, scoreSum + g.score);
          chosen.pop();
          if (capped) subPlan[subKey] -= g.credit;
          if (grp) groupUsed.delete(grp);
          break; // 한 과목은 겹치지 않는 첫 분반만 시도 (분반 바꾸기만 한 안은 의미가 없음)
        }
      }
    }
    dfs(0, 0, 0);
    result.steps = Math.min(steps, SEARCH_LIMIT);

    // 안 고르기: 점수 합 높은 순, 이미 고른 안과 과목이 2개 이상 다른 안만, 최대 3안
    // 목표에 가까운 안(목표−1 ~ 목표)을 먼저 고르고, 3안이 안 되면 목표−2 안으로 채운다 (사용자 확인)
    found.sort((a, b) => b.score - a.score || b.credits - a.credits);
    const near = found.filter(p => p.credits >= target - 1);
    const far = found.filter(p => p.credits < target - 1);
    const keyOf = s => key(s.code);
    for (const p of near.concat(far)) {
      const ks = new Set(p.sections.map(keyOf));
      const differs = result.plans.every(q => {
        const qs = new Set(q.sections.map(keyOf));
        const onlyP = [...ks].filter(x => !qs.has(x)).length;
        const onlyQ = [...qs].filter(x => !ks.has(x)).length;
        return Math.max(onlyP, onlyQ) >= 2;
      });
      if (differs) result.plans.push(p);
      if (result.plans.length === 3) break;
    }
    result.plans.forEach(p => {
      p.offeringIds = p.sections.map(s => s.id);
      p.requiredCodes = p.sections.filter(s => requiredKeys.has(keyOf(s))).map(s => s.code);
    });

    // 0개일 때 이유 찾기: 조건을 골랐으면 조건 없이 다시 해 보고, 그래도 0개면 조건 탓이 아님
    if (!result.plans.length) {
      result.candidateCount = groups.size;
      const hasCond = cond.credits || cond.freeDay || cond.timeOff;
      if (hasCond) {
        const plain = recommend(Object.assign({}, state, { conditions: { credits: null, freeDay: null, timeOff: null } }));
        result.reason = plain.plans.length ? "conditions" : plain.reason;
        if (!plain.plans.length) result.candidateCount = plain.candidateCount;
      } else {
        result.reason = "noCandidates";
      }
    }
    return result;
  }

  function findOffering(term, id) {
    return ((D().offerings || {})[term] || []).find(o => o.id === id) || null;
  }

  return {
    targetCredits, offeringSourceTerm, slotText, conditionConflicts, overlaps, recommend, findOffering,
    getToday, getCurrentTerm, parseTerm, nextTerm, prevTerm, termOrder, termName,
    listTerms, gradeOfK, termTabs, attendedCount, remainingTerms, nextTermInfo,
    catalog, findCourse, courseKey, findCheckedTerm,
    takenCourses, takenKeySet, isTaken,
    calcCredits, missingRequired, isDelayRisk, summary
  };
})();

window.Logic = Logic;
