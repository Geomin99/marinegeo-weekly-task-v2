import { useState, useEffect, useMemo } from "react";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X,
  Plane, Check, Clock, AlertCircle, Trash2,
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

  const [modalOpen, setModalOpen] = useState(false);
  const [modalInit, setModalInit] = useState(null);  // {date} or {request}

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

  // 셀별 이벤트 매핑
  const eventsByDate = useMemo(() => {
    const map = {};
    requests.forEach(r => {
      const s = r.start_date;
      const e = r.end_date || r.start_date;
      // s~e 범위 안의 모든 날짜에 표시
      const cur = new Date(s);
      const end = new Date(e);
      while (cur <= end) {
        const key = ymd(cur);
        if (!map[key]) map[key] = [];
        map[key].push(r);
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }, [requests]);

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
    setModalInit({ request });
    setModalOpen(true);
  }

  return (
    <div className="px-6 py-6">
      {/* ── 직원별 잔여 카드 ──────────────────────── */}
      <EmployeeBalanceCards balances={balanceWithUsage} />

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
        <button onClick={() => openNew(new Date())}
                className="px-4 py-2 text-sm font-semibold rounded-md flex items-center gap-1.5 shadow-md hover:shadow-lg transition"
                style={{ background: THEME.navy, color: "#fff" }}>
          <Plus size={15} strokeWidth={3} />
          신청
        </button>
      </div>

      {/* ── 달력 그리드 ───────────────────────── */}
      <CalendarGrid
        cells={cells}
        eventsByDate={eventsByDate}
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
          <Clock size={12} /> pending
        </span>
        <span className="flex items-center gap-1.5">
          <Check size={12} style={{ color: THEME.green }} /> approved
        </span>
      </div>

      {/* ── 최근 신청 목록 ─────────────────────── */}
      <RecentRequestList requests={requests.slice(0, 10)} onEdit={openEdit} />

      {/* ── 신청·수정 모달 ────────────────────── */}
      {modalOpen && (
        <LeaveRequestModal
          init={modalInit}
          leaveTypes={leaveTypes}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); reloadAll(); }}
        />
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
function CalendarGrid({ cells, eventsByDate, onCellClick, onEventClick, today }) {
  const todayStr = ymd(today);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: THEME.line }}>
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7" style={{ background: THEME.navy }}>
        {weekdays.map((w, i) => (
          <div key={w} className="text-center py-2 text-xs font-bold text-white">{w}</div>
        ))}
      </div>
      {/* 날짜 셀 */}
      <div className="grid grid-cols-7" style={{ background: "#fff" }}>
        {cells.map((cell, idx) => {
          const dateStr = ymd(cell.date);
          const events = eventsByDate[dateStr] || [];
          const isToday = dateStr === todayStr;
          const dow = cell.date.getDay();
          const textColor = dow === 0 ? "#dc2626" : dow === 6 ? THEME.blue : THEME.ink;
          return (
            <div key={idx}
                 onClick={() => onCellClick(cell.date)}
                 className="border-b border-r p-1.5 cursor-pointer hover:bg-slate-50 transition"
                 style={{
                   minHeight: 88,
                   borderColor: THEME.line2,
                   background: cell.other ? "#fafbfc" : isToday ? THEME.accentSoft : "#fff",
                   opacity: cell.other ? 0.45 : 1,
                 }}>
              <div className="flex items-center justify-between mb-1">
                <span className={"text-xs " + (isToday ? "font-bold" : "")}
                      style={{ color: textColor }}>
                  {cell.date.getDate()}
                </span>
                {isToday && (
                  <span className="text-[9px] font-bold px-1 rounded"
                        style={{ background: THEME.accent, color: "#fff" }}>오늘</span>
                )}
              </div>
              <div className="space-y-0.5">
                {events.slice(0, 3).map((e, i) => {
                  const c = getAuthorColor(e.author);
                  const isTrip = e.leave_type_name === "출장";
                  return (
                    <div key={i}
                         onClick={(ev) => { ev.stopPropagation(); onEventClick(e); }}
                         className="text-[10px] px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80"
                         style={{
                           background: e.status === "approved" ? c.bg : c.soft,
                           color: e.status === "approved" ? c.text : c.bg,
                           borderLeft: isTrip ? `2px solid ${THEME.warn}` : "none",
                         }}
                         title={`${e.author} · ${e.leave_type_name}${e.destination ? " · " + e.destination : ""}`}>
                      {isTrip && "✈ "}{e.author} · {e.leave_type_name}
                    </div>
                  );
                })}
                {events.length > 3 && (
                  <div className="text-[9px]" style={{ color: THEME.sub }}>+{events.length - 3}건</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
                {r.status}
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
function LeaveRequestModal({ init, leaveTypes, onClose, onSaved }) {
  const isEdit = !!init?.request;
  const existing = init?.request;

  const [author, setAuthor] = useState(existing?.author || "");
  const [leaveTypeId, setLeaveTypeId] = useState(existing?.leave_type_id || (leaveTypes[0]?.id || ""));
  const [startDate, setStartDate] = useState(existing?.start_date || init?.date || ymd(new Date()));
  const [endDate, setEndDate] = useState(existing?.end_date || existing?.start_date || init?.date || ymd(new Date()));
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
            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)}
                   placeholder="예: 김찬수"
                   className="col-span-2 px-3 py-2 border rounded-md outline-none"
                   style={{ borderColor: THEME.line }} />
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
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>시작일</label>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }}
                   className="col-span-2 px-3 py-2 border rounded-md outline-none"
                   style={{ borderColor: THEME.line }} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>종료일</label>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
                   className="col-span-2 px-3 py-2 border rounded-md outline-none"
                   style={{ borderColor: THEME.line }} />
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
              <option value="pending">pending (대기)</option>
              <option value="approved">approved (승인)</option>
              <option value="rejected">rejected (반려)</option>
              <option value="cancelled">cancelled (취소)</option>
            </select>
          </div>
          {(status === "approved" || status === "rejected") && (
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-1 self-center font-semibold" style={{ color: THEME.sub }}>승인자</label>
              <input type="text" value={approver} onChange={(e) => setApprover(e.target.value)}
                     placeholder="예: 여은민"
                     className="col-span-2 px-3 py-2 border rounded-md outline-none"
                     style={{ borderColor: THEME.line }} />
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
