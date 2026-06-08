import { useState, useEffect, useMemo, useRef, Component } from "react";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X,
  Plane, Check, Clock, AlertCircle, Trash2,
  ChevronDown, ChevronUp, Users, Link2,
  Info, ArrowRightLeft,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { ErpHero } from "./ErpHero.jsx";
import { syncLeaveRequests, needsCalendarSync, updateCalendarEvent, createAllDayEvent, createRawEvent } from "./gcal";

// 흰화면 크래시 방지: 캘린더/모달에서 예외가 나도 앱 전체가 죽지 않게 감싼다.
class CalErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error("[Calendar]", err); } catch { /* noop */ } }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, color: "#b91c1c" }}>
          캘린더 화면에서 오류가 발생했습니다. 새로고침해 주세요.
          <button onClick={() => this.setState({ err: null })} style={{ marginLeft: 8, textDecoration: "underline" }}>다시 시도</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────
// 회사 디자인 토큰 (마린엔지오 navy/blue 표준)
// ─────────────────────────────────────────────────────────────
// ⚠ 회사 표준 디자인 토큰(index.css :root --mg-*)의 mirror. 값 변경 시 양쪽 동기화 필요.
//   (포테토뭉 권고 2026-06-02: 즉시 통합보다 mirror 유지, 후속에서 CSS 토큰 참조로 통합 예정)
const THEME = {
  ink:        "#17212f",
  sub:        "#56657a",
  line:       "#d7e0ea",
  line2:      "#e7edf3",
  bg:         "#f3f6f9",
  navy:       "#1f3a5f",
  blue:       "#245f9a",
  soft:       "#f8fbfd",
  accent:     "#0b7cc1",
  accent2:    "#14a8e8",
  accentSoft: "#e8f4fb",
  warn:       "#e99127",
  green:      "#16a34a",
};

// 직원별 색상 (이벤트 시각적 구분)
const AUTHOR_COLORS = {
  "김찬수": { bg: "#0b7cc1", text: "#ffffff", soft: "#e8f4fb" },
  "최승표": { bg: "#16a34a", text: "#ffffff", soft: "#e7f5ec" },
  "여은민": { bg: "#1f3a5f", text: "#ffffff", soft: "#e8edf4" },
};

function getAuthorColor(name) {
  return AUTHOR_COLORS[name] || { bg: "#56657a", text: "#ffffff", soft: "#f1f3f5" };
}

// 일정 종류별 파스텔 색 (포테토뭉 권고 팔레트). bg=연한 배경, fg=진한 동일계열 글자, dot=좌측 바
const CATEGORY_COLORS = {
  leave:   { label: "휴가", bg: "#d9f0e3", fg: "#1f5c3b", dot: "#16a34a" },
  trip:    { label: "출장", bg: "#dbeafe", fg: "#1e4f8f", dot: "#245f9a" },
  call:    { label: "통화", bg: "#fde2e2", fg: "#8a2f2f", dot: "#dc6a6a" },
  center:  { label: "센터", bg: "#e6e3f8", fg: "#4f4a91", dot: "#7986cb" },
  meeting: { label: "회의", bg: "#fff1c7", fg: "#6b4a00", dot: "#caa53d" },
  etc:     { label: "기타", bg: "#e5e7eb", fg: "#374151", dot: "#9aa3af" },
};
// 이벤트 → 종류 키
function eventCategory(ev) {
  if (ev.is_external) {
    const s = ev.summary || "";
    if (s.includes("해양벤처진흥센터") || s.includes("센터완료")) return "center";
    if (s.includes("통화")) return "call";
    if (s.includes("회의")) return "meeting";
    return "etc";
  }
  if (ev.leave_type_name === "출장") return "trip";
  if (ev.leave_type_name === "회의") return "meeting";
  return "leave";  // 휴가·반차·예비군 등 연차 계열
}

// 상태 한글 매핑 (DB는 pending 유지, UI 표시만 '신청' — 포테토뭉 권고)
const STATUS_LABEL = {
  pending:   "신청",
  approved:  "승인",
  rejected:  "반려",
  cancelled: "취소",
};
function statusKo(s) { return STATUS_LABEL[s] || s; }

// 대표(승인자)만 보는 상태 변경 옵션
const STATUS_OPTIONS = [
  { value: "pending",   label: "신청" },
  { value: "approved",  label: "승인" },
  { value: "rejected",  label: "반려" },
  { value: "cancelled", label: "취소" },
];
const APPROVER_NAME = "여은민";  // 승인자는 대표 단독

const DEFAULT_AUTHORS = ["김찬수", "최승표", "여은민"];

// 시간 지정 모드를 default로 쓰는 일정 종류 (회의·외근·기타)
const GENERAL_EVENT_TYPES = new Set(["회의", "외근", "기타"]);

function hhmm(t) {
  if (!t) return "";
  return String(t).slice(0, 5);  // "09:30:00" → "09:30"
}

// ─────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// calendarSignature / needsCalendarSync / syncLeaveRequests 는 gcal.js로 단일화(대시보드 트리거와 공유)

function daysBetween(start, end) {
  if (!end || end === start) return 1;
  const s = new Date(start), e = new Date(end);
  return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// 출장 기간 내 휴일(토·일·공휴일·대체공휴일) 일수 계산
// holidaysSet은 YYYY-MM-DD 형식 Set
function countHolidaysInRange(startDate, endDate, holidaysSet) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate || startDate);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    const dStr = ymd(d);
    if (day === 0 || day === 6 || holidaysSet.has(dStr)) count++;
  }
  return count;
}

// 출장 자동 보상휴가 적용 대상 직원
const COMPENSATORY_TARGETS = new Set(["김찬수", "최승표"]);

// 보상휴가 누적 재계산 (직원·연도 단위)
// 해당 직원·연도의 모든 출장(취소·반려 제외)에 대해 휴일 일수 합산 →
// annual_leave_balances.compensatory_grant에 저장. 별도 leave_request 생성 X.
// 직원은 향후 휴가를 자유롭게 신청해 이 누적분을 사용한다.
async function recalculateCompensatoryGrant(author, year, holidaysSet) {
  if (!author || !year) return;
  if (!COMPENSATORY_TARGETS.has(author)) return;

  const { data: trips } = await supabase
    .from("leave_requests")
    .select("start_date, end_date, status")
    .eq("author", author)
    .eq("leave_type_name", "출장")
    .gte("start_date", `${year}-01-01`)
    .lte("start_date", `${year}-12-31`);

  let total = 0;
  for (const t of (trips || [])) {
    if (t.status === "rejected" || t.status === "cancelled") continue;
    total += countHolidaysInRange(t.start_date, t.end_date, holidaysSet);
  }

  const { data: existing } = await supabase
    .from("annual_leave_balances")
    .select("id")
    .eq("author", author)
    .eq("year", year)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("annual_leave_balances")
      .update({ compensatory_grant: total, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("annual_leave_balances").insert([{
      author, year, annual_grant: 0, annual_additional: 0, compensatory_grant: total,
    }]);
  }
}

function getMonthGrid(year, month) {
  // month: 0~11
  const first = new Date(year, month, 1);
  const startDow = first.getDay();  // 0=일
  const last = new Date(year, month + 1, 0).getDate();
  const cells = [];
  // 앞쪽 빈칸 (이전 달)
  const prevLast = new Date(year, month, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, prevLast - i), other: true });
  }
  for (let d = 1; d <= last; d++) {
    cells.push({ date: new Date(year, month, d), other: false });
  }
  // 뒤쪽 빈칸 (6주 X 7일 = 42 채움)
  let next = 1;
  while (cells.length < 42) {
    cells.push({ date: new Date(year, month + 1, next++), other: true });
  }
  return cells;
}

function isInRange(dateStr, startStr, endStr) {
  const d = dateStr;
  const s = startStr;
  const e = endStr || startStr;
  return d >= s && d <= e;
}

// 같은 제목 + 인접 날짜 이벤트들을 1개의 multi-day 이벤트로 합치기
// (구글 캘린더가 같은 제목+연속 날짜를 시각적 막대로 합쳐 보이지만 실제로는 매일 별개 이벤트로 등록된 케이스 대응)
function mergeContinuousEvents(events) {
  // summary로 그룹핑, 각 그룹 내에서 start_date 순 정렬
  const grouped = {};
  for (const ev of events) {
    const key = ev.summary || "";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(ev);
  }
  const merged = [];
  for (const key of Object.keys(grouped)) {
    const list = grouped[key].slice().sort((a, b) =>
      (a.start_date || "").localeCompare(b.start_date || "")
    );
    let current = null;
    for (const ev of list) {
      if (!current) {
        current = { ...ev, _mergedIds: [ev.id] };
        continue;
      }
      // all-day 이벤트끼리만 합침 (시간 지정 이벤트는 별개 유지)
      // Google all-day의 end_date는 exclusive: 이전 이벤트의 end_date == 현재 이벤트의 start_date 이면 인접
      if (current.is_all_day && ev.is_all_day && current.end_date === ev.start_date) {
        current.end_date = ev.end_date;
        current._mergedIds.push(ev.id);
      } else {
        merged.push(current);
        current = { ...ev, _mergedIds: [ev.id] };
      }
    }
    if (current) merged.push(current);
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────
// 메인: LeaveView
// ─────────────────────────────────────────────────────────────
export default function LeaveView({ viewer } = {}) {
  // 개인정보 열람 범위: owner=전체 / employee=본인 / shared(공용메일·미등록)=숨김
  const viewerRole = viewer?.role || "shared";
  const viewerName = viewer?.name || null;
  const canSeeAll = viewerRole === "owner";
  const isSharedViewer = viewerRole === "shared";
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());  // 0~11

  const [leaveTypes, setLeaveTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [externalEvents, setExternalEvents] = useState([]);  // MGEO 캘린더 원본 이벤트 (읽기 표시용)
  const [holidays, setHolidays] = useState(() => new Map());  // YYYY-MM-DD → 공휴일명 (대체공휴일 포함)

  const [modalOpen, setModalOpen] = useState(false);
  const [modalInit, setModalInit] = useState(null);  // {date} or {request}
  const [genEvent, setGenEvent] = useState(null);  // 일반 MGEO 이벤트 편집 (휴가·출장과 분리)
  const [showBalances, setShowBalances] = useState(false);  // 개인정보 보호 — 기본 숨김
  const [calEvents, setCalEvents] = useState([]);  // 달력 그리드용(공개 뷰 — 전원, 개인정보 컬럼 제외)
  const [peek, setPeek] = useState(null);  // 다른 직원 일정 클릭 시 공개 정보만 표시

  // 초기 로드
  useEffect(() => { reloadAll(); }, []);

  async function reloadAll() {
    setLoading(true);
    const [t, r, b, cal] = await Promise.all([
      supabase.from("leave_types").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("leave_requests").select("*").order("start_date", { ascending: false }),  // RLS: 본인/대표만
      supabase.from("annual_leave_balances").select("*").order("author"),
      supabase.from("calendar_events_public").select("*").order("start_date", { ascending: false }),  // 달력용 전원 공유(공개 컬럼만)
    ]);
    if (t.data) setLeaveTypes(t.data);
    if (r.data) setRequests(r.data);
    if (b.data) setBalances(b.data);
    if (cal.data) setCalEvents(cal.data);
    setLoading(false);
  }

  // 월별 그리드 셀
  const cells = useMemo(() => getMonthGrid(year, month), [year, month]);

  // 합쳐진 이벤트 (달력 공개 뷰 = 전원 + 외부 MGEO 캘린더) — 가로 spanning bar용
  // 달력은 calEvents(전원, 개인정보 컬럼 제외)에서, 목록·편집은 requests(RLS)에서
  const allEvents = useMemo(() => {
    const knownGcalIds = new Set(calEvents.map(r => r.google_calendar_event_id).filter(Boolean));
    const fromRequests = calEvents.map(r => ({
      ...r,
      _start: r.start_date,
      _end: r.end_date || r.start_date,  // inclusive
    }));
    const fromExternal = externalEvents
      .filter(ev => !knownGcalIds.has(ev.id))
      .map(ev => {
        // Google all-day end는 exclusive → 하루 빼서 inclusive로
        const endDt = new Date(ev.end_date);
        endDt.setDate(endDt.getDate() - 1);
        return { ...ev, _start: ev.start_date, _end: ymd(endDt) };
      });
    return [...fromRequests, ...fromExternal];
  }, [calEvents, externalEvents]);

  // 직원별 잔여 (annual_leave_balances + 사용 합산)
  const balanceWithUsage = useMemo(() => {
    const usedBy = {};
    requests
      .filter(r => r.status !== "rejected" && r.status !== "cancelled")
      .forEach(r => {
        const yr = new Date(r.start_date).getFullYear();
        const key = `${r.author}|${yr}`;
        usedBy[key] = (usedBy[key] || 0) + Number(r.annual_consumed || 0);
      });
    return balances.map(b => {
      const used = usedBy[`${b.author}|${b.year}`] || 0;
      const grant = Number(b.annual_grant) + Number(b.annual_additional || 0) + Number(b.compensatory_grant || 0);
      return { ...b, used, remaining: grant - used, grant };
    });
  }, [balances, requests]);

  // 최근 신청 목록 가시성: 대표=전체 / 직원=본인 author만 / 공용=숨김 (달력 그리드는 별도로 전원 표시)
  const visibleRequests = useMemo(() => {
    if (canSeeAll) return requests;
    if (viewerRole === "employee" && viewerName) return requests.filter(r => r.author === viewerName);
    return [];
  }, [requests, canSeeAll, viewerRole, viewerName]);

  function prevMonth() {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  }

  function openNew(date) {
    setModalInit({ date: ymd(date) });
    setModalOpen(true);
  }

  async function openEdit(request) {
    if (request.is_external) {
      // 일반 MGEO 이벤트 → "일정 편집" 모달로 분기 (포테토뭉 권고)
      setGenEvent(request);
      return;
    }
    // 달력 클릭은 공개 뷰(calEvents) 객체 → 본인/대표면 원본(RLS) 재조회해 전체 필드로 편집
    const mine = canSeeAll || (viewerName && request.author === viewerName);
    if (!mine) { setPeek(request); return; }  // 다른 직원 일정 → 공개 정보만
    if (request.id && request.memo === undefined) {
      const { data } = await supabase.from("leave_requests").select("*").eq("id", request.id).single();
      if (data) { setModalInit({ request: data }); setModalOpen(true); return; }
      setPeek(request); return;  // 재조회 실패(권한·삭제) → 공개 정보만
    }
    setModalInit({ request });
    setModalOpen(true);
  }

  return (
    <CalErrorBoundary>
    <div className="px-6 py-6">
      <ErpHero
        title="캘린더"
        meta={`${year}년 ${month + 1}월 · 전체 ${requests.length}건 · MGEO 캘린더 연동`}
        tags={["연차·출장", "MGEO 캘린더", "구글 연동(버튼)"]}
      />
      {/* ── 달력 헤더 ───────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-md"
                  style={{ color: THEME.navy }}>
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-xl font-bold" style={{ color: THEME.navy }}>
            {year}년 {month + 1}월
          </h2>
          <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-md"
                  style={{ color: THEME.navy }}>
            <ChevronRight size={18} />
          </button>
          <button onClick={() => { const t = new Date(); setYear(t.getFullYear()); setMonth(t.getMonth()); }}
                  className="ml-2 px-3 py-1.5 text-xs font-semibold rounded-md border"
                  style={{ borderColor: THEME.line, color: THEME.sub }}>
            오늘
          </button>
        </div>
        <div className="flex items-center gap-2">
          <GoogleCalendarSync requests={requests}
                              onSyncDone={reloadAll}
                              onExternalEvents={setExternalEvents}
                              onHolidaysFetched={setHolidays} />
          <button onClick={() => openNew(new Date())}
                  className="px-4 py-2 text-sm font-semibold rounded-md flex items-center gap-1.5 shadow-md hover:shadow-lg transition"
                  style={{ background: THEME.navy, color: "#fff" }}>
            <Plus size={15} strokeWidth={3} />
            신청
          </button>
        </div>
      </div>

      {/* ── 달력 그리드 (메인 영역, 세로 더 큼) ───────── */}
      <CalendarGrid
        cells={cells}
        events={allEvents}
        onCellClick={openNew}
        onEventClick={openEdit}
        today={today}
        holidays={holidays}
      />

      {/* ── 범례 ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-xs"
           style={{ color: THEME.sub }}>
        <span className="font-semibold">종류:</span>
        {Object.values(CATEGORY_COLORS).map((cat) => (
          <span key={cat.label} className="flex items-center gap-1.5 px-2 py-0.5 rounded"
                style={{ background: cat.bg, color: cat.fg, fontWeight: 600,
                         borderLeft: `3px solid ${cat.dot}` }}>
            {cat.label}
          </span>
        ))}
        <span className="ml-2 font-semibold">직원(좌측 바):</span>
        {Object.entries(AUTHOR_COLORS).map(([name, c]) => (
          <span key={name} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded" style={{ background: c.bg }}></span>
            {name}
          </span>
        ))}
        <span className="ml-2 font-semibold">상태:</span>
        <span className="flex items-center gap-1.5"><Clock size={12} /> 대기</span>
        <span className="flex items-center gap-1.5"><Check size={12} style={{ color: THEME.green }} /> 승인</span>
      </div>

      {/* ── 직원별 잔여 (개인정보 보호: 공용메일은 숨김. 연차 현황은 RLS로 DB 차단) ──── */}
      {!isSharedViewer && (
      <div className="mt-6 rounded-xl border" style={{ background: "#fff", borderColor: THEME.line }}>
        <button onClick={() => setShowBalances(v => !v)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 rounded-xl">
          <div className="flex items-center gap-2">
            <Users size={14} style={{ color: THEME.navy }} />
            <span className="text-sm font-bold" style={{ color: THEME.navy }}>
              {canSeeAll ? "직원별 휴가 현황" : "내 휴가 현황"}
            </span>
            <span className="text-xs" style={{ color: THEME.sub }}>(개인정보 — 클릭하여 상세)</span>
          </div>
          {showBalances
            ? <ChevronUp size={16} style={{ color: THEME.sub }} />
            : <ChevronDown size={16} style={{ color: THEME.sub }} />}
        </button>
        {showBalances && (
          <div className="px-4 pb-4">
            <EmployeeBalanceCards balances={balanceWithUsage} />
          </div>
        )}
      </div>
      )}

      {/* ── 최근 신청 목록 (공용메일은 숨김 / 직원은 본인만) ─────────── */}
      {!isSharedViewer && (
        <RecentRequestList requests={visibleRequests.slice(0, 10)} onEdit={openEdit} />
      )}

      {/* ── 신청·수정 모달 ────────────────────── */}
      {modalOpen && (
        <LeaveRequestModal
          init={modalInit}
          leaveTypes={leaveTypes}
          authors={balances.map(b => b.author)}
          isOwner={canSeeAll}
          viewerName={viewerName}
          holidays={holidays}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); reloadAll(); }}
          onExternalDeleted={(ids) => setExternalEvents(prev =>
            prev.filter(e => !ids.includes(e.id))
          )}
          onConvertedToGeneral={(extEvt) => {
            // event id 기준 upsert(중복 방지) + 신청행은 reloadAll로 제거
            setExternalEvents(prev => [...prev.filter(e => e.id !== extEvt.id), extEvt]);
            setModalOpen(false);
            reloadAll();
          }}
          onBackToGeneral={(extEvt) => {
            // 일반→신청 변환 모달에서 '일반 일정'으로 되돌림 (양방향)
            setModalOpen(false);
            setGenEvent(extEvt);
          }}
        />
      )}

      {/* ── 일반 MGEO 일정 편집 모달 ───────────── */}
      {genEvent && (
        <GeneralEventModal
          event={genEvent}
          onClose={() => setGenEvent(null)}
          onUpdated={(id, patch) => setExternalEvents(prev =>
            prev.map(e => e.id === id ? { ...e, ...patch } : e)
          )}
          onDeleted={(id) => setExternalEvents(prev => prev.filter(e => e.id !== id))}
          onConvert={(ev) => { setGenEvent(null); setModalInit({ externalEvent: ev }); setModalOpen(true); }}
        />
      )}

      {/* ── 다른 직원 일정: 공개 정보만 (개인정보 보호) ───────────── */}
      {peek && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(15, 23, 42, 0.5)" }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
               onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ background: THEME.navy, color: "#fff" }}>
              <div className="flex items-center gap-2"><CalendarIcon size={18} /><h3 className="font-bold">일정 정보</h3></div>
              <button onClick={() => setPeek(null)} className="hover:opacity-70"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-2 text-sm">
              <div className="rounded-md p-3 text-xs" style={{ background: THEME.accentSoft, color: THEME.navy }}>
                다른 직원의 일정이라 <b>공개 정보만</b> 표시됩니다 (개인정보 보호).
              </div>
              <div className="flex justify-between"><span style={{ color: THEME.sub }}>성명</span><span className="font-semibold">{peek.author}</span></div>
              <div className="flex justify-between"><span style={{ color: THEME.sub }}>종류</span><span className="font-semibold">{peek.leave_type_name}{peek.destination ? ` · ${peek.destination}` : ""}</span></div>
              <div className="flex justify-between"><span style={{ color: THEME.sub }}>기간</span><span className="font-semibold">{peek._start || peek.start_date}{(peek._end || peek.end_date) && (peek._end || peek.end_date) !== (peek._start || peek.start_date) ? ` ~ ${peek._end || peek.end_date}` : ""}</span></div>
              <div className="flex justify-between"><span style={{ color: THEME.sub }}>상태</span><span className="font-semibold">{statusKo(peek.status)}</span></div>
            </div>
            <div className="px-5 py-3 flex justify-end border-t" style={{ borderColor: THEME.line }}>
              <button onClick={() => setPeek(null)} className="px-4 py-2 text-sm font-semibold rounded-md text-white" style={{ background: THEME.navy }}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </CalErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────
// 구글 캘린더 연동 (MGEO 캘린더 단방향 push: leave_requests → MGEO)
// ─────────────────────────────────────────────────────────────
// Client ID는 공개정보(브라우저 노출 정상). 환경변수에 VITE_ 접두사가 없으면
// 브라우저 빌드에서 못 읽으므로 fallback 하드코딩으로 동작 보장.
const GOOGLE_CLIENT_ID_FALLBACK = "897631356111-45ul0ohnrosarqd669d3vlj70gg7kq2i.apps.googleusercontent.com";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
const TOKEN_STORAGE_KEY = "mgeo_gcal_token_v1";
// 한 번이라도 동의(grant)했는지 표시 — localStorage access token(1h)이 만료돼도
// grant가 살아있으면 prompt:''(silent)로 재발급해 '확인하지 않은 앱' 경고 반복을 막는다.
const GRANT_FLAG_KEY = "mgeo_gcal_granted_v1";
const markGranted = () => { try { localStorage.setItem(GRANT_FLAG_KEY, "1"); } catch { /* noop */ } };
const wasGranted = () => { try { return localStorage.getItem(GRANT_FLAG_KEY) === "1"; } catch { return false; } };
const clearGranted = () => { try { localStorage.removeItem(GRANT_FLAG_KEY); } catch { /* noop */ } };
const CALENDAR_STORAGE_KEY = "mgeo_gcal_calendar_id_v1";

function loadStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t?.access_token || !t?.expires_at) return null;
    if (t.expires_at <= Date.now()) return null;
    return t;
  } catch { return null; }
}

function loadStoredCalendarId() {
  try { return localStorage.getItem(CALENDAR_STORAGE_KEY) || null; }
  catch { return null; }
}

async function tryDeleteCalendarEvent(eventId) {
  if (!eventId) return { ok: false, reason: "no_event_id" };
  const token = loadStoredToken();
  if (!token) return { ok: false, reason: "no_token" };
  const calId = loadStoredCalendarId();
  if (!calId) return { ok: false, reason: "no_calendar" };
  try {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    if (r.ok || r.status === 410) return { ok: true };
    return { ok: false, reason: `status_${r.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function GoogleCalendarSync({ requests, onSyncDone, onExternalEvents, onHolidaysFetched }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID_FALLBACK;
  const [gisReady, setGisReady] = useState(false);
  const [token, setToken] = useState(() => loadStoredToken());  // 페이지 로드 시 localStorage에서 복원
  const [calendarId, setCalendarId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [pulledCount, setPulledCount] = useState(0);
  const tokenClientRef = useRef(null);

  useEffect(() => {
    if (window.google?.accounts?.oauth2) { setGisReady(true); return; }
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) { existing.addEventListener("load", () => setGisReady(true)); return; }
    const s = document.createElement("script");
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => setGisReady(true);
    s.onerror = () => setMsg({ kind: "err", text: "Google Identity Services 로드 실패" });
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!gisReady) return;
    tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: CAL_SCOPE,
      callback: (resp) => {
        if (resp.error) {
          // silent 시도(prompt:'') 실패는 조용히 처리, 명시적 클릭(prompt:'consent') 실패만 표시
          if (resp.error !== "popup_closed_by_user") {
            const origin = /origin|idpiframe|redirect/i.test(resp.error || "");
            setMsg({
              kind: "err",
              text: origin
                ? "현재 접속 주소가 Google OAuth 승인 origin에 등록되어 있지 않아 캘린더 연동을 시작할 수 없습니다. Google Cloud Console > OAuth Client > Authorized JavaScript origins 에 현재 주소를 추가하세요."
                : `OAuth 실패: ${resp.error}`,
            });
          }
          // silent(prompt:'') 실패 = grant가 만료/철회됨 → 다음 연동 클릭은 consent로 복구
          clearGranted();
          setBusy(false); return;
        }
        const newToken = {
          access_token: resp.access_token,
          expires_at: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000,
        };
        try { localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(newToken)); } catch {}
        markGranted();  // 동의 완료 — 이후 토큰 만료돼도 silent 재발급
        setToken(newToken);
      },
    });
    // 진입 시 자동 OAuth 시도 제거 (포테토뭉 권고) — origin_mismatch/팝업 방지.
    // 사용자가 연동 버튼을 눌렀을 때만 토큰을 요청한다. 저장된 유효 토큰이 있으면 아래 effect가 사용.
  }, [gisReady, clientId]);

  // 토큰 만료 5분 전 자동 silent refresh
  useEffect(() => {
    if (!token || !tokenClientRef.current) return;
    const msLeft = token.expires_at - Date.now();
    if (msLeft <= 0) return;
    const refreshIn = Math.max(0, msLeft - 5 * 60 * 1000);
    const t = setTimeout(() => {
      try { tokenClientRef.current.requestAccessToken({ prompt: "" }); } catch {}
    }, refreshIn);
    return () => clearTimeout(t);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        const data = await r.json();
        if (data.error) throw new Error(data.error.message);
        const mgeo = (data.items || []).find(c => (c.summary || "").toUpperCase() === "MGEO");
        if (!mgeo) {
          setMsg({ kind: "err", text: "'MGEO' 캘린더를 찾지 못함. 구글 캘린더에 'MGEO' 이름으로 캘린더를 만들어주세요." });
          return;
        }
        setCalendarId(mgeo.id);
        try { localStorage.setItem(CALENDAR_STORAGE_KEY, mgeo.id); } catch {}
        setMsg({ kind: "ok", text: "MGEO 연결됨 — 일정 가져오는 중..." });
        await Promise.all([
          pullEvents(mgeo.id, token.access_token),
          pullHolidays(token.access_token),
        ]);
      } catch (e) {
        setMsg({ kind: "err", text: `캘린더 조회 실패: ${e.message}` });
      } finally {
        setBusy(false);
      }
    })();
  }, [token]);

  // 대한민국 공휴일·대체공휴일 가져오기 (현재 기준 ±12개월)
  async function pullHolidays(accessToken) {
    try {
      const calId = "ko.south_korea#holiday@group.v.calendar.google.com";
      const now = new Date();
      const timeMin = new Date(now.getFullYear() - 1, 0, 1).toISOString();
      const timeMax = new Date(now.getFullYear() + 1, 11, 31).toISOString();
      const params = new URLSearchParams({
        timeMin, timeMax,
        singleEvents: "true",
        maxResults: "500",
      });
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await r.json();
      if (data.error) return;  // 휴일 fetch 실패는 silent (토·일은 여전히 인식)
      const map = new Map();  // YYYY-MM-DD → 공휴일명 (달력 표시 + .has()로 휴가계산 호환)
      for (const ev of (data.items || [])) {
        // 종일 이벤트만 (date), 다일 이벤트는 start~end 사이 모두 포함
        if (!ev.start?.date) continue;
        const name = (ev.summary || "공휴일").trim();
        const start = new Date(ev.start.date);
        const end = ev.end?.date ? new Date(ev.end.date) : new Date(ev.start.date);
        // Google all-day end는 exclusive
        for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
          map.set(ymd(d), name);
        }
      }
      // 사이드바 미니 캘린더 등 다른 화면이 쓰도록 캐시 (휴일·공휴일 표시 공유)
      try { localStorage.setItem("mgeo_holidays_v1", JSON.stringify([...map.entries()])); } catch { /* noop */ }
      onHolidaysFetched?.(map);
    } catch (e) {
      // silent
    }
  }

  // MGEO 캘린더 이벤트 가져오기 (현재 기준 ±12개월)
  async function pullEvents(calId, accessToken) {
    try {
      const now = new Date();
      const timeMin = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();
      const timeMax = new Date(now.getFullYear() + 1, now.getMonth() + 1, 1).toISOString();
      const params = new URLSearchParams({
        timeMin, timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "500",
      });
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      const rawEvents = (data.items || []).map(ev => {
        // 빈 제목 이벤트는 제외
        if (!ev.summary || !ev.summary.trim()) return null;
        const isAllDay = !!ev.start?.date;
        const startStr = ev.start?.date || (ev.start?.dateTime || "").slice(0, 10);
        let endStr = ev.end?.date || (ev.end?.dateTime || "").slice(0, 10);
        if (!startStr || !endStr) return null;
        // 시간 지정 이벤트면 end가 같은 날일 수도 있음. all-day와 동일하게 exclusive로 정규화
        if (!isAllDay && endStr === startStr) {
          const d = new Date(endStr);
          d.setDate(d.getDate() + 1);
          endStr = ymd(d);
        }
        // 시간 추출 (HH:MM 형태, KST 등 로컬 시간대 기준)
        let startTime = null;
        if (ev.start?.dateTime) {
          const dt = new Date(ev.start.dateTime);
          startTime = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
        }
        return {
          is_external: true,
          is_all_day: isAllDay,
          start_time: startTime,
          id: ev.id,
          summary: ev.summary.trim(),
          description: ev.description || "",
          start_date: startStr,
          end_date: endStr,  // exclusive (Google all-day와 통일)
          html_link: ev.htmlLink,
          author: "(MGEO 캘린더)",
          leave_type_name: ev.summary.trim(),
          status: "external",
        };
      }).filter(Boolean);
      // 같은 제목 + 인접 날짜 이벤트를 1개로 합치기
      // (구글 캘린더가 같은 제목+연속 날짜를 시각적으로 합쳐 보여서 토뭉이님 데이터가 분리 등록된 경우 대응)
      const events = mergeContinuousEvents(rawEvents);
      onExternalEvents?.(events);
      setPulledCount(events.length);
      setMsg({ kind: "ok", text: `MGEO 연결됨 · ${rawEvents.length}건 → ${events.length}건 표시 (연속 합침)` });
    } catch (e) {
      setMsg({ kind: "err", text: `이벤트 조회 실패: ${e.message}` });
    }
  }

  function connect() {
    if (!tokenClientRef.current) {
      setMsg({ kind: "err", text: "Google Identity Services 준비 중" });
      return;
    }
    setMsg(null); setBusy(true);
    // 이미 동의한 적 있으면(=grant 유효) 토큰 만료 후에도 silent로 — consent 화면 반복 방지
    tokenClientRef.current.requestAccessToken({ prompt: wasGranted() ? "" : "consent" });
  }

  async function syncToCalendar(opts = {}) {
    const { silent = false } = opts;
    if (!calendarId || !token || !requests?.length) return;
    if (!silent) { setBusy(true); setMsg(null); }
    const r = await syncLeaveRequests(requests);  // 동기화 코어는 gcal.js로 단일화
    if (!silent) setBusy(false);
    const detail = `신규 ${r.pushed} · 갱신 ${r.updated}${r.removed ? " · 삭제 " + r.removed : ""}${r.errors ? " · 실패 " + r.errors : ""}`;
    if (silent) {
      if (r.pushed || r.updated || r.removed || r.errors)
        setMsg({ kind: r.errors ? "err" : "ok", text: `자동 동기화: ${detail}` });
    } else {
      setMsg({ kind: r.errors ? "err" : "ok", text: `MGEO 동기화 완료 · ${detail}` });
    }
    if (onSyncDone && (r.pushed || r.updated || r.removed)) onSyncDone();
  }

  const valid = token && token.expires_at > Date.now();

  // 자동 동기화: token+calendarId 있고 미반영(신규·수정·취소) 건이 있으면 1.5초 후 silent sync
  useEffect(() => {
    if (!valid || !calendarId || !requests?.length) return;
    const needSync = requests.some(needsCalendarSync);
    if (!needSync) return;
    const t = setTimeout(() => { syncToCalendar({ silent: true }); }, 1500);
    return () => clearTimeout(t);
  }, [valid, calendarId, requests]);

  return (
    <div className="flex items-center gap-2">
      {!valid && (
        <button onClick={connect} disabled={!gisReady || busy}
                className="px-3 py-2 text-xs font-semibold rounded-md border flex items-center gap-1.5"
                style={{ borderColor: THEME.line, color: THEME.sub, background: "#fff",
                         opacity: (!gisReady || busy) ? 0.5 : 1 }}
                title="구글 계정으로 로그인 후 MGEO 캘린더 검색">
          <Link2 size={12} />
          {busy ? "연결 중..." : "MGEO 캘린더 연동"}
        </button>
      )}
      {valid && calendarId && (
        <span className="px-2 py-1 text-xs rounded-md font-semibold flex items-center gap-1"
              style={{ background: THEME.accentSoft, color: THEME.accent }}
              title="신청·수정 시 자동으로 MGEO 캘린더에 반영됩니다">
          <Link2 size={12} />
          MGEO 자동 동기화 중
        </span>
      )}
      {msg && (
        <span className="text-xs"
              style={{ color: msg.kind === "err" ? THEME.warn : THEME.green }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 직원별 잔여 카드
// ─────────────────────────────────────────────────────────────
function EmployeeBalanceCards({ balances }) {
  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      {balances.map(b => {
        const c = getAuthorColor(b.author);
        const pct = b.grant > 0 ? Math.round((b.used / b.grant) * 100) : 0;
        return (
          <div key={b.id} className="rounded-xl p-4 border"
               style={{ background: "#fff", borderColor: THEME.line }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{ background: c.bg, color: c.text }}>
                  {b.author.slice(0, 1)}
                </span>
                <div>
                  <div className="font-semibold text-sm" style={{ color: THEME.ink }}>{b.author}</div>
                  <div className="text-[10px]" style={{ color: THEME.sub }}>{b.year}년 · 입사 {b.hire_date || "—"}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] font-bold tracking-wider uppercase" style={{ color: THEME.sub }}>발생</div>
                <div className="text-lg font-bold" style={{ color: THEME.navy }}>{b.grant}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-wider uppercase" style={{ color: THEME.sub }}>사용</div>
                <div className="text-lg font-bold" style={{ color: THEME.warn }}>{b.used}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-wider uppercase" style={{ color: THEME.sub }}>잔여</div>
                <div className="text-lg font-bold" style={{ color: THEME.green }}>{b.remaining}</div>
              </div>
            </div>
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: THEME.line2 }}>
              <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: c.bg }}></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 달력 그리드
// ─────────────────────────────────────────────────────────────
// 한 주(week) 내에서 이벤트들을 spanning bar로 배치 (구글 캘린더 스타일)
function layoutWeek(week, events) {
  const weekStart = ymd(week[0].date);
  const weekEnd = ymd(week[6].date);
  // 이 week에 걸치는 이벤트만
  const visible = events.filter(ev => ev._start <= weekEnd && ev._end >= weekStart);
  // 시작일 순 정렬 (긴 이벤트 우선)
  visible.sort((a, b) => {
    if (a._start !== b._start) return a._start.localeCompare(b._start);
    return b._end.localeCompare(a._end);
  });
  // slot 할당
  const slots = [];  // slots[i] = [{startCol, endCol}, ...]
  const placed = [];
  visible.forEach(ev => {
    const startCol = ev._start <= weekStart ? 0 : week.findIndex(c => ymd(c.date) === ev._start);
    const endCol = ev._end >= weekEnd ? 6 : week.findIndex(c => ymd(c.date) === ev._end);
    if (startCol < 0 || endCol < 0) return;
    let slotIdx = 0;
    while (true) {
      if (!slots[slotIdx]) { slots[slotIdx] = []; break; }
      const conflict = slots[slotIdx].some(p => !(p.endCol < startCol || p.startCol > endCol));
      if (!conflict) break;
      slotIdx++;
    }
    slots[slotIdx].push({ startCol, endCol });
    placed.push({ event: ev, slotIdx, startCol, endCol });
  });
  return placed;
}

function CalendarGrid({ cells, events, onCellClick, onEventClick, today, holidays }) {
  const todayStr = ymd(today);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const MAX_SLOTS = 4;
  const BAR_HEIGHT = 28;        // 22 → 28: 더 두껍게
  const BAR_GAP = 3;
  const HEADER_HEIGHT = 36;     // 28 → 36: 일자와 막대 사이 여유

  // weeks로 분리
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: THEME.line }}>
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7" style={{ background: THEME.navy }}>
        {weekdays.map((w) => (
          <div key={w} className="text-center py-2 text-xs font-bold text-white">{w}</div>
        ))}
      </div>
      {/* 주별 row */}
      {weeks.map((week, wi) => {
        const placed = layoutWeek(week, events);
        const visible = placed.filter(p => p.slotIdx < MAX_SLOTS);
        const overflowByCol = {};
        placed.filter(p => p.slotIdx >= MAX_SLOTS).forEach(p => {
          for (let c = p.startCol; c <= p.endCol; c++) {
            overflowByCol[c] = (overflowByCol[c] || 0) + 1;
          }
        });

        const rowMinHeight = Math.max(150, HEADER_HEIGHT + MAX_SLOTS * (BAR_HEIGHT + BAR_GAP) + 24);
        return (
          <div key={wi} className="relative grid grid-cols-7 border-b"
               style={{ borderColor: THEME.line, minHeight: rowMinHeight }}>
            {/* 날짜 셀 (배경 + 일자 표시) */}
            {week.map((cell, ci) => {
              const dateStr = ymd(cell.date);
              const isToday = dateStr === todayStr;
              const dow = cell.date.getDay();
              const holidayName = holidays?.get?.(dateStr) || null;  // 공휴일·대체공휴일명
              const textColor = (dow === 0 || holidayName) ? "#dc2626" : dow === 6 ? THEME.blue : THEME.ink;
              return (
                <div key={ci}
                     onClick={() => onCellClick(cell.date)}
                     className="border-r cursor-pointer hover:bg-slate-50 transition"
                     style={{
                       borderColor: THEME.line2,
                       background: cell.other ? "#fafbfc" : isToday ? THEME.accentSoft : holidayName ? "#fef2f3" : "#fff",
                       opacity: cell.other ? 0.45 : 1,
                       padding: "8px 8px 0 8px",
                       boxShadow: isToday ? `inset 0 0 0 2px ${THEME.accent}` : "none",
                     }}>
                  <div className="flex items-center justify-between gap-1">
                    <span className={"text-[15px] shrink-0 " + (isToday ? "font-bold" : "font-semibold")}
                          style={{ color: textColor }}>
                      {cell.date.getDate()}
                    </span>
                    {holidayName && !isToday && (
                      <span className="text-[10px] font-semibold truncate" style={{ color: "#dc2626" }}
                            title={holidayName}>{holidayName}</span>
                    )}
                    {isToday && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: THEME.accent, color: "#fff" }}>오늘</span>
                    )}
                  </div>
                  {holidayName && isToday && (
                    <div className="text-[10px] font-semibold truncate" style={{ color: "#dc2626" }} title={holidayName}>{holidayName}</div>
                  )}
                </div>
              );
            })}
            {/* 이벤트 막대 (absolute layer) — absolute 자식은 paddingTop 무시하므로 top에 HEADER_HEIGHT 직접 더함 */}
            <div className="absolute inset-0 pointer-events-none">
              {visible.map((p, i) => {
                const ev = p.event;
                const isExternal = ev.is_external;
                // 해양벤처진흥센터 관련 일정은 앱 캘린더에서 연보라로 구분 (그 외 외부일정은 회색)
                const isCenterEvt = isExternal && ((ev.summary || "").includes("해양벤처진흥센터") || (ev.summary || "").includes("센터완료"));
                const isPast = ev._end < todayStr;  // 종료일이 오늘 이전 = 지나간 일정 → 일반 글씨
                const c = isExternal ? null : getAuthorColor(ev.author);
                const isTrip = ev.leave_type_name === "출장";
                const isPending = !isExternal && ev.status === "pending";
                const widthPct = ((p.endCol - p.startCol + 1) / 7) * 100;
                const leftPct = (p.startCol / 7) * 100;
                const topPx = HEADER_HEIGHT + p.slotIdx * (BAR_HEIGHT + BAR_GAP);
                const siteTime = !isExternal && ev.is_all_day === false && ev.start_time ? hhmm(ev.start_time) : null;
                const label = isExternal
                  ? `${ev.start_time ? `🕐 ${ev.start_time} ` : "📅 "}${ev.summary}`
                  : `${isTrip ? "✈ " : ""}${siteTime ? `🕐 ${siteTime} ` : ""}${ev.author} · ${ev.leave_type_name}${ev.destination ? " · " + ev.destination : ""}`;
                // 색상 전략: 종류별 파스텔 배경 + 진한 동일계열 글자. 좌측 바 = 내부는 직원색, 외부는 종류색.
                // 직원 구분(휴가/출장)은 좌측 바, 종류는 배경색으로 표현. pending은 dashed border.
                const cat = CATEGORY_COLORS[eventCategory(ev)] || CATEGORY_COLORS.etc;
                const bg = cat.bg;
                const fg = cat.fg;
                const leftBar = isExternal ? cat.dot : (c?.bg || cat.dot);  // 내부 신청은 직원색 바
                return (
                  <div key={(ev.id || "x") + "-" + i + "-" + wi}
                       onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                       className="absolute rounded truncate cursor-pointer hover:opacity-90 pointer-events-auto shadow-sm"
                       style={{
                         left: `calc(${leftPct}% + 3px)`,
                         width: `calc(${widthPct}% - 6px)`,
                         top: topPx,
                         height: BAR_HEIGHT,
                         lineHeight: `${BAR_HEIGHT - 2}px`,
                         padding: "0 8px",
                         fontSize: "12.5px",
                         background: bg,
                         color: fg,
                         border: isPending ? `1.5px dashed ${cat.fg}66` : "none",
                         borderLeft: `4px solid ${leftBar}`,
                         fontStyle: isExternal ? "italic" : "normal",
                         fontWeight: isPast ? 500 : 700,
                         opacity: isPast ? 0.6 : 1,
                         letterSpacing: "-0.2px",
                       }}
                       title={isExternal
                         ? `MGEO 캘린더 원본: ${ev.summary}\n${ev._start} ~ ${ev._end}\n${ev.description || ""}`
                         : `${ev.author} · ${ev.leave_type_name}${ev.destination ? " · " + ev.destination : ""} · ${statusKo(ev.status)}`}>
                    {label}
                  </div>
                );
              })}
              {/* +N건 표시 (MAX_SLOTS 초과) */}
              {Object.entries(overflowByCol).map(([col, n]) => (
                <div key={"of-" + col}
                     className="absolute text-[11px] font-bold pointer-events-none"
                     style={{
                       left: `calc(${(Number(col) / 7) * 100}% + 6px)`,
                       top: HEADER_HEIGHT + MAX_SLOTS * (BAR_HEIGHT + BAR_GAP) + 2,
                       color: THEME.accent,
                     }}>
                  +{n}건
                </div>
              ))}
            </div>
            {/* '오늘' 테두리 — 이벤트 막대보다 위에 그려 가려지지 않게 (포테토뭉 권고: 별도 ring 레이어) */}
            {(() => {
              const tc = week.findIndex(c => ymd(c.date) === todayStr);
              if (tc < 0) return null;
              return (
                <div className="absolute pointer-events-none"
                     style={{ left: `${(tc / 7) * 100}%`, width: `${100 / 7}%`, top: 0, bottom: 0,
                              boxShadow: `inset 0 0 0 2px ${THEME.accent}`, zIndex: 20 }} />
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 최근 신청 목록
// ─────────────────────────────────────────────────────────────
function RecentRequestList({ requests, onEdit }) {
  if (!requests.length) return null;
  return (
    <div className="mt-6 rounded-xl border p-4" style={{ background: "#fff", borderColor: THEME.line }}>
      <h3 className="text-sm font-bold mb-3" style={{ color: THEME.navy }}>최근 신청 (최대 10건)</h3>
      <div className="space-y-1">
        {requests.map(r => {
          const c = getAuthorColor(r.author);
          const StatusIcon = r.status === "approved" ? Check : r.status === "rejected" ? X : Clock;
          const statusColor = r.status === "approved" ? THEME.green : r.status === "rejected" ? "#dc2626" : THEME.warn;
          return (
            <div key={r.id} onClick={() => onEdit(r)}
                 className="flex items-center gap-3 py-2 px-2 rounded hover:bg-slate-50 cursor-pointer text-sm">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: c.bg, color: c.text }}>
                {r.author.slice(0, 1)}
              </span>
              <span className="font-semibold w-16" style={{ color: THEME.ink }}>{r.author}</span>
              <span className="text-xs px-2 py-0.5 rounded"
                    style={{ background: c.soft, color: c.bg }}>
                {r.leave_type_name}{r.destination ? ` (${r.destination})` : ""}
              </span>
              <span className="text-xs" style={{ color: THEME.sub }}>
                {r.start_date}{r.end_date && r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ""}
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs" style={{ color: statusColor }}>
                <StatusIcon size={13} />
                {statusKo(r.status)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 일반 MGEO 일정 보기·편집 모달 (휴가·출장 신청과 분리 — 통화 마감/센터/회의/기타)
// 포테토뭉 권고: 신청 변환 모달과 완전 분리 + 널 가드 + 모달 내 오류 표시 + confirm 2단계
// ─────────────────────────────────────────────────────────────
function addDaysStr(dateStr, delta) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(d.getTime())) return dateStr;
    d.setDate(d.getDate() + delta);
    return ymd(d);
  } catch { return dateStr; }
}

// 모든 일정 모달 공통 — 상단 유형 토글(휴가·출장 신청 ↔ 일반 일정). 양방향 전환을 일관 제공.
function EventTypeToggle({ value, onSelectLeave, onSelectGeneral, disabled }) {
  return (
    <div className="rounded-lg p-3" style={{ background: THEME.accentSoft, border: `1px solid ${THEME.accent}33` }}>
      <div className="flex items-center gap-1.5 text-xs font-bold mb-2" style={{ color: THEME.navy }}>
        <ArrowRightLeft size={14} style={{ color: THEME.accent }} /> 유형
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onSelectLeave} disabled={disabled}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-md"
                style={value === "leave"
                  ? { background: THEME.navy, color: "#fff" }
                  : { background: "#fff", color: THEME.sub, border: `1px solid ${THEME.line}` }}>
          휴가·출장 신청
        </button>
        <button type="button" onClick={onSelectGeneral} disabled={disabled}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-md"
                style={value === "general"
                  ? { background: THEME.accent, color: "#fff" }
                  : { background: "#fff", color: THEME.sub, border: `1px solid ${THEME.line}` }}>
          일반 일정
        </button>
      </div>
    </div>
  );
}

function GeneralEventModal({ event, onClose, onUpdated, onDeleted, onConvert }) {
  // 널 가드 — 이벤트/식별자 없으면 렌더 자체를 하지 않는다(흰화면 방지).
  if (!event || !event.id) return null;

  const startInit = event.start_date || event._start || ymd(new Date());
  const exEndInit = event.end_date || event._end || startInit;  // all-day는 exclusive
  const allDayInit = event.is_all_day !== false;

  const [title, setTitle] = useState(event.summary || "");
  const [allDay, setAllDay] = useState(allDayInit);
  const [sDate, setSDate] = useState(startInit);
  // all-day 종료일은 inclusive(표시용)로 환산, 시간 지정은 시작일과 동일하게 시작
  const [eDate, setEDate] = useState(allDayInit ? addDaysStr(exEndInit, -1) : startInit);
  const [sTime, setSTime] = useState(event.start_time || "09:00");
  const [eTime, setETime] = useState("10:00");
  const [memo, setMemo] = useState(event.description || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState("");

  async function handleSave() {
    if (!title.trim()) { setErr("제목을 입력해 주세요."); return; }
    setErr(""); setSaving(true);
    let body, patch;
    if (allDay) {
      const exclusive = addDaysStr(eDate, 1);
      body = { summary: title, description: memo, start: { date: sDate, dateTime: null }, end: { date: exclusive, dateTime: null } };
      patch = { summary: title, description: memo, start_date: sDate, end_date: exclusive, is_all_day: true, start_time: null };
    } else {
      const startISO = `${sDate}T${(sTime || "09:00").slice(0, 5)}:00+09:00`;
      const endISO = `${eDate}T${(eTime || "10:00").slice(0, 5)}:00+09:00`;
      body = {
        summary: title, description: memo,
        start: { dateTime: startISO, timeZone: "Asia/Seoul", date: null },
        end: { dateTime: endISO, timeZone: "Asia/Seoul", date: null },
      };
      let gridEnd = eDate; if (gridEnd === sDate) gridEnd = addDaysStr(sDate, 1);
      patch = { summary: title, description: memo, start_date: sDate, end_date: gridEnd, is_all_day: false, start_time: (sTime || "09:00").slice(0, 5) };
    }
    const res = await updateCalendarEvent(event.id, body);
    setSaving(false);
    if (res?.ok) { onUpdated?.(event.id, patch); onClose?.(); }
    else setErr("저장 실패: " + (res?.reason || "알 수 없는 오류") + " (토큰 만료·권한 부족일 수 있습니다)");
  }

  async function handleDelete() {
    setErr(""); setDeleting(true);
    const res = await tryDeleteCalendarEvent(event.id);
    setDeleting(false);
    if (res?.ok) { onDeleted?.(event.id); onClose?.(); }
    else setErr("삭제 실패: " + (res?.reason || "알 수 없는 오류"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(15, 23, 42, 0.5)" }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between"
             style={{ background: THEME.navy, color: "#fff" }}>
          <div className="flex items-center gap-2">
            <CalendarIcon size={18} />
            <h3 className="font-bold">일정 수정</h3>
          </div>
          <button onClick={onClose} className="hover:opacity-70"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          {err && (
            <div className="rounded-md p-3 text-xs"
                 style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#7f1d1d" }}>
              {err}
            </div>
          )}
          {/* ★ 공통 유형 토글 — '휴가·출장 신청' 선택 시 신청 변환 모달로 전환 */}
          <EventTypeToggle value="general"
                           onSelectLeave={() => onConvert?.(event)}
                           onSelectGeneral={() => {}} />
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>제목</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
                   className="col-span-2 px-3 py-2 border rounded-md outline-none"
                   style={{ borderColor: THEME.line }} />

            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>종일</label>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              <span style={{ color: THEME.sub }}>종일 일정</span>
            </div>

            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>시작</label>
            <div className="col-span-2 flex items-center gap-2">
              <input type="date" value={sDate} onChange={(e) => setSDate(e.target.value)}
                     className="px-3 py-2 border rounded-md outline-none" style={{ borderColor: THEME.line }} />
              {!allDay && (
                <input type="time" value={sTime} onChange={(e) => setSTime(e.target.value)}
                       className="px-3 py-2 border rounded-md outline-none" style={{ borderColor: THEME.line }} />
              )}
            </div>

            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>종료</label>
            <div className="col-span-2 flex items-center gap-2">
              <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)}
                     className="px-3 py-2 border rounded-md outline-none" style={{ borderColor: THEME.line }} />
              {!allDay && (
                <input type="time" value={eTime} onChange={(e) => setETime(e.target.value)}
                       className="px-3 py-2 border rounded-md outline-none" style={{ borderColor: THEME.line }} />
              )}
            </div>

            <label className="col-span-1 self-start mt-1 font-semibold" style={{ color: THEME.sub }}>메모</label>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3}
                      className="col-span-2 px-3 py-2 border rounded-md outline-none resize-none"
                      style={{ borderColor: THEME.line }} />
          </div>
        </div>

        <div className="px-5 py-3 flex items-center justify-between border-t" style={{ borderColor: THEME.line }}>
          {confirmDel ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: THEME.warn }}>캘린더에서 삭제할까요?</span>
              <button onClick={handleDelete} disabled={deleting}
                      className="px-3 py-1.5 text-xs font-semibold rounded-md text-white"
                      style={{ background: "#dc2626" }}>{deleting ? "삭제 중…" : "삭제 확정"}</button>
              <button onClick={() => setConfirmDel(false)} disabled={deleting}
                      className="px-3 py-1.5 text-xs font-semibold rounded-md border"
                      style={{ borderColor: THEME.line, color: THEME.sub }}>취소</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)}
                    className="px-3 py-2 text-xs font-semibold rounded-md flex items-center gap-1.5"
                    style={{ color: "#dc2626", border: "1px solid #fca5a5" }}>
              <Trash2 size={13} /> 삭제
            </button>
          )}
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving}
                    className="px-4 py-2 text-sm font-semibold rounded-md border"
                    style={{ borderColor: THEME.line, color: THEME.sub }}>취소</button>
            <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 text-sm font-semibold rounded-md text-white shadow-md"
                    style={{ background: THEME.navy }}>{saving ? "저장 중…" : "저장"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 신청·수정 모달
// ─────────────────────────────────────────────────────────────
function LeaveRequestModal({ init, leaveTypes, authors, holidays, onClose, onSaved, onExternalDeleted, onConvertedToGeneral, onBackToGeneral, isOwner, viewerName }) {
  const isEdit = !!init?.request;
  const existing = init?.request;
  const ext = init?.externalEvent;  // 외부 MGEO 이벤트 → 변환 모드
  // authors prop이 없거나 비어 있으면 기본 직원 명단 사용
  // 신청자(성명)에는 직원 + 대표(여은민) 모두 포함 (대표도 본인 일정 등록)
  const authorOptions = Array.from(new Set([...((authors && authors.length) ? authors : DEFAULT_AUTHORS), APPROVER_NAME]));
  // 2026-06-08 권한 분리 수정: owner(대표)는 전체 선택 가능, 직원은 본인만 선택 가능
  // 기존 신청 수정 시에는 author 변경 불가(대표만 가능) — existing.author 그대로 유지
  const selectableAuthors = isOwner
    ? authorOptions
    : (viewerName ? authorOptions.filter(n => n === viewerName) : []);
  // 상태 변경(승인/반려/취소)은 대표가 기존 신청을 수정할 때만. 신청 단계는 '신청'(pending) 고정.
  const canSetStatus = isOwner && isEdit;

  // 외부 변환 시 종류 추정: summary에 "회의"·"외근"·"휴가" 등 키워드 있으면 매칭
  const extDefaultTypeId = useMemo(() => {
    if (!ext || !leaveTypes.length) return "";
    const s = (ext.summary || "").toLowerCase();
    const guess = leaveTypes.find(t => s.includes(t.name.toLowerCase()));
    if (guess) return guess.id;
    // 시간 지정 이벤트면 회의, 종일이면 기타
    const fallback = leaveTypes.find(t => t.name === (ext.is_all_day === false ? "회의" : "기타"));
    return fallback?.id || leaveTypes[0]?.id || "";
  }, [ext, leaveTypes]);

  // 2026-06-08 권한 분리: 직원 로그인 시 본인 이름으로 초기화 (기존 신청 수정 시 existing.author 우선)
  const [author, setAuthor] = useState(
    existing?.author
    || (!isOwner && viewerName ? viewerName : authorOptions[0])
    || ""
  );
  const [leaveTypeId, setLeaveTypeId] = useState(existing?.leave_type_id || extDefaultTypeId || (leaveTypes[0]?.id || ""));
  const [startDate, setStartDate] = useState(existing?.start_date || ext?._start || ext?.start_date || init?.date || ymd(new Date()));
  const [endDate, setEndDate] = useState(existing?.end_date || existing?.start_date || ext?._end || ext?._start || init?.date || ymd(new Date()));
  const [isAllDay, setIsAllDay] = useState(
    existing ? existing.is_all_day !== false : (ext ? ext.is_all_day !== false : true)
  );
  const [startTime, setStartTime] = useState(hhmm(existing?.start_time) || ext?.start_time || "09:30");
  const [endTime, setEndTime] = useState(hhmm(existing?.end_time) || ext?.end_time || "10:30");
  const [destination, setDestination] = useState(existing?.destination || "");
  const [companions, setCompanions] = useState(existing?.companions || "");
  const [tripPurpose, setTripPurpose] = useState(existing?.trip_purpose || "");
  const [memo, setMemo] = useState(
    existing?.memo ||
    (ext ? `[MGEO 캘린더 원본]\n${ext.summary || ""}${ext.description ? "\n\n" + ext.description : ""}` : "")
  );
  const [status, setStatus] = useState(existing?.status || (ext ? "approved" : "pending"));
  const [approver, setApprover] = useState(existing?.approver || "");
  const [saving, setSaving] = useState(false);

  const selectedType = useMemo(
    () => leaveTypes.find(t => t.id === Number(leaveTypeId)),
    [leaveTypes, leaveTypeId]
  );
  const isTrip = selectedType?.name === "출장";
  const isGeneralEvent = selectedType && GENERAL_EVENT_TYPES.has(selectedType.name);

  // 새 신청에서 종류 바뀌면 종일/시간 모드 자동 분기
  useEffect(() => {
    if (existing) return;
    if (!selectedType) return;
    setIsAllDay(!GENERAL_EVENT_TYPES.has(selectedType.name));
  }, [selectedType, existing]);

  const days = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);
  const holidayInRange = useMemo(
    () => countHolidaysInRange(startDate, endDate, holidays || new Map()),
    [startDate, endDate, holidays]
  );
  const showCompensatoryNotice =
    isTrip && COMPENSATORY_TARGETS.has((author || "").trim()) && holidayInRange > 0;
  const annualConsumed = useMemo(
    () => (selectedType?.annual_consumption || 0) * days,
    [selectedType, days]
  );
  const absenceDays = useMemo(
    () => (selectedType?.absence_days || 1) * days,
    [selectedType, days]
  );

  // 신규 등록 시 "휴가·출장 신청" vs "일반 일정" 선택 (양방향 변환의 신규 진입점)
  const [createAsGeneral, setCreateAsGeneral] = useState(false);
  const [genTitle, setGenTitle] = useState("");
  const canChooseType = !isEdit && !ext;  // 신규 신청 모달에서만 등록유형 선택 노출

  // 신규 → 일반 일정으로 등록: leave_requests 없이 MGEO 캘린더에만 생성
  async function handleSaveGeneral() {
    const t = (genTitle || "").trim();
    if (!t) { setErrText("제목을 입력해 주세요."); return; }
    setSaving(true); setErrText("");
    const desc = memo || "";
    let body, extEvt;
    if (isAllDay) {
      const endDt = new Date(endDate); endDt.setDate(endDt.getDate() + 1);
      const exEnd = ymd(endDt);
      body = { summary: t, description: desc, start: { date: startDate }, end: { date: exEnd } };
      extEvt = { is_external: true, is_all_day: true, start_time: null, id: null, summary: t, description: desc, start_date: startDate, end_date: exEnd, author: "(MGEO 캘린더)", leave_type_name: t, status: "external" };
    } else {
      body = {
        summary: t, description: desc,
        start: { dateTime: `${startDate}T${startTime}:00+09:00`, timeZone: "Asia/Seoul" },
        end: { dateTime: `${endDate}T${endTime}:00+09:00`, timeZone: "Asia/Seoul" },
      };
      let gridEnd = endDate; if (gridEnd === startDate) { const d = new Date(startDate); d.setDate(d.getDate() + 1); gridEnd = ymd(d); }
      extEvt = { is_external: true, is_all_day: false, start_time: startTime, id: null, summary: t, description: desc, start_date: startDate, end_date: gridEnd, author: "(MGEO 캘린더)", leave_type_name: t, status: "external" };
    }
    const r = await createRawEvent(body);
    setSaving(false);
    if (!r.ok) { setErrText("일반 일정 등록 실패: " + (r.reason || "") + " (구글 캘린더 연동·권한 확인)"); return; }
    extEvt.id = r.eventId;
    onConvertedToGeneral?.(extEvt);
    onClose();
  }

  // 공통 유형 토글 동작 (모든 케이스에서 일관). value: 'leave' | 'general'
  const typeValue = createAsGeneral ? "general" : "leave";
  function selectLeaveType() {
    if (canChooseType) { setCreateAsGeneral(false); return; }
    // isEdit/ext는 이미 '신청' 측 → no-op
  }
  function selectGeneralType() {
    if (canChooseType) { setCreateAsGeneral(true); return; }       // 신규: 임시 전환
    if (isEdit) { setErrText(""); setConfirmKind("toGeneral"); return; }  // 기존 신청 → 일반(저장 시 확정 confirm)
    if (ext) { onBackToGeneral?.(ext); return; }                   // 변환 취소 → 일반 일정 편집으로 (양방향)
  }

  async function handleSave() {
    if (!author.trim()) { setErrText("성명을 입력해 주세요."); return; }
    if (!selectedType) { setErrText("휴가 종류를 선택해 주세요."); return; }
    setSaving(true);

    const payload = {
      author: author.trim(),
      leave_type_id: selectedType.id,
      leave_type_name: selectedType.name,
      start_date: startDate,
      end_date: endDate === startDate ? null : endDate,
      is_all_day: isAllDay,
      start_time: isAllDay ? null : `${startTime}:00`,
      end_time: isAllDay ? null : `${endTime}:00`,
      total_absence_days: absenceDays,
      annual_consumed: annualConsumed,
      status,
      approver: approver || null,
      destination: isTrip ? (destination || null) : null,
      companions: isTrip ? (companions || null) : null,
      trip_purpose: isTrip ? (tripPurpose || null) : null,
      memo: memo || null,
      // 외부 변환 시 google_calendar_event_id 매칭 → 다음 sync 때 PATCH로 캘린더 이벤트 갱신
      ...(ext?.id ? { google_calendar_event_id: ext.id } : {}),
      updated_at: new Date().toISOString(),
    };

    let savedRow, error;
    if (isEdit) {
      const r = await supabase.from("leave_requests").update(payload).eq("id", existing.id).select().single();
      savedRow = r.data; error = r.error;
    } else {
      const r = await supabase.from("leave_requests").insert([payload]).select().single();
      savedRow = r.data; error = r.error;
    }
    if (error) { setSaving(false); setErrText("저장 실패: " + error.message); return; }

    // 출장 + 김찬수·최승표면 보상 누적 재계산 (잔여 연차에 +N 누적)
    if (savedRow && selectedType?.name === "출장" && COMPENSATORY_TARGETS.has(savedRow.author)) {
      try {
        const year = new Date(savedRow.start_date).getFullYear();
        await recalculateCompensatoryGrant(savedRow.author, year, holidays || new Map());
      } catch (e) { console.warn("보상 누적 재계산 실패:", e); }
    }

    setSaving(false);
    onSaved();
  }

  // 브라우저 confirm/alert 금지 — 회사 인라인 확인 모달 + 인라인 에러 사용
  const [confirmKind, setConfirmKind] = useState(null); // null | 'del' | 'delExt'
  const [errText, setErrText] = useState("");

  function handleDelete() {
    if (!isEdit) return;
    setErrText("");
    setConfirmKind("del");
  }
  async function doDelete() {
    setConfirmKind(null);
    setSaving(true);
    if (existing?.google_calendar_event_id) {
      await tryDeleteCalendarEvent(existing.google_calendar_event_id);
    }
    const wasTrip = existing?.leave_type_name === "출장";
    const wasAuthor = existing?.author;
    const wasYear = existing?.start_date ? new Date(existing.start_date).getFullYear() : null;
    const { error } = await supabase.from("leave_requests").delete().eq("id", existing.id);
    if (!error && wasTrip && wasAuthor && wasYear && COMPENSATORY_TARGETS.has(wasAuthor)) {
      try { await recalculateCompensatoryGrant(wasAuthor, wasYear, holidays || new Map()); }
      catch (e) { console.warn("보상 누적 재계산 실패:", e); }
    }
    setSaving(false);
    if (error) { setErrText("삭제 실패: " + error.message); return; }
    onSaved();
  }

  function handleDeleteExternal() {
    if (!ext) return;
    setErrText("");
    setConfirmKind("delExt");
  }
  async function doDeleteExternal() {
    setConfirmKind(null);
    if (!ext) return;
    const ids = (ext._mergedIds && ext._mergedIds.length) ? ext._mergedIds : [ext.id];
    setSaving(true);
    const okIds = [], failIds = [];
    for (const id of ids) {
      const r = await tryDeleteCalendarEvent(id);
      if (r.ok) okIds.push(id); else failIds.push(id);
    }
    setSaving(false);
    if (failIds.length) {
      setErrText(`캘린더 삭제 실패 ${failIds.length}건 (성공 ${okIds.length}건). 토큰 만료 또는 권한 부족일 수 있습니다.`);
    }
    if (okIds.length) onExternalDeleted?.(okIds);
    if (!failIds.length) onClose();
  }
  const delExtMsg = ext
    ? (((ext._mergedIds && ext._mergedIds.length) ? ext._mergedIds.length : 1) > 1
        ? `이 일정은 ${ext._mergedIds.length}개의 캘린더 이벤트로 구성되어 있습니다. 모두 MGEO 캘린더에서 영구 삭제됩니다.`
        : "이 이벤트를 MGEO 캘린더에서 영구 삭제합니다.")
    : "";

  // 신청 → 일반 일정 변환: 신청행 삭제(연차·보상휴가 복구) + 캘린더 이벤트는 보존(일반 일정으로 전환)
  // 포테토뭉 조건부 GO: 승인상태 경고 + 미동기화 시 이벤트 생성 성공 후 삭제 + 실패 rollback + origin 표기
  async function doConvertToGeneral() {
    setConfirmKind(null);
    if (!isEdit || !existing) return;
    setSaving(true); setErrText("");
    let eventId = existing.google_calendar_event_id;
    let createdNow = false;
    const summary = `[${existing.author}] ${existing.leave_type_name || "일정"}${existing.destination ? " - " + existing.destination : ""}`;
    const description = (existing.memo ? existing.memo + "\n\n" : "") + "[휴가·출장 신청에서 일반 일정으로 전환됨]";
    // 1) 캘린더 이벤트 확보 (미동기화 신청이면 생성 성공 후에만 진행)
    if (!eventId) {
      const c = await createAllDayEvent({ summary, description, date: existing.start_date });
      if (!c.ok) { setSaving(false); setErrText("변환 실패(캘린더 이벤트 생성): " + (c.reason || "")); return; }
      eventId = c.eventId; createdNow = true;
    } else {
      await updateCalendarEvent(eventId, { description });  // origin 표기 (실패해도 비치명적)
    }
    // 2) 신청행 삭제 (+ 출장 보상휴가 재계산)
    const wasTrip = existing.leave_type_name === "출장";
    const wasAuthor = existing.author;
    const wasYear = existing.start_date ? new Date(existing.start_date).getFullYear() : null;
    const { error } = await supabase.from("leave_requests").delete().eq("id", existing.id);
    if (error) {
      if (createdNow) await tryDeleteCalendarEvent(eventId);  // rollback
      setSaving(false); setErrText("변환 실패(신청 삭제): " + error.message); return;
    }
    if (wasTrip && wasAuthor && wasYear && COMPENSATORY_TARGETS.has(wasAuthor)) {
      try { await recalculateCompensatoryGrant(wasAuthor, wasYear, holidays || new Map()); }
      catch (e) { console.warn("보상 누적 재계산 실패:", e); }
    }
    // 3) 즉시 반영용 external 이벤트 객체 (end는 exclusive로 환산)
    const endDt = new Date(existing.end_date || existing.start_date);
    endDt.setDate(endDt.getDate() + 1);
    const extEvt = {
      is_external: true,
      is_all_day: existing.is_all_day !== false,
      start_time: existing.is_all_day === false && existing.start_time ? existing.start_time.slice(0, 5) : null,
      id: eventId, summary, description,
      start_date: existing.start_date, end_date: ymd(endDt),
      author: "(MGEO 캘린더)", leave_type_name: summary, status: "external",
    };
    setSaving(false);
    onConvertedToGeneral?.(extEvt);
    onClose();
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(15, 23, 42, 0.5)" }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-5 py-4 flex items-center justify-between"
             style={{ background: THEME.navy, color: "#fff" }}>
          <div className="flex items-center gap-2">
            {isTrip ? <Plane size={18} /> : <CalendarIcon size={18} />}
            <h3 className="font-bold">{(isEdit || ext) ? "일정 수정" : "일정 등록"}</h3>
          </div>
          <button onClick={onClose} className="hover:opacity-70"><X size={18} /></button>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-3 text-sm">
          {errText && (
            <div className="rounded-md p-3 text-xs"
                 style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#7f1d1d" }}>
              {errText}
            </div>
          )}
          {/* ★ 공통 유형 토글 — 모든 모달에서 휴가·출장 신청 ↔ 일반 일정 양방향 전환 */}
          <EventTypeToggle value={typeValue}
                           onSelectLeave={selectLeaveType}
                           onSelectGeneral={selectGeneralType}
                           disabled={saving} />
          <div className="text-xs px-1" style={{ color: THEME.sub }}>
            {typeValue === "general"
              ? "MGEO 캘린더 일반 일정으로 저장합니다 (연차 차감·승인 흐름 없음)."
              : ext
                ? "저장하면 휴가·출장 신청으로 등록 + 캘린더 이벤트도 사이트 형식([직원] 종류)으로 갱신됩니다."
                : isEdit
                  ? "휴가·출장 신청입니다. 위에서 '일반 일정'을 누르면 신청 기록·연차 차감이 해제됩니다."
                  : "휴가·출장 신청으로 저장합니다 (연차·승인 관리)."}
          </div>
          {/* 일반 일정 등록 시 제목 입력 (신규에서 일반 선택 시) */}
          {canChooseType && createAsGeneral && (
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>제목</label>
              <input value={genTitle} onChange={(e) => setGenTitle(e.target.value)}
                     placeholder="예: 거래처 미팅, 자료 백업"
                     className="col-span-2 px-3 py-2 border rounded-md outline-none"
                     style={{ borderColor: THEME.line }} />
            </div>
          )}
          {!createAsGeneral && (
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>성명</label>
            <select value={author} onChange={(e) => setAuthor(e.target.value)}
                    disabled={!isOwner && !!viewerName && selectableAuthors.length <= 1}
                    className="col-span-2 px-3 py-2 border rounded-md outline-none disabled:bg-gray-50 disabled:text-gray-600"
                    style={{ borderColor: THEME.line }}>
              {/* 2026-06-08 권한 분리: 직원은 본인만 선택 가능 */}
              {selectableAuthors.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          )}
          {!createAsGeneral && (
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>종류</label>
            <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}
                    className="col-span-2 px-3 py-2 border rounded-md outline-none"
                    style={{ borderColor: THEME.line }}>
              {leaveTypes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          )}
          {/* 종일 토글 */}
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>일정 유형</label>
            <div className="col-span-2 flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={isAllDay} onChange={() => setIsAllDay(true)} />
                <span className="text-sm">종일</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={!isAllDay} onChange={() => setIsAllDay(false)} />
                <span className="text-sm">시간 지정</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>시작{isAllDay ? "일" : ""}</label>
            <div className="col-span-2 flex gap-2">
              <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }}
                     className="flex-1 px-3 py-2 border rounded-md outline-none"
                     style={{ borderColor: THEME.line }} />
              {!isAllDay && (
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                       className="w-28 px-3 py-2 border rounded-md outline-none"
                       style={{ borderColor: THEME.line }} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>종료{isAllDay ? "일" : ""}</label>
            <div className="col-span-2 flex gap-2">
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
                     className="flex-1 px-3 py-2 border rounded-md outline-none"
                     style={{ borderColor: THEME.line }} />
              {!isAllDay && (
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                       className="w-28 px-3 py-2 border rounded-md outline-none"
                       style={{ borderColor: THEME.line }} />
              )}
            </div>
          </div>

          {/* 출장 전용 필드 */}
          {isTrip && !createAsGeneral && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>출장지</label>
                <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)}
                       placeholder="예: 부산"
                       className="col-span-2 px-3 py-2 border rounded-md outline-none"
                       style={{ borderColor: THEME.line }} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>동행자</label>
                <input type="text" value={companions} onChange={(e) => setCompanions(e.target.value)}
                       placeholder="예: 최승표, 외주1명"
                       className="col-span-2 px-3 py-2 border rounded-md outline-none"
                       style={{ borderColor: THEME.line }} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>목적</label>
                <input type="text" value={tripPurpose} onChange={(e) => setTripPurpose(e.target.value)}
                       placeholder="예: HVDC 군산-평택 본탐사"
                       className="col-span-2 px-3 py-2 border rounded-md outline-none"
                       style={{ borderColor: THEME.line }} />
              </div>
            </>
          )}

          {!createAsGeneral && (
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>상태</label>
            {canSetStatus ? (
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                      className="col-span-2 px-3 py-2 border rounded-md outline-none"
                      style={{ borderColor: THEME.line }}>
                {STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              // 신청 단계 — 상태는 '신청' 고정 (승인/반려/취소는 대표만)
              <div className="col-span-2 px-3 py-2 rounded-md font-semibold"
                   style={{ background: THEME.accentSoft, color: THEME.navy, border: `1px solid ${THEME.line}` }}>
                {statusKo(status)}{!isEdit && " (제출 시 신청으로 등록됩니다)"}
              </div>
            )}
          </div>
          )}
          {!createAsGeneral && canSetStatus && (status === "approved" || status === "rejected") && (
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>승인자</label>
              <select value={approver} onChange={(e) => setApprover(e.target.value)}
                      className="col-span-2 px-3 py-2 border rounded-md outline-none"
                      style={{ borderColor: THEME.line }}>
                <option value="">선택 안 함</option>
                <option value={APPROVER_NAME}>{APPROVER_NAME}</option>
              </select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-start pt-2 font-semibold" style={{ color: THEME.sub }}>메모</label>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2}
                      className="col-span-2 px-3 py-2 border rounded-md outline-none resize-none"
                      style={{ borderColor: THEME.line }} />
          </div>

          {/* 출장 잔여 연차 보상 안내 */}
          {showCompensatoryNotice && (
            <div className="rounded-md p-3 text-xs"
                 style={{ background: "#e7f5ec", border: "1px solid #86c79a", color: "#1a5d2e" }}>
              <div className="font-bold mb-1">🎁 잔여 연차 보상</div>
              <div>
                출장 기간에 휴일(토·일·공휴일·대체공휴일) <b>{holidayInRange}일</b>이 포함되어,
                저장 시 <b>잔여 연차에 +{holidayInRange}일</b>이 누적됩니다.
                별도 일정으로 등록되지 않으며, 직원이 향후 휴가를 신청해 사용합니다.
              </div>
            </div>
          )}

          {/* 요약 */}
          {!createAsGeneral && (
          <div className="rounded-md p-3 text-xs" style={{ background: THEME.accentSoft }}>
            <div className="flex items-center justify-between">
              <span style={{ color: THEME.sub }}>총 일수</span>
              <span className="font-bold" style={{ color: THEME.navy }}>{days}일</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: THEME.sub }}>부재일</span>
              <span className="font-bold" style={{ color: THEME.navy }}>{absenceDays}일</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: THEME.sub }}>연차 소진</span>
              <span className="font-bold" style={{ color: annualConsumed > 0 ? THEME.warn : THEME.green }}>
                {annualConsumed}일
              </span>
            </div>
          </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 flex items-center justify-between border-t"
             style={{ borderColor: THEME.line, background: THEME.soft }}>
          {isEdit ? (
            <button onClick={handleDelete} disabled={saving}
                    className="flex items-center gap-1 text-xs font-semibold hover:underline"
                    style={{ color: "#dc2626" }}>
              <Trash2 size={13} /> 삭제
            </button>
          ) : ext ? (
            <button onClick={handleDeleteExternal} disabled={saving}
                    className="flex items-center gap-1 text-xs font-semibold hover:underline"
                    style={{ color: "#dc2626" }}>
              <Trash2 size={13} /> 삭제
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving}
                    className="px-4 py-2 text-sm rounded-md border"
                    style={{ borderColor: THEME.line, color: THEME.sub }}>
              취소
            </button>
            <button onClick={createAsGeneral ? handleSaveGeneral : handleSave} disabled={saving}
                    className="px-4 py-2 text-sm font-semibold rounded-md text-white"
                    style={{ background: createAsGeneral ? THEME.accent : THEME.navy }}>
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>

    {confirmKind && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
           style={{ background: "rgba(15,23,42,.55)" }}>
        <div onClick={(e) => e.stopPropagation()}
             style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(420px,100%)", boxShadow: "0 18px 50px rgba(0,0,0,.3)" }}>
          <h3 style={{ margin: 0, color: THEME.navy, fontSize: 17, fontWeight: 800 }}>
            {confirmKind === "toGeneral" ? "일반 일정으로 변환할까요?" : "삭제할까요?"}
          </h3>
          <p style={{ margin: "8px 0 0", color: THEME.sub, fontSize: 13, lineHeight: 1.55 }}>
            {confirmKind === "del"
              ? "이 신청을 삭제합니다. 복구하기 어렵습니다."
              : confirmKind === "toGeneral"
                ? `이 신청을 MGEO 캘린더 일반 일정으로 전환합니다. 신청 기록은 삭제되고 연차 차감·출장 보상휴가가 해제됩니다. 캘린더 일정 자체는 그대로 남습니다.${existing?.status === "approved" ? " ⚠ 이미 승인된 신청입니다 — 정산·급여 반영 여부를 확인하세요." : ""}`
                : delExtMsg}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button onClick={() => setConfirmKind(null)}
                    style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${THEME.line}`, background: "#fff", color: THEME.sub, fontWeight: 600, cursor: "pointer" }}>취소</button>
            {confirmKind === "toGeneral" ? (
              <button onClick={doConvertToGeneral}
                      style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${THEME.accent}`, background: THEME.accent, color: "#fff", fontWeight: 700, cursor: "pointer" }}>변환</button>
            ) : (
              <button onClick={confirmKind === "del" ? doDelete : doDeleteExternal}
                      style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #dc2626", background: "#dc2626", color: "#fff", fontWeight: 700, cursor: "pointer" }}>삭제</button>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
