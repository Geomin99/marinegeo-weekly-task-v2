import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gcalReady, syncLeaveRequests } from "./gcal";
import {
  AlertCircle,
  Archive,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  FileText,
  Filter,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mic,
  Plane,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import LeaveView from "./LeaveView.jsx";
import CenterView from "./CenterView.jsx";
import InboxView from "./InboxView.jsx";
import VoiceLogView from "./VoiceLogView.jsx";
import MeetingView from "./MeetingView.jsx";
import { ErpHero } from "./ErpHero.jsx";

const BRAND = {
  navy: "#1f3a5f",
  blue: "#245f9a",
  accent: "#0b7cc1",
  mint: "#14b8a6",
  ink: "#142033",
  muted: "#637083",
  line: "#d9e3ee",
  soft: "#f4f7fb",
};

const AVATAR_COLORS = [
  { bg: "#e8f2ff", text: "#1f3a5f" },
  { bg: "#e7f7f3", text: "#0f766e" },
  { bg: "#fff3dc", text: "#9a5b00" },
  { bg: "#f0edff", text: "#5b3cb5" },
  { bg: "#ffe8ec", text: "#b4234b" },
  { bg: "#e9eef6", text: "#31445f" },
];

const NAV_ITEMS = [
  { id: "dashboard", label: "대시보드", icon: LayoutDashboard },
  { id: "journal", label: "주간업무", icon: FileText },
  { id: "leave", label: "캘린더", icon: CalendarDays },
  { id: "center", label: "해양벤처진흥센터", icon: BriefcaseBusiness },
];

function formatYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayLabel() {
  const d = new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function getMondayOfThisWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMondayDateStr() {
  return formatYMD(getMondayOfThisWeek());
}

function getNextMonday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 7);
  return formatYMD(d);
}

function getWeekInfo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
  const week = Math.ceil((d.getDate() + firstDay.getDay()) / 7);
  return `${d.getMonth() + 1}월 ${week}주차`;
}

function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const monday = getMondayOfThisWeek();
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const target = new Date(`${dateStr}T00:00:00`);
  return target >= monday && target <= sunday;
}

function avatarFor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Toast({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={`toast toast-${notice.type || "info"}`}>
      <span>{notice.message}</span>
      <button onClick={onClose} aria-label="알림 닫기">
        <X size={14} />
      </button>
    </div>
  );
}

function ConfirmDialog({ confirm, onCancel, onConfirm }) {
  if (!confirm) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon">
          <AlertCircle size={20} />
        </div>
        <div>
          <h3>{confirm.title}</h3>
          <p>{confirm.message}</p>
        </div>
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onCancel}>취소</button>
          <button className="btn btn-danger" onClick={onConfirm}>삭제</button>
        </div>
      </div>
    </div>
  );
}

function AutoResizeTextarea({ value, onChange, placeholder, className, minRows = 10 }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const minHeight = lineHeight * minRows + 28;
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
  }, [value, minRows]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      style={{ overflow: "hidden" }}
    />
  );
}

function MiniCalendar() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  // 공휴일·대체공휴일 (캘린더 탭이 구글에서 받아 localStorage에 캐시한 값). 휴일/공휴일만 색 표시.
  const holidays = useMemo(() => {
    try { const raw = localStorage.getItem("mgeo_holidays_v1"); if (raw) return new Map(JSON.parse(raw)); }
    catch { /* noop */ }
    return new Map();
  }, []);
  const pad2 = (n) => String(n).padStart(2, "0");
  const firstDay = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();
  const cells = [];

  for (let i = firstDay.getDay() - 1; i >= 0; i -= 1) cells.push({ day: prevMonthLastDay - i, type: "prev" });
  for (let i = 1; i <= daysInMonth; i += 1) cells.push({ day: i, type: "current" });
  while (cells.length < 42) cells.push({ day: cells.length - daysInMonth - firstDay.getDay() + 1, type: "next" });

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewYear((v) => v - 1);
      setViewMonth(11);
    } else {
      setViewMonth((v) => v - 1);
    }
  };

  const goNext = () => {
    if (viewMonth === 11) {
      setViewYear((v) => v + 1);
      setViewMonth(0);
    } else {
      setViewMonth((v) => v + 1);
    }
  };

  return (
    <section className="panel compact">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2>{viewYear}년 {viewMonth + 1}월</h2>
        </div>
        <div className="icon-pair">
          <button onClick={goPrev} aria-label="이전 달"><ChevronLeft size={15} /></button>
          <button onClick={goNext} aria-label="다음 달"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="mini-weekdays">
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="mini-calendar-grid">
        {cells.map((cell, idx) => {
          const isCur = cell.type === "current";
          const isToday = isCur && viewYear === today.getFullYear() && viewMonth === today.getMonth() && cell.day === today.getDate();
          const col = idx % 7;
          const dateStr = isCur ? `${viewYear}-${pad2(viewMonth + 1)}-${pad2(cell.day)}` : null;
          const holName = dateStr ? holidays.get(dateStr) : null;
          const isHoliday = !!holName || (isCur && col === 0);   // 공휴일 또는 일요일
          const isSat = isCur && col === 6;
          return (
            <span key={`${cell.type}-${idx}`}
                  className={`${cell.type !== "current" ? "dim" : ""} ${isToday ? "today" : ""}`}
                  title={holName || undefined}
                  style={isCur && !isToday ? { color: isHoliday ? "#dc2626" : isSat ? "#245f9a" : undefined, fontWeight: holName ? 700 : undefined } : undefined}>
              {cell.day}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function EntryEditor({ entry, isCurrent, isNew, isExpanded, onToggle, onSave, onDelete, onCancel, onNotice }) {
  const [localData, setLocalData] = useState({
    author: entry.author || "",
    thisWeekDate: entry.thisWeekDate || getMondayDateStr(),
    nextWeekDate: entry.nextWeekDate || getNextMonday(getMondayDateStr()),
    thisWeekTasks: entry.thisWeekTasks || "",
    nextWeekTasks: entry.nextWeekTasks || "",
    notes: entry.notes || "",
  });
  const [status, setStatus] = useState("idle");
  const saveTimerRef = useRef(null);

  const doSave = useCallback(async (dataToSave) => {
    const data = dataToSave || localData;
    if (!data.author.trim() || !data.thisWeekTasks.trim()) {
      setStatus("idle");
      return;
    }

    setStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const result = await onSave(entry.id, {
      ...data,
      weekLabel: `${getWeekInfo(data.thisWeekDate)}(${data.author.trim()})`,
    }, isNew);

    if (result?.success) {
      setStatus("saved");
      onNotice?.("저장되었습니다.", "success");
      window.setTimeout(() => setStatus("idle"), 1200);
    } else {
      setStatus("editing");
    }
  }, [entry.id, isNew, localData, onNotice, onSave]);

  const scheduleSave = useCallback((next) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setStatus("editing");
    saveTimerRef.current = window.setTimeout(() => doSave(next), 1400);
  }, [doSave]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const handleChange = (field, value) => {
    const next = { ...localData, [field]: value };
    if (field === "thisWeekDate") next.nextWeekDate = getNextMonday(value);
    setLocalData(next);
    scheduleSave(next);
  };

  const avatar = avatarFor(localData.author);
  const heading = localData.author
    ? `${getWeekInfo(localData.thisWeekDate)} · ${localData.author}`
    : isNew ? "새 업무일지 작성" : entry.weekLabel;

  return (
    <article className={`work-card ${isCurrent ? "current" : ""} ${isNew ? "new" : ""} ${!isExpanded ? "collapsed" : ""}`}>
      <div className="work-card-header">
        <button className="work-card-toggle" onClick={onToggle} disabled={isNew} aria-expanded={isExpanded}>
          <span className="fold-icon">
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          {entry.displayNumber && <span className="entry-number">#{entry.displayNumber}</span>}
          <span className="avatar" style={{ backgroundColor: avatar.bg, color: avatar.text }}>
            {(localData.author || "?").slice(0, 1)}
          </span>
          <div>
            <div className="work-title-row">
              {localData.author ? (
                <>
                  <span className="week-pill">{getWeekInfo(localData.thisWeekDate)}</span>
                  <h3>{localData.author}</h3>
                </>
              ) : (
                <h3>{heading}</h3>
              )}
              {isCurrent && <span className="badge blue">이번 주</span>}
              {isNew && <span className="badge amber">신규</span>}
            </div>
            <p>{localData.thisWeekDate} 시작 · 다음 주 {localData.nextWeekDate}</p>
          </div>
        </button>
        <div className="work-actions">
          {status === "editing" && <span className="save-state amber"><CircleDot size={12} /> 편집 중</span>}
          {status === "saving" && <span className="save-state"><Loader2 size={12} className="spin" /> 저장 중</span>}
          {status === "saved" && <span className="save-state green"><Check size={12} /> 저장됨</span>}
          <button className="btn btn-primary" onClick={() => doSave()}>
            <Save size={15} /> 저장
          </button>
          {isNew ? (
            <button className="btn btn-ghost" onClick={onCancel}>취소</button>
          ) : (
            <button className="icon-btn danger" onClick={() => onDelete(entry.id)} aria-label="삭제">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="entry-meta-grid">
            <label>
              <span>작성자</span>
              <input value={localData.author} onChange={(e) => handleChange("author", e.target.value)} placeholder="이름" />
            </label>
            <label>
              <span>이번 주 시작일</span>
              <input type="date" value={localData.thisWeekDate} onChange={(e) => handleChange("thisWeekDate", e.target.value)} />
            </label>
            <label>
              <span>다음 주 시작일</span>
              <input type="date" value={localData.nextWeekDate} disabled />
            </label>
          </div>

          <div className="worksheet-grid">
            <section className="sheet-column this-week">
              <div className="sheet-head">
                <Clock3 size={16} />
                <span>이번 주 수행</span>
              </div>
              <AutoResizeTextarea
                value={localData.thisWeekTasks}
                onChange={(e) => handleChange("thisWeekTasks", e.target.value)}
                placeholder={"1. 프로젝트명\n  - 진행 내용\n  - 완료/이슈/결과"}
                minRows={16}
                className="sheet-textarea"
              />
            </section>
            <section className="sheet-column next-week">
              <div className="sheet-head">
                <CalendarDays size={16} />
                <span>다음 주 계획</span>
              </div>
              <AutoResizeTextarea
                value={localData.nextWeekTasks}
                onChange={(e) => handleChange("nextWeekTasks", e.target.value)}
                placeholder={"1. 예정 업무\n  - 준비할 자료\n  - 협의 필요 사항"}
                minRows={16}
                className="sheet-textarea"
              />
            </section>
            <section className="sheet-column notes">
              <div className="sheet-head">
                <AlertCircle size={16} />
                <span>확인 사항</span>
              </div>
              <AutoResizeTextarea
                value={localData.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                placeholder={"미수금, 회의 일정, 승인 대기, 공유할 내용"}
                minRows={16}
                className="sheet-textarea"
              />
            </section>
          </div>
        </>
      )}
    </article>
  );
}

function JournalView({ loading, searchQuery, setSearchQuery, authorFilter, setAuthorFilter, authors, filteredEntries, newEntry, onNewEntry, onCancelNew, onSave, onDelete, onRefresh, onNotice }) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [hasManualFold, setHasManualFold] = useState(false);
  const defaultExpandedId = useMemo(
    () => filteredEntries.find((entry) => isThisWeek(entry.thisWeekDate))?.id || filteredEntries[0]?.id || null,
    [filteredEntries],
  );

  function toggleEntry(entryId) {
    setHasManualFold(true);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId) || (!hasManualFold && entryId === defaultExpandedId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  return (
    <div className="journal-layout">
      <ErpHero
        title="주간업무"
        meta={`주간 업무일지 · 작성자 ${authors.length > 1 ? authors.length - 1 : 0}명 · 총 ${filteredEntries.length}건`}
        tags={["이번 주", "자동저장", "Supabase 연결"]}
        actions={(
          <>
            <button onClick={() => onRefresh(false)}><RefreshCw size={14} /> 새로고침</button>
            <button onClick={onNewEntry} disabled={newEntry !== null}><Plus size={14} /> 새 업무일지</button>
          </>
        )}
      />
      <div className="toolbar panel">
        <div className="search-box">
          <Search size={17} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="업무 내용, 작성자, 메모 검색"
          />
          {searchQuery && <button onClick={() => setSearchQuery("")} aria-label="검색어 지우기"><X size={15} /></button>}
        </div>
        <div className="select-filter">
          <Filter size={15} />
          <select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}>
            {authors.map((author) => <option key={author} value={author}>{author}</option>)}
          </select>
        </div>
        <button className="btn btn-ghost" onClick={() => onRefresh(false)}>
          <RefreshCw size={15} /> 새로고침
        </button>
        <button className="btn btn-primary" disabled={newEntry !== null} onClick={onNewEntry}>
          <Plus size={16} /> 새 업무일지
        </button>
      </div>

      <div className="result-line">
        {loading ? "데이터를 불러오는 중입니다." : `${filteredEntries.length}개의 업무일지`}
        {newEntry && <span> · 새 업무일지 작성 중</span>}
      </div>

      {loading && (
        <div className="empty-state panel">
          <Loader2 size={18} className="spin" />
          <p>업무일지를 불러오는 중입니다.</p>
        </div>
      )}

      <div className="work-list">
        {newEntry && (
          <EntryEditor
            entry={newEntry}
            isNew
            isExpanded
            onToggle={() => {}}
            onSave={onSave}
            onDelete={onDelete}
            onCancel={onCancelNew}
            onNotice={onNotice}
          />
        )}
        {filteredEntries.map((entry) => (
          <EntryEditor
            key={entry.id}
            entry={entry}
            isCurrent={isThisWeek(entry.thisWeekDate)}
            isExpanded={expandedIds.has(entry.id) || (!hasManualFold && entry.id === defaultExpandedId)}
            onToggle={() => toggleEntry(entry.id)}
            onSave={onSave}
            onDelete={onDelete}
            onNotice={onNotice}
          />
        ))}
      </div>

      {!loading && filteredEntries.length === 0 && !newEntry && (
        <div className="empty-state panel">
          <Archive size={22} />
          <h3>표시할 업무일지가 없습니다.</h3>
          <p>검색어 또는 작성자 필터를 조정해보세요.</p>
        </div>
      )}
    </div>
  );
}

function Sidebar({ view, setView, stats, centerStats, currentUser, onLogout, isOwner, inboxCount, voiceCount }) {
  return (
    <aside className="app-sidebar">
      <button className="brand-lockup" onClick={() => setView("dashboard")} title="대시보드로 이동">
        <img src="/logo.png" alt="Marine & Geo" />
        <div>
          <strong>MARINE &amp; GEO · ERP</strong>
          <span>Internal Management System / v001</span>
        </div>
      </button>

      <div className="side-user">
        <div className="side-user-info">
          <span
            className="side-user-avatar"
            style={{ backgroundColor: avatarFor(currentUser).bg, color: avatarFor(currentUser).text }}
          >
            <span className="ava-ch">{(currentUser || "?").slice(0, 1)}</span>
          </span>
          <div className="side-user-text">
            <strong>{currentUser}</strong>
            <span>로그인됨</span>
          </div>
        </div>
        <button className="icon-btn" title="로그아웃" onClick={onLogout}><LogOut size={15} /></button>
      </div>

      <nav className="side-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const count = item.id === "journal" ? stats.totalEntries
            : item.id === "center" ? centerStats.needCheck
            : 0;
          return (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
              <Icon size={17} />
              <span>{item.label}</span>
              {count > 0 && <span className="side-nav-count">{count}</span>}
            </button>
          );
        })}
        {isOwner && (
          <button className={view === "inbox" ? "active" : ""} onClick={() => setView("inbox")}>
            <Inbox size={17} />
            <span>받은편지함</span>
            {inboxCount > 0 && <span className="side-nav-count">{inboxCount}</span>}
          </button>
        )}
        {isOwner && (
          <button className={view === "voice" ? "active" : ""} onClick={() => setView("voice")}>
            <Mic size={17} />
            <span>업무 통화 로그</span>
            {voiceCount > 0 && <span className="side-nav-count">{voiceCount}</span>}
          </button>
        )}
        <button className={view === "meeting" ? "active" : ""} onClick={() => setView("meeting")}>
          <Users size={17} />
          <span>회의록</span>
        </button>
      </nav>

      <section className="panel compact side-summary">
        <p className="eyebrow">이번주 주간업무보고</p>
        <div className="side-metric">
          <strong>{stats.thisWeekSubmitted.length}</strong>
          <span>/ {Math.max(stats.authorCount, 1)}명 제출</span>
        </div>
        <div className="progress-track">
          <span style={{ width: `${stats.submittedRate}%` }} />
        </div>
        <p>{stats.submittedRate}% 완료</p>

        <div className="side-divider" />
        <p className="eyebrow">해양벤처진흥센터 · 마감 기준</p>
        <div className="side-metric">
          <strong>{centerStats.doneWithDue}</strong>
          <span>/ {centerStats.withDue}건 처리</span>
        </div>
        <div className="progress-track">
          <span style={{ width: `${centerStats.dueRate}%` }} />
        </div>
        <p>{centerStats.dueSoon > 0 ? `마감 임박 ${centerStats.dueSoon}건` : "마감 임박 없음"}</p>
      </section>

      <MiniCalendar />
    </aside>
  );
}

function Topbar({ view, stats }) {
  const current = NAV_ITEMS.find((item) => item.id === view);
  const title = current?.label || "주간업무";
  return (
    <header className="app-topbar">
      <div>
        <p className="eyebrow">Marine & Geo · {todayLabel()}</p>
        <h1>{title}</h1>
      </div>
      <div className="topbar-stats">
        <span><Users size={15} /> 작성자 {stats.authorCount}명</span>
        <span><FileText size={15} /> 일지 {stats.totalEntries}건</span>
        <span><Check size={15} /> 이번 주 {stats.thisWeekSubmitted.length}건</span>
      </div>
    </header>
  );
}

const DASH_ACTION_STATUSES = ["신규", "확인필요", "자료준비", "승인대기"];
const DASH_CENTER_STATUS_ORDER = ["신규", "확인필요", "자료준비", "승인대기", "제출완료", "보관"];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function ymdToDate(s) {
  return s ? new Date(s + "T00:00:00") : null;
}
function ddayFrom(s, today) {
  const d = ymdToDate(s);
  return d ? Math.round((d - today) / 86400000) : null;
}
function ddayLabel(d) {
  if (d == null) return "";
  if (d < 0) return `${-d}일 지남`;
  if (d === 0) return "오늘";
  return `D-${d}`;
}
function fmtMD(s) {
  if (!s) return "";
  const p = s.split("-");
  return `${Number(p[1])}/${Number(p[2])}`;
}
function activeLeave(r) {
  return r.status !== "rejected" && r.status !== "cancelled";
}
function leaveOverlaps(r, a, b) {
  const s = ymdToDate(r.start_date);
  const e = ymdToDate(r.end_date || r.start_date);
  return s && e && s <= b && e >= a;
}

function Dashboard({ entries, journalStats, centerTasks, leaveRequests, setView, onTrigger, triggering, inboxDrafts = [], isOwner = false }) {
  const today = useMemo(() => startOfToday(), []);
  const weekStart = useMemo(() => {
    const d = new Date(today);
    const wd = d.getDay();
    d.setDate(d.getDate() + (wd === 0 ? -6 : 1 - wd));
    return d;
  }, [today]);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const monthEnd = useMemo(() => new Date(today.getFullYear(), today.getMonth() + 1, 0), [today]);
  const in14 = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 14);
    return d;
  }, [today]);

  const centerD = useMemo(
    () => centerTasks.map((t) => ({ ...t, _d: ddayFrom(t.due_date, today) })),
    [centerTasks, today],
  );

  const kpi = useMemo(() => {
    const urgent = centerD.filter((t) => DASH_ACTION_STATUSES.includes(t.status) && t._d != null && t._d <= 7).length;
    const overdue = centerD.filter((t) => t.status !== "제출완료" && t.status !== "보관" && t._d != null && t._d < 0).length;
    const expected = Math.max(journalStats.authorCount, 3);
    const submitted = journalStats.thisWeekSubmitted.length;
    const absentWeek = new Set(
      leaveRequests.filter((r) => activeLeave(r) && leaveOverlaps(r, weekStart, weekEnd)).map((r) => r.author),
    ).size;
    const upcoming = leaveRequests.filter((r) => {
      if (!activeLeave(r)) return false;
      const s = ymdToDate(r.start_date);
      return s && s > today && s <= in14;
    }).length;
    return { urgent, overdue, submitted, expected, absentWeek, upcoming };
  }, [centerD, journalStats, leaveRequests, weekStart, weekEnd, today, in14]);

  const actions = useMemo(
    () =>
      centerD
        .filter((t) => DASH_ACTION_STATUSES.includes(t.status))
        .sort((a, b) => (a._d == null ? 99999 : a._d) - (b._d == null ? 99999 : b._d))
        .slice(0, 8),
    [centerD],
  );

  const timeline = useMemo(() => {
    const g = [
      { key: "overdue", label: "마감 초과", tone: "red", items: [] },
      { key: "today", label: "오늘", tone: "red", items: [] },
      { key: "d3", label: "3일 내", tone: "amber", items: [] },
      { key: "d7", label: "7일 내", tone: "amber", items: [] },
      { key: "later", label: "이후", tone: "muted", items: [] },
    ];
    centerD
      .filter((t) => t.due_date && t.status !== "제출완료" && t.status !== "보관")
      .sort((a, b) => a._d - b._d)
      .forEach((t) => {
        const d = t._d;
        if (d < 0) g[0].items.push(t);
        else if (d === 0) g[1].items.push(t);
        else if (d <= 3) g[2].items.push(t);
        else if (d <= 7) g[3].items.push(t);
        else g[4].items.push(t);
      });
    return g.filter((row) => row.items.length > 0);
  }, [centerD]);

  const journalSummary = useMemo(() => {
    const names = Object.keys(journalStats.authorStats);
    const list = names.length ? names : ["여은민", "김찬수", "최승표"];
    const projectRe = /^\d+\)/;     // "6) 제주 신창지역 SBP 탐사"
    const categoryRe = /^\d+\.\s/;  // "1. 탄성파 탐사" (대분류 → 문맥 제외)
    return list.map((name) => {
      const sorted = entries
        .filter((e) => e.author === name)
        .slice()
        .sort((a, b) => (b.thisWeekDate || "").localeCompare(a.thisWeekDate || ""));
      const latest = sorted[0];
      const prev = sorted[1];
      const prevLines = new Set(
        (prev?.thisWeekTasks || "").split("\n").map((s) => s.trim()).filter(Boolean),
      );
      // 업데이트(지난주 대비 신규)를 상위 프로젝트(N))로 묶어 표시 — 어느 프로젝트인지 보이게
      const groups = [];
      const ensure = (proj) => {
        let g = groups.find((x) => x.project === proj);
        if (!g) { g = { project: proj, items: [] }; groups.push(g); }
        return g;
      };
      let cur = null;
      for (const raw of (latest?.thisWeekTasks || "").split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        if (categoryRe.test(line)) { cur = null; continue; }
        if (projectRe.test(line)) {
          cur = line;
          if (!prevLines.has(line)) ensure(line); // 신규 프로젝트면 헤더만이라도 표시
          continue;
        }
        if (!prevLines.has(line)) {
          ensure(cur || "기타").items.push(line.replace(/^[-•]\s*/, ""));
        }
      }
      return {
        name,
        submitted: latest ? isThisWeek(latest.thisWeekDate) : false,
        weekLabel: latest?.weekLabel || "",
        groups: groups.slice(0, 6),
        notes: (latest?.notes || "").trim(),
      };
    });
  }, [entries, journalStats.authorStats]);

  const leaveToday = useMemo(
    () => leaveRequests.filter((r) => activeLeave(r) && leaveOverlaps(r, today, today)),
    [leaveRequests, today],
  );
  const leaveUpcoming = useMemo(
    () =>
      leaveRequests
        .filter((r) => {
          if (!activeLeave(r)) return false;
          const s = ymdToDate(r.start_date);
          return s && s > today && s <= in14;
        })
        .slice(0, 6),
    [leaveRequests, today, in14],
  );
  const leaveMonthCount = useMemo(
    () => leaveRequests.filter((r) => activeLeave(r) && leaveOverlaps(r, monthStart, monthEnd)).length,
    [leaveRequests, monthStart, monthEnd],
  );

  const statusCounts = useMemo(
    () => DASH_CENTER_STATUS_ORDER.map((s) => ({ s, n: centerTasks.filter((t) => t.status === s).length })),
    [centerTasks],
  );

  // 오늘의 리마인드 — 센터 마감(3일내)+받은편지함(owner 확인필요 높음/긴급)을 한 줄 리스트로
  const centerNeed = useMemo(() => centerTasks.filter((t) => t.status === "확인필요").length, [centerTasks]);
  const inboxNeed = isOwner ? (inboxDrafts || []).filter((d) => d.status === "needs_review").length : 0;
  const reminders = useMemo(() => {
    const out = [];
    centerD
      .filter((t) => t.due_date && t.status !== "제출완료" && t.status !== "보관" && t._d != null && t._d <= 3)
      .forEach((t) => out.push({ view: "center", sub: "센터", label: t.title, dday: t._d }));
    if (isOwner) {
      (inboxDrafts || [])
        .filter((d) => d.status === "needs_review" && (d.priority === "urgent" || d.priority === "high"))
        .forEach((d) => out.push({ view: "inbox", sub: "받은편지함", label: d.subject_masked, dday: d.due_date ? ddayFrom(d.due_date, today) : null }));
    }
    return out.sort((a, b) => (a.dday == null ? 9999 : a.dday) - (b.dday == null ? 9999 : b.dday)).slice(0, 6);
  }, [centerD, inboxDrafts, isOwner, today]);

  return (
    <div className="dashboard">
      {/* ── Project Desk 히어로 ── */}
      <ErpHero
        title="대시보드"
        meta={`통합 운영 현황 · 기준일 ${todayLabel()} · 마감 초과 ${kpi.overdue} · 센터 긴급 ${kpi.urgent} · 주간업무 ${kpi.submitted}/${kpi.expected} · 이번 주 부재 ${kpi.absentWeek}`}
        tags={[
          "운영 중",
          "이번 주",
          "Supabase 연결",
          ...(kpi.overdue > 0 ? [{ label: `마감 초과 ${kpi.overdue}`, hot: true }] : []),
        ]}
        actions={(
          <>
            <button className="erp-act-primary" onClick={onTrigger} disabled={triggering}
                    title="캘린더 동기화 + 전체 데이터 새로고침">
              <RefreshCw size={14} className={triggering ? "erp-spin" : ""} /> {triggering ? "동기화 중…" : "동기화"}
            </button>
            <button onClick={() => setView("journal")}><FileText size={14} /> 주간업무</button>
            <button onClick={() => setView("center")}><BriefcaseBusiness size={14} /> 해양벤처센터</button>
            <button onClick={() => setView("leave")}><Plane size={14} /> 휴가·출장</button>
          </>
        )}
      />

      {/* ── 오늘의 리마인드 ── */}
      <section className="panel dash-briefing">
        <div className="panel-title-row">
          <h3><span className="panel-ic ic-red"><AlertCircle size={15} /></span> 오늘의 리마인드 · {todayLabel()}</h3>
          <button className="btn btn-ghost" onClick={onTrigger} disabled={triggering}>
            <RefreshCw size={13} className={triggering ? "erp-spin" : ""} /> 새로고침
          </button>
        </div>
        <div className="brief-chips">
          <button className="brief-chip" onClick={() => setView("center")}>센터 확인필요 <b>{centerNeed}</b></button>
          <button className="brief-chip" onClick={() => setView("center")}>마감 초과 <b>{kpi.overdue}</b></button>
          {isOwner && <button className="brief-chip" onClick={() => setView("inbox")}>받은편지함 <b>{inboxNeed}</b></button>}
          <button className="brief-chip" onClick={() => setView("journal")}>주간 미제출 <b>{Math.max(kpi.expected - kpi.submitted, 0)}</b></button>
          <button className="brief-chip" onClick={() => setView("leave")}>오늘 부재 <b>{leaveToday.length}</b></button>
        </div>
        {reminders.length === 0 ? (
          <div className="dash-empty">지금 급히 챙길 항목이 없습니다. 👍</div>
        ) : (
          <ul className="brief-list">
            {reminders.map((r, i) => (
              <li key={i} onClick={() => setView(r.view)}>
                <span className={"brief-dot " + (r.dday != null && r.dday < 0 ? "d-red" : r.dday != null && r.dday <= 3 ? "d-amber" : "d-blue")} />
                <span className="brief-sub">{r.sub}</span>
                <span className="brief-label">{r.label}</span>
                <span className="brief-dday">{r.dday == null ? "" : r.dday < 0 ? `${-r.dday}일 초과` : r.dday === 0 ? "오늘" : `D-${r.dday}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── KPI 스트립 ── */}
      <div className="dash-kpis">
        <button className="kpi-card tone-red" onClick={() => setView("center")}>
          <span className="kpi-accent" />
          <span className="kpi-icon"><AlertCircle size={18} /></span>
          <span className="kpi-body"><strong className="kpi-value">{kpi.urgent}</strong><span className="kpi-label">센터 긴급 대응</span></span>
        </button>
        <button className="kpi-card tone-redstrong" onClick={() => setView("center")}>
          <span className="kpi-accent" />
          <span className="kpi-icon"><Clock3 size={18} /></span>
          <span className="kpi-body"><strong className="kpi-value">{kpi.overdue}</strong><span className="kpi-label">마감 초과</span></span>
        </button>
        <button className="kpi-card tone-blue" onClick={() => setView("journal")}>
          <span className="kpi-accent" />
          <span className="kpi-icon"><FileText size={18} /></span>
          <span className="kpi-body"><strong className="kpi-value">{kpi.submitted}/{kpi.expected}</strong><span className="kpi-label">이번 주 주간업무</span></span>
        </button>
        <button className="kpi-card tone-amber" onClick={() => setView("leave")}>
          <span className="kpi-accent" />
          <span className="kpi-icon"><Plane size={18} /></span>
          <span className="kpi-body"><strong className="kpi-value">{kpi.absentWeek}</strong><span className="kpi-label">이번 주 부재 인원</span></span>
        </button>
        <button className="kpi-card tone-mint" onClick={() => setView("leave")}>
          <span className="kpi-accent" />
          <span className="kpi-icon"><CalendarDays size={18} /></span>
          <span className="kpi-body"><strong className="kpi-value">{kpi.upcoming}</strong><span className="kpi-label">다가오는 휴가·출장</span></span>
        </button>
      </div>

      {/* ── 1행: 액션리스트(8) + 마감 타임라인(4) ── */}
      <div className="dash-row">
        <section className="panel span7">
          <div className="panel-title-row">
            <h3><span className="panel-ic ic-red"><AlertCircle size={15} /></span> 확인 필요 · 처리 대기</h3>
            <button className="btn btn-ghost" onClick={() => setView("center")}>센터 열기</button>
          </div>
          {actions.length === 0 ? (
            <div className="dash-empty">처리 대기 중인 센터 업무가 없습니다. 👍</div>
          ) : (
            <ul className="action-list">
              {actions.map((t) => (
                <li
                  key={t.id}
                  className={t._d != null && t._d < 0 ? "is-danger" : t._d != null && t._d <= 7 ? "is-warning" : ""}
                  onClick={() => setView("center")}
                >
                  <span className={`badge ${t._d == null ? "muted" : t._d < 0 ? "red" : t._d <= 7 ? "amber" : "muted"}`}>
                    {t._d == null ? "마감없음" : ddayLabel(t._d)}
                  </span>
                  <span className="action-title">{t.title}</span>
                  <span className="action-meta">{t.category} · {t.status}{t.priority === "높음" ? " · 높음" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel span5">
          <div className="panel-title-row"><h3><span className="panel-ic ic-amber"><Clock3 size={15} /></span> 마감 타임라인</h3></div>
          {timeline.length === 0 ? (
            <div className="dash-empty">예정된 마감이 없습니다.</div>
          ) : (
            <div className="timeline">
              {timeline.map((row) => (
                <div className="timeline-row" key={row.key}>
                  <span className={`badge ${row.tone}`}>{row.label} {row.items.length}</span>
                  <span className="tl-line">
                    {row.items.map((t, i) => (
                      <span className="tl-item" key={t.id}>
                        <em>{fmtMD(t.due_date)}</em> {t.title}{i < row.items.length - 1 ? "  ·  " : ""}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── 2행: 주간업무 직원별 업데이트 + 확인사항 (전체폭) ── */}
      <div className="dash-row">
        <section className="panel span12">
          <div className="panel-title-row">
            <h3><span className="panel-ic ic-blue"><FileText size={15} /></span> 주간업무 · 직원별 업데이트</h3>
            <button className="btn btn-ghost" onClick={() => setView("journal")}>주간업무 열기</button>
          </div>
          <div className="journal-cards">
            {journalSummary.map((p) => (
              <div className="jcard" key={p.name}>
                <div className="jcard-head">
                  <span className={`dot ${p.submitted ? "on" : "off"}`} />
                  <strong>{p.name}</strong>
                  {p.submitted
                    ? <span className="badge green">이번주 제출</span>
                    : <span className="badge muted">{p.weekLabel || "미제출"}</span>}
                </div>
                <p className="sub-label">업데이트 업무 <em>(지난주 대비)</em></p>
                {p.groups.length ? (
                  <div className="jgroups">
                    {p.groups.map((g) => (
                      <div className="jgroup" key={g.project}>
                        <p className="jgroup-title">{g.project}</p>
                        {g.items.length > 0 && (
                          <ul className="jcard-lines">
                            {g.items.map((l, i) => <li key={i}>{l}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="dash-empty compact">신규 업데이트 없음</div>
                )}
                <p className="sub-label">확인 사항</p>
                {p.notes ? (
                  <p className="jcard-notes">{p.notes}</p>
                ) : (
                  <div className="dash-empty compact">확인 사항 없음</div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── 3행: 부재·출장(6) + 운영 스냅샷(6) ── */}
      <div className="dash-row">
        <section className="panel span6">
          <div className="panel-title-row">
            <h3><span className="panel-ic ic-mint"><Plane size={15} /></span> 부재 · 출장</h3>
            <button className="btn btn-ghost" onClick={() => setView("leave")}>일정 열기</button>
          </div>
          <p className="sub-label">오늘 부재</p>
          {leaveToday.length === 0 ? (
            <div className="dash-empty compact">오늘 부재 인원이 없습니다.</div>
          ) : (
            <ul className="leave-list">
              {leaveToday.map((r) => (
                <li key={r.id}>
                  <strong>{r.author}</strong>
                  <span>{r.leave_type_name}{r.destination ? ` · ${r.destination}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="sub-label">다가오는 14일 ({leaveUpcoming.length})</p>
          {leaveUpcoming.length === 0 ? (
            <div className="dash-empty compact">예정된 휴가·출장이 없습니다.</div>
          ) : (
            <ul className="leave-list">
              {leaveUpcoming.map((r) => (
                <li key={r.id}>
                  <em>{fmtMD(r.start_date)}{r.end_date && r.end_date !== r.start_date ? `~${fmtMD(r.end_date)}` : ""}</em>
                  <strong>{r.author}</strong>
                  <span>{r.leave_type_name}{r.destination ? ` · ${r.destination}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel span6">
          <div className="panel-title-row"><h3><span className="panel-ic ic-navy"><CircleDot size={15} /></span> 운영 스냅샷</h3></div>
          <div className="snapshot snapshot-stack">
            <div className="snap-block">
              <p className="sub-label">해양벤처진흥센터 상태</p>
              <div className="snap-badges">
                {statusCounts.map((c) => (
                  <span key={c.s} className="badge muted">{c.s} {c.n}</span>
                ))}
              </div>
            </div>
            <div className="snap-block">
              <p className="sub-label">휴가·출장</p>
              <div className="snap-badges">
                <span className="badge muted">이번 달 {leaveMonthCount}건</span>
                <span className="badge muted">전체 {leaveRequests.length}건</span>
              </div>
            </div>
            <div className="snap-block">
              <p className="sub-label">주간업무</p>
              <div className="snap-badges">
                <span className="badge muted">총 {entries.length}건</span>
                <span className="badge muted">작성자 {journalStats.authorCount}명</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── 로그인 (MG Auditor식 ID/PIN UX를 Supabase Auth 위에 얹음) ──
// 아이디 → 실제 Supabase Auth 이메일 매핑. 이메일을 직접 입력해도 로그인 허용.
const ERP_ACCOUNTS = {
  yeoeunmin:    { email: "geomin99@gmail.com",    name: "여은민",     role: "owner" },
  kimchansu:    { email: "chanse7979@gmail.com",  name: "김찬수",     role: "employee" },
  choiseungpyo: { email: "pyoring94@gmail.com",   name: "최승표",     role: "employee" },
  marinegeo:    { email: "marinegeo99@gmail.com", name: "마린엔지오", role: "shared" },
};
// 로그인 사용자의 개인정보 열람 범위: owner=전체, employee=본인, shared(공용메일)=숨김
function viewerForSession(session) {
  const email = (session?.user?.email || "").toLowerCase();
  const hit = Object.values(ERP_ACCOUNTS).find((a) => a.email === email);
  return { name: hit?.name || null, role: hit?.role || "shared" };  // 미등록 계정도 보수적으로 숨김
}
function usernameToEmail(input) {
  const v = (input || "").trim().toLowerCase();
  if (v.includes("@")) return v;                  // 이메일로 직접 로그인
  return ERP_ACCOUNTS[v]?.email || v;             // 아이디 → 이메일
}
function displayNameForSession(session) {
  const email = (session?.user?.email || "").toLowerCase();
  const hit = Object.values(ERP_ACCOUNTS).find((a) => a.email === email);
  return hit?.name || session?.user?.user_metadata?.display_name || email.split("@")[0] || "사용자";
}

function LoginScreen() {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !pin.trim()) { setErr("아이디와 PIN을 입력해주세요."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password: pin,
    });
    if (error) { setErr("아이디 또는 PIN이 올바르지 않습니다."); setBusy(false); return; }
    // 성공 시 onAuthStateChange 가 화면을 전환
  }

  return (
    <div className="login-shell" style={{ "--brand-navy": BRAND.navy, "--brand-blue": BRAND.blue, "--brand-accent": BRAND.accent }}>
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/logo.png" alt="Marine & Geo" />
          <div>
            <strong>MARINE &amp; GEO · ERP</strong>
            <span>Internal Management System / v001</span>
          </div>
        </div>
        <h2>로그인</h2>
        <label>
          <span>아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" placeholder="아이디" />
        </label>
        <label>
          <span>PIN</span>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" inputMode="numeric" placeholder="PIN" />
        </label>
        {err && <p className="login-error">{err}</p>}
        <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : null} 로그인
        </button>
        <p className="login-foot">마린엔지오 내부 직원 전용</p>
      </form>
    </div>
  );
}

const VALID_VIEWS = [...NAV_ITEMS.map((n) => n.id), "inbox", "voice", "meeting"];
function viewFromHash() {
  const h = (window.location.hash || "").replace(/^#\/?/, "");
  return VALID_VIEWS.includes(h) ? h : "dashboard";
}

function Workspace({ session }) {
  // 탭을 URL 해시(#leave 등)에 반영 → 어느 기기·브라우저든 새로고침 시 유지, 북마크·링크 공유 가능
  const [view, setViewRaw] = useState(viewFromHash);
  const setView = (v) => {
    setViewRaw(v);
    const target = `#${v}`;
    if (window.location.hash !== target) window.location.hash = target;
  };
  // 주소 직접 변경·뒤로가기 시 탭 동기화
  useEffect(() => {
    const onHash = () => setViewRaw(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // 첫 진입 시 해시가 비어 있으면 현재 탭으로 채워둠(공유 링크 일관성)
  useEffect(() => {
    if (!window.location.hash) window.location.replace(`#${view}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [authorFilter, setAuthorFilter] = useState("전체");
  const [newEntry, setNewEntry] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [centerTasks, setCenterTasks] = useState([]);
  const [centerLoading, setCenterLoading] = useState(true);

  const showNotice = useCallback((message, type = "info") => {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const fetchCenter = useCallback(async (isInitial = false) => {
    if (isInitial) setCenterLoading(true);
    const { data, error } = await supabase
      .from("center_tasks")
      .select("*")
      .is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    // 테이블 미적용/조회 실패 시 토스트 없이 빈 목록으로 (운영 전 단계 대비)
    setCenterTasks(error ? [] : data || []);
    if (isInitial) setCenterLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCenter(true);
  }, [fetchCenter]);

  const [leaveRequests, setLeaveRequests] = useState([]);
  const fetchLeave = useCallback(async () => {
    const { data, error } = await supabase
      .from("leave_requests")
      .select("id, author, leave_type_name, start_date, end_date, status, destination, trip_purpose, is_all_day")
      .order("start_date", { ascending: true });
    setLeaveRequests(error ? [] : data || []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLeave();
  }, [fetchLeave]);

  const centerStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let needCheck = 0, done = 0, dueSoon = 0, withDue = 0, doneWithDue = 0;
    for (const t of centerTasks) {
      if (t.status === "확인필요") needCheck += 1;
      const isDone = t.status === "제출완료";
      if (isDone) done += 1;
      if (t.due_date) {
        withDue += 1;
        if (isDone || t.status === "보관") doneWithDue += 1;
        const d = Math.round((new Date(t.due_date + "T00:00:00") - today) / 86400000);
        if (d <= 7 && !isDone && t.status !== "보관") dueSoon += 1;
      }
    }
    const dueRate = withDue > 0 ? Math.round((doneWithDue / withDue) * 100) : 0;
    return { total: centerTasks.length, needCheck, done, dueSoon, withDue, doneWithDue, dueRate };
  }, [centerTasks]);

  const fetchEntries = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    const { data, error } = await supabase
      .from("journal_entries")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      showNotice(`데이터를 불러오지 못했습니다: ${error.message}`, "error");
    } else {
      const formatted = (data || []).map((entry, index) => ({
        id: entry.id,
        displayNumber: index + 1,
        author: entry.author || "",
        weekLabel: entry.week_label || "",
        thisWeekDate: entry.this_week_date,
        nextWeekDate: entry.next_week_date,
        thisWeekTasks: entry.this_week_tasks || "",
        nextWeekTasks: entry.next_week_tasks || "",
        notes: entry.notes || "",
        createdAt: entry.created_at,
      }));
      setEntries([...formatted].reverse());
    }
    if (isInitial) setLoading(false);
  }, [showNotice]);

  useEffect(() => {
    // Initial remote sync with Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEntries(true);
  }, [fetchEntries]);

  // 받은편지함 업무 초안 (A안) — 토뭉이님(geomin99) 전용. RLS로 owner 행만 조회됨.
  const isOwner = (session?.user?.email || "").toLowerCase() === "geomin99@gmail.com";
  const [inboxDrafts, setInboxDrafts] = useState([]);
  const fetchInbox = useCallback(async () => {
    if (!isOwner) { setInboxDrafts([]); return; }
    const { data, error } = await supabase
      .from("inbox_action_drafts")
      .select("*")
      .is("deleted_at", null)
      .order("received_at", { ascending: false });
    setInboxDrafts(error ? [] : data || []);
  }, [isOwner]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchInbox();
  }, [fetchInbox]);

  // 업무 통화 로그 (geomin99 전용)
  const [voiceLogs, setVoiceLogs] = useState([]);
  const fetchVoice = useCallback(async () => {
    if (!isOwner) { setVoiceLogs([]); return; }
    const { data, error } = await supabase
      .from("voice_call_logs")
      .select("*")
      .is("deleted_at", null)
      .order("call_date", { ascending: false });
    setVoiceLogs(error ? [] : data || []);
  }, [isOwner]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchVoice();
  }, [fetchVoice]);

  // 대시보드 트리거: 누를 때마다 캘린더 동기화 + 전체 데이터 새로고침 (on-demand)
  const [triggering, setTriggering] = useState(false);
  const runTrigger = useCallback(async () => {
    setTriggering(true);
    try {
      let cal = null;
      if (gcalReady()) {
        // 동기화엔 전체 컬럼 필요(서명·event id) → 별도 풀로드
        const { data } = await supabase
          .from("leave_requests")
          .select("*")
          .order("start_date", { ascending: true });
        if (data) cal = await syncLeaveRequests(data);
      }
      await Promise.all([fetchEntries(), fetchCenter(), fetchLeave(), fetchInbox()]);
      let msg;
      if (cal && cal.ok) {
        msg = `동기화 완료 · 캘린더 신규 ${cal.pushed}·갱신 ${cal.updated}` +
              `${cal.removed ? `·삭제 ${cal.removed}` : ""}${cal.errors ? `·실패 ${cal.errors}` : ""} · 데이터 최신화`;
      } else if (gcalReady()) {
        msg = "동기화 완료 · 데이터 최신화";
      } else {
        msg = "데이터 최신화 완료 (구글 미연동 — 휴가·출장 탭에서 연동하면 캘린더도 함께 동기화)";
      }
      showNotice(msg, "success");
    } catch (e) {
      showNotice(`동기화 중 오류: ${e.message}`, "error");
    } finally {
      setTriggering(false);
    }
  }, [fetchEntries, fetchCenter, fetchLeave, fetchInbox, showNotice]);

  async function handleSave(id, data, isNew) {
    if (isNew) {
      const { data: inserted, error } = await supabase.from("journal_entries").insert([{
        author: data.author.trim(),
        week_label: data.weekLabel,
        this_week_date: data.thisWeekDate,
        next_week_date: data.nextWeekDate,
        this_week_tasks: data.thisWeekTasks,
        next_week_tasks: data.nextWeekTasks,
        notes: data.notes,
      }]).select();

      if (error) {
        showNotice(`저장 실패: ${error.message}`, "error");
        return { success: false };
      }

      setNewEntry(null);
      const row = inserted?.[0];
      if (row) {
        setEntries((prev) => [{
          id: row.id,
          displayNumber: prev.length + 1,
          author: data.author.trim(),
          weekLabel: data.weekLabel,
          thisWeekDate: data.thisWeekDate,
          nextWeekDate: data.nextWeekDate,
          thisWeekTasks: data.thisWeekTasks,
          nextWeekTasks: data.nextWeekTasks,
          notes: data.notes,
          createdAt: row.created_at,
        }, ...prev]);
      }
      return { success: true };
    }

    const { error } = await supabase.from("journal_entries").update({
      author: data.author.trim(),
      week_label: data.weekLabel,
      this_week_date: data.thisWeekDate,
      next_week_date: data.nextWeekDate,
      this_week_tasks: data.thisWeekTasks,
      next_week_tasks: data.nextWeekTasks,
      notes: data.notes,
    }).eq("id", id);

    if (error) {
      showNotice(`저장 실패: ${error.message}`, "error");
      return { success: false };
    }

    setEntries((prev) => prev.map((entry) => (
      entry.id === id
        ? {
          ...entry,
          author: data.author.trim(),
          weekLabel: data.weekLabel,
          thisWeekDate: data.thisWeekDate,
          nextWeekDate: data.nextWeekDate,
          thisWeekTasks: data.thisWeekTasks,
          nextWeekTasks: data.nextWeekTasks,
          notes: data.notes,
        }
        : entry
    )));
    return { success: true };
  }

  function requestDelete(id) {
    setConfirm({
      id,
      title: "업무일지를 삭제할까요?",
      message: "삭제하면 복구하기 어렵습니다. 필요한 내용은 먼저 확인해주세요.",
    });
  }

  async function confirmDelete() {
    const id = confirm?.id;
    if (!id) return;
    setConfirm(null);
    const { error } = await supabase.from("journal_entries").delete().eq("id", id);
    if (error) {
      showNotice(`삭제 실패: ${error.message}`, "error");
      return;
    }
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    showNotice("삭제되었습니다.", "success");
  }

  function handleNewEntry() {
    const monday = getMondayDateStr();
    setNewEntry({
      id: "NEW",
      author: "",
      weekLabel: "새 업무일지",
      thisWeekDate: monday,
      nextWeekDate: getNextMonday(monday),
      thisWeekTasks: "",
      nextWeekTasks: "",
      notes: "",
    });
  }

  const stats = useMemo(() => {
    const authorStats = {};
    entries.forEach((entry) => {
      if (!entry.author) return;
      authorStats[entry.author] = (authorStats[entry.author] || 0) + 1;
    });
    const thisWeekSubmitted = entries.filter((entry) => isThisWeek(entry.thisWeekDate)).map((entry) => entry.author).filter(Boolean);
    const authorCount = Object.keys(authorStats).length;
    const submittedRate = authorCount > 0 ? Math.round((new Set(thisWeekSubmitted).size / authorCount) * 100) : 0;
    return {
      authorStats,
      authorCount,
      submittedRate,
      thisWeekSubmitted: [...new Set(thisWeekSubmitted)],
      totalEntries: entries.length,
    };
  }, [entries]);

  const authors = useMemo(() => ["전체", ...Object.keys(stats.authorStats)], [stats.authorStats]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesAuthor = authorFilter === "전체" || entry.author === authorFilter;
      const haystack = `${entry.author} ${entry.weekLabel} ${entry.thisWeekTasks} ${entry.nextWeekTasks} ${entry.notes}`.toLowerCase();
      return matchesAuthor && (!q || haystack.includes(q));
    });
  }, [authorFilter, entries, searchQuery]);

  const currentUser = displayNameForSession(session);
  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="app-shell" style={{ "--brand-navy": BRAND.navy, "--brand-blue": BRAND.blue, "--brand-accent": BRAND.accent }}>
      <Sidebar view={view} setView={setView} stats={stats} centerStats={centerStats} currentUser={currentUser} onLogout={handleLogout}
               isOwner={isOwner} inboxCount={inboxDrafts.filter((d) => d.status === "needs_review").length}
               voiceCount={voiceLogs.filter((v) => v.follow_up_required).length} />
      <div className="app-main">
        <Topbar view={view} stats={stats} />
        <main className="content-area">
          {view === "dashboard" && (
            <Dashboard
              entries={entries}
              journalStats={stats}
              centerTasks={centerTasks}
              leaveRequests={leaveRequests}
              setView={setView}
              onTrigger={runTrigger}
              triggering={triggering}
              inboxDrafts={inboxDrafts}
              isOwner={isOwner}
            />
          )}
          {view === "journal" && (
            <JournalView
              loading={loading}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              authorFilter={authorFilter}
              setAuthorFilter={setAuthorFilter}
              authors={authors}
              filteredEntries={filteredEntries}
              newEntry={newEntry}
              onNewEntry={handleNewEntry}
              onCancelNew={() => setNewEntry(null)}
              onSave={handleSave}
              onDelete={requestDelete}
              onRefresh={fetchEntries}
              onNotice={showNotice}
            />
          )}
          {view === "leave" && (
            <section className="module-frame">
              <LeaveView viewer={viewerForSession(session)} />
            </section>
          )}
          {view === "center" && (
            <section className="module-frame">
              <CenterView
                tasks={centerTasks}
                loading={centerLoading}
                onReload={fetchCenter}
                onNotice={showNotice}
              />
            </section>
          )}
          {view === "inbox" && isOwner && (
            <InboxView drafts={inboxDrafts} onReload={fetchInbox} onNotice={showNotice} ownerId={session?.user?.id} />
          )}
          {view === "voice" && isOwner && (
            <VoiceLogView logs={voiceLogs} loading={false} onReload={fetchVoice} onNotice={showNotice} ownerId={session?.user?.id} />
          )}
          {view === "meeting" && (
            <MeetingView session={session} viewer={viewerForSession(session)} onNotice={showNotice} />
          )}
        </main>
      </div>
      <Toast notice={notice} onClose={() => setNotice(null)} />
      <ConfirmDialog confirm={confirm} onCancel={() => setConfirm(null)} onConfirm={confirmDelete} />
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setAuthReady(true); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  if (!authReady) {
    return (
      <div className="login-shell" style={{ "--brand-navy": BRAND.navy, "--brand-blue": BRAND.blue, "--brand-accent": BRAND.accent }}>
        <div className="login-loading"><Loader2 size={20} className="spin" /> 불러오는 중…</div>
      </div>
    );
  }
  if (!session) return <LoginScreen />;
  return <Workspace session={session} />;
}
