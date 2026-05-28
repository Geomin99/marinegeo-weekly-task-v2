import { useState, useEffect, useMemo, useRef } from "react";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X,
  Plane, Check, Clock, AlertCircle, Trash2,
  ChevronDown, ChevronUp, Users, Link2,
} from "lucide-react";
import { supabase } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────
// 회사 디자인 토큰 (마린엔지오 navy/blue 표준)
// ─────────────────────────────────────────────────────────────
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

// 상태 한글 매핑
const STATUS_LABEL = {
  pending:   "대기",
  approved:  "승인",
  rejected:  "반려",
  cancelled: "취소",
};
function statusKo(s) { return STATUS_LABEL[s] || s; }

const STATUS_OPTIONS = [
  { value: "pending",   label: "대기" },
  { value: "approved",  label: "승인" },
  { value: "rejected",  label: "반려" },
  { value: "cancelled", label: "취소" },
];

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

function daysBetween(start, end) {
  if (!end || end === start) return 1;
  const s = new Date(start), e = new Date(end);
  return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
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
export default function LeaveView() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());  // 0~11

  const [leaveTypes, setLeaveTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [externalEvents, setExternalEvents] = useState([]);  // MGEO 캘린더 원본 이벤트 (읽기 표시용)

  const [modalOpen, setModalOpen] = useState(false);
  const [modalInit, setModalInit] = useState(null);  // {date} or {request}
  const [showBalances, setShowBalances] = useState(false);  // 개인정보 보호 — 기본 숨김

  // 초기 로드
  useEffect(() => { reloadAll(); }, []);

  async function reloadAll() {
    setLoading(true);
    const [t, r, b] = await Promise.all([
      supabase.from("leave_types").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("leave_requests").select("*").order("start_date", { ascending: false }),
      supabase.from("annual_leave_balances").select("*").order("author"),
    ]);
    if (t.data) setLeaveTypes(t.data);
    if (r.data) setRequests(r.data);
    if (b.data) setBalances(b.data);
    setLoading(false);
  }

  // 월별 그리드 셀
  const cells = useMemo(() => getMonthGrid(year, month), [year, month]);

  // 합쳐진 이벤트 (사이트 신청 + 외부 MGEO 캘린더) — 가로 spanning bar용
  const allEvents = useMemo(() => {
    const knownGcalIds = new Set(requests.map(r => r.google_calendar_event_id).filter(Boolean));
    const fromRequests = requests.map(r => ({
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
  }, [requests, externalEvents]);

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
      const grant = Number(b.annual_grant) + Number(b.annual_additional || 0);
      return { ...b, used, remaining: grant - used, grant };
    });
  }, [balances, requests]);

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

  function openEdit(request) {
    if (request.is_external) {
      const info = [
        `📅 MGEO 캘린더 원본 이벤트`,
        ``,
        `제목: ${request.summary}`,
        `기간: ${request.start_date} ~ ${request.end_date}`,
        request.description ? `\n메모:\n${request.description}` : "",
        ``,
        `이 이벤트는 사이트의 휴가 신청이 아닌 구글 캘린더 원본입니다.`,
        `사이트로 가져오려면 "신청" 버튼으로 직접 등록하거나,`,
        `다음 업데이트에서 추가될 "캘린더에서 가져오기" 기능을 기다려주세요.`,
      ].filter(Boolean).join("\n");
      alert(info);
      return;
    }
    setModalInit({ request });
    setModalOpen(true);
  }

  return (
    <div className="px-6 py-6">
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
                              onExternalEvents={setExternalEvents} />
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
      />

      {/* ── 범례 ──────────────────────────────── */}
      <div className="flex items-center gap-4 mt-4 text-xs"
           style={{ color: THEME.sub }}>
        <span>직원:</span>
        {Object.entries(AUTHOR_COLORS).map(([name, c]) => (
          <span key={name} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded"
                  style={{ background: c.bg }}></span>
            {name}
          </span>
        ))}
        <span className="ml-4">상태:</span>
        <span className="flex items-center gap-1.5">
          <Clock size={12} /> 대기
        </span>
        <span className="flex items-center gap-1.5">
          <Check size={12} style={{ color: THEME.green }} /> 승인
        </span>
      </div>

      {/* ── 직원별 잔여 (달력 아래, 클릭으로 토글 — 개인정보 보호) ──── */}
      <div className="mt-6 rounded-xl border" style={{ background: "#fff", borderColor: THEME.line }}>
        <button onClick={() => setShowBalances(v => !v)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 rounded-xl">
          <div className="flex items-center gap-2">
            <Users size={14} style={{ color: THEME.navy }} />
            <span className="text-sm font-bold" style={{ color: THEME.navy }}>직원별 휴가 현황</span>
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

      {/* ── 최근 신청 목록 ─────────────────────── */}
      <RecentRequestList requests={requests.slice(0, 10)} onEdit={openEdit} />

      {/* ── 신청·수정 모달 ────────────────────── */}
      {modalOpen && (
        <LeaveRequestModal
          init={modalInit}
          leaveTypes={leaveTypes}
          authors={balances.map(b => b.author)}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); reloadAll(); }}
        />
      )}
    </div>
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

function GoogleCalendarSync({ requests, onSyncDone, onExternalEvents }) {
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
            setMsg({ kind: "err", text: `OAuth 실패: ${resp.error}` });
          }
          setBusy(false); return;
        }
        const newToken = {
          access_token: resp.access_token,
          expires_at: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000,
        };
        try { localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(newToken)); } catch {}
        setToken(newToken);
      },
    });
    // init 직후 silent 토큰 시도 — 이미 동의한 사용자면 popup 없이 자동 발급
    const stored = loadStoredToken();
    if (!stored || stored.expires_at <= Date.now() + 60_000) {
      try { tokenClientRef.current.requestAccessToken({ prompt: "" }); } catch {}
    }
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
        setMsg({ kind: "ok", text: "MGEO 연결됨 — 일정 가져오는 중..." });
        await pullEvents(mgeo.id, token.access_token);
      } catch (e) {
        setMsg({ kind: "err", text: `캘린더 조회 실패: ${e.message}` });
      } finally {
        setBusy(false);
      }
    })();
  }, [token]);

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
    tokenClientRef.current.requestAccessToken({ prompt: token ? "" : "consent" });
  }

  async function syncToCalendar(opts = {}) {
    const { silent = false, onlyNew = false } = opts;
    if (!calendarId || !token || !requests?.length) return;
    if (!silent) { setBusy(true); setMsg(null); }
    let pushed = 0, updated = 0, errors = 0;
    for (const req of requests) {
      try {
        if (req.status === "rejected" || req.status === "cancelled") continue;
        if (onlyNew && req.google_calendar_event_id) continue;  // 신규만 push
        const startDate = req.start_date;
        const endDate = req.end_date || req.start_date;
        const summary = `[${req.author}] ${req.leave_type_name || "휴가"}${req.destination ? ` - ${req.destination}` : ""}`;
        const description = [
          `상태: ${statusKo(req.status)}`,
          req.memo && `메모: ${req.memo}`,
          req.companions && `동행: ${req.companions}`,
          req.trip_purpose && `목적: ${req.trip_purpose}`,
        ].filter(Boolean).join("\n");
        let event;
        if (req.is_all_day === false && req.start_time && req.end_time) {
          // 시간 지정 이벤트 (회의·외근·기타 등)
          const startISO = `${startDate}T${req.start_time.slice(0, 8)}+09:00`;
          const endISO = `${endDate}T${req.end_time.slice(0, 8)}+09:00`;
          event = { summary, description,
                    start: { dateTime: startISO, timeZone: "Asia/Seoul" },
                    end:   { dateTime: endISO,   timeZone: "Asia/Seoul" } };
        } else {
          // 종일 이벤트 (휴가·출장 등) — Google all-day는 end exclusive
          const endDt = new Date(endDate);
          endDt.setDate(endDt.getDate() + 1);
          event = { summary, description,
                    start: { date: startDate },
                    end:   { date: ymd(endDt) } };
        }
        const calUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
        if (req.google_calendar_event_id) {
          const r = await fetch(`${calUrl}/${req.google_calendar_event_id}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify(event),
          });
          if (r.ok) updated++; else errors++;
        } else {
          const r = await fetch(calUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify(event),
          });
          const data = await r.json();
          if (data.id) {
            await supabase.from("leave_requests")
              .update({ google_calendar_event_id: data.id })
              .eq("id", req.id);
            pushed++;
          } else errors++;
        }
      } catch (e) {
        errors++;
      }
    }
    if (!silent) setBusy(false);
    if (silent) {
      if (pushed || updated || errors) {
        setMsg({ kind: errors ? "err" : "ok",
                 text: `자동 동기화: 신규 ${pushed} · 갱신 ${updated}${errors ? " · 실패 " + errors : ""}` });
      }
    } else {
      alert(`MGEO 캘린더 동기화 완료\n신규 ${pushed}건 · 갱신 ${updated}건 · 실패 ${errors}건`);
    }
    if (onSyncDone && (pushed || updated)) onSyncDone();
  }

  const valid = token && token.expires_at > Date.now();

  // 자동 동기화: token+calendarId 있고 아직 push 안 된 신청이 있으면 1.5초 후 silent push
  useEffect(() => {
    if (!valid || !calendarId || !requests?.length) return;
    const needPush = requests.some(r =>
      !r.google_calendar_event_id &&
      r.status !== "rejected" && r.status !== "cancelled"
    );
    if (!needPush) return;
    const t = setTimeout(() => { syncToCalendar({ silent: true, onlyNew: true }); }, 1500);
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

function CalendarGrid({ cells, events, onCellClick, onEventClick, today }) {
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
              const textColor = dow === 0 ? "#dc2626" : dow === 6 ? THEME.blue : THEME.ink;
              return (
                <div key={ci}
                     onClick={() => onCellClick(cell.date)}
                     className="border-r cursor-pointer hover:bg-slate-50 transition"
                     style={{
                       borderColor: THEME.line2,
                       background: cell.other ? "#fafbfc" : isToday ? THEME.accentSoft : "#fff",
                       opacity: cell.other ? 0.45 : 1,
                       padding: "8px 8px 0 8px",
                     }}>
                  <div className="flex items-center justify-between">
                    <span className={"text-[15px] " + (isToday ? "font-bold" : "font-semibold")}
                          style={{ color: textColor }}>
                      {cell.date.getDate()}
                    </span>
                    {isToday && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: THEME.accent, color: "#fff" }}>오늘</span>
                    )}
                  </div>
                </div>
              );
            })}
            {/* 이벤트 막대 (absolute layer) — absolute 자식은 paddingTop 무시하므로 top에 HEADER_HEIGHT 직접 더함 */}
            <div className="absolute inset-0 pointer-events-none">
              {visible.map((p, i) => {
                const ev = p.event;
                const isExternal = ev.is_external;
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
                // 색상 전략: 진한 배경 + 흰 글자 (모든 막대 통일). pending은 dashed border로 구분.
                const bg = isExternal ? "#64748b" : c.bg;
                const fg = "#ffffff";
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
                         border: isPending ? `1.5px dashed rgba(255,255,255,0.55)` : "none",
                         borderLeft: isTrip ? `4px solid ${THEME.warn}` : (isPending ? `1.5px dashed rgba(255,255,255,0.55)` : "none"),
                         fontStyle: isExternal ? "italic" : "normal",
                         fontWeight: 700,
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
// 신청·수정 모달
// ─────────────────────────────────────────────────────────────
function LeaveRequestModal({ init, leaveTypes, authors, onClose, onSaved }) {
  const isEdit = !!init?.request;
  const existing = init?.request;
  // authors prop이 없거나 비어 있으면 기본 직원 명단 사용
  const authorOptions = (authors && authors.length) ? authors : DEFAULT_AUTHORS;

  const [author, setAuthor] = useState(existing?.author || authorOptions[0] || "");
  const [leaveTypeId, setLeaveTypeId] = useState(existing?.leave_type_id || (leaveTypes[0]?.id || ""));
  const [startDate, setStartDate] = useState(existing?.start_date || init?.date || ymd(new Date()));
  const [endDate, setEndDate] = useState(existing?.end_date || existing?.start_date || init?.date || ymd(new Date()));
  const [isAllDay, setIsAllDay] = useState(existing?.is_all_day !== false);  // default 종일
  const [startTime, setStartTime] = useState(hhmm(existing?.start_time) || "09:30");
  const [endTime, setEndTime] = useState(hhmm(existing?.end_time) || "10:30");
  const [destination, setDestination] = useState(existing?.destination || "");
  const [companions, setCompanions] = useState(existing?.companions || "");
  const [tripPurpose, setTripPurpose] = useState(existing?.trip_purpose || "");
  const [memo, setMemo] = useState(existing?.memo || "");
  const [status, setStatus] = useState(existing?.status || "pending");
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
  const annualConsumed = useMemo(
    () => (selectedType?.annual_consumption || 0) * days,
    [selectedType, days]
  );
  const absenceDays = useMemo(
    () => (selectedType?.absence_days || 1) * days,
    [selectedType, days]
  );

  async function handleSave() {
    if (!author.trim()) { alert("성명을 입력해 주세요."); return; }
    if (!selectedType) { alert("휴가 종류를 선택해 주세요."); return; }
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
      updated_at: new Date().toISOString(),
    };

    let error;
    if (isEdit) {
      ({ error } = await supabase.from("leave_requests").update(payload).eq("id", existing.id));
    } else {
      ({ error } = await supabase.from("leave_requests").insert([payload]));
    }
    setSaving(false);
    if (error) { alert("저장 실패: " + error.message); return; }
    onSaved();
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!confirm("정말 이 신청을 삭제하시겠습니까?")) return;
    setSaving(true);
    const { error } = await supabase.from("leave_requests").delete().eq("id", existing.id);
    setSaving(false);
    if (error) { alert("삭제 실패: " + error.message); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(15, 23, 42, 0.5)" }}
         onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-5 py-4 flex items-center justify-between"
             style={{ background: THEME.navy, color: "#fff" }}>
          <div className="flex items-center gap-2">
            {isTrip ? <Plane size={18} /> : <CalendarIcon size={18} />}
            <h3 className="font-bold">{isEdit ? "신청 수정" : "신규 신청"}</h3>
          </div>
          <button onClick={onClose} className="hover:opacity-70"><X size={18} /></button>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>성명</label>
            <select value={author} onChange={(e) => setAuthor(e.target.value)}
                    className="col-span-2 px-3 py-2 border rounded-md outline-none"
                    style={{ borderColor: THEME.line }}>
              {authorOptions.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
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
          {isTrip && (
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

          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>상태</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
                    className="col-span-2 px-3 py-2 border rounded-md outline-none"
                    style={{ borderColor: THEME.line }}>
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {(status === "approved" || status === "rejected") && (
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>승인자</label>
              <select value={approver} onChange={(e) => setApprover(e.target.value)}
                      className="col-span-2 px-3 py-2 border rounded-md outline-none"
                      style={{ borderColor: THEME.line }}>
                <option value="">선택 안 함</option>
                {authorOptions.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-start pt-2 font-semibold" style={{ color: THEME.sub }}>메모</label>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2}
                      className="col-span-2 px-3 py-2 border rounded-md outline-none resize-none"
                      style={{ borderColor: THEME.line }} />
          </div>

          {/* 요약 */}
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
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving}
                    className="px-4 py-2 text-sm rounded-md border"
                    style={{ borderColor: THEME.line, color: THEME.sub }}>
              취소
            </button>
            <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 text-sm font-semibold rounded-md text-white"
                    style={{ background: THEME.navy }}>
              {saving ? "저장 중..." : isEdit ? "수정" : "신청"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
