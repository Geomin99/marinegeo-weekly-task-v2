import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Search, Plus, Calendar, Users, ChevronDown, ChevronRight, X, Filter, RefreshCw, Loader2, Trash2, AlertCircle, ChevronLeft, Save, Check } from "lucide-react";
import { supabase } from "./supabaseClient";

// ===== 작성자 아바타 색상 =====
const AVATAR_COLORS = [
  { bg: "#dbeafe", text: "#1e40af" },
  { bg: "#ddd6fe", text: "#6d28d9" },
  { bg: "#fce7f3", text: "#be185d" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#d1fae5", text: "#065f46" },
  { bg: "#cffafe", text: "#155e75" },
  { bg: "#fee2e2", text: "#991b1b" },
  { bg: "#e0e7ff", text: "#3730a3" },
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getTodayKorean() {
  const d = new Date();
  return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일";
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
  const d = getMondayOfThisWeek();
  return d.toISOString().split("T")[0];
}

function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const monday = getMondayOfThisWeek();
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const target = new Date(dateStr);
  return target >= monday && target <= sunday;
}

function getWeekInfo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
  const week = Math.ceil((d.getDate() + firstDay.getDay()) / 7);
  return month + "월 " + week + "주차";
}

function getNextMonday(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 7);
  return d.toISOString().split("T")[0];
}

// ===== 달력 =====
function MiniCalendar() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startDay = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();

  const cells = [];
  for (let i = startDay - 1; i >= 0; i--) cells.push({ day: prevMonthLastDay - i, type: "prev" });
  for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, type: "current" });
  while (cells.length < 42) cells.push({ day: cells.length - daysInMonth - startDay + 1, type: "next" });

  const isToday = (cell) => cell.type === "current" && viewYear === today.getFullYear() && viewMonth === today.getMonth() && cell.day === today.getDate();

  const goPrev = () => { if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); } else setViewMonth(viewMonth - 1); };
  const goNext = () => { if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); } else setViewMonth(viewMonth + 1); };

  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div className="bg-white rounded-lg border border-sky-100 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-sky-900">{viewYear}년 {viewMonth + 1}월</div>
        <div className="flex gap-1">
          <button onClick={goPrev} className="w-5 h-5 bg-slate-100 hover:bg-slate-200 rounded flex items-center justify-center">
            <ChevronLeft size={10} className="text-slate-600" />
          </button>
          <button onClick={goNext} className="w-5 h-5 bg-slate-100 hover:bg-slate-200 rounded flex items-center justify-center">
            <ChevronRight size={10} className="text-slate-600" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px text-[9px]">
        {weekdays.map((w, i) => (
          <div key={w} className={"text-center font-semibold py-1 " + (i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-slate-600")}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px text-[10px]">
        {cells.map((cell, idx) => {
          const colIdx = idx % 7;
          const isCurr = cell.type === "current";
          const todayCell = isToday(cell);
          let textColor = "text-slate-700";
          if (!isCurr) textColor = "text-slate-300";
          else if (colIdx === 0) textColor = "text-red-500";
          else if (colIdx === 6) textColor = "text-blue-500";

          if (todayCell) {
            return (
              <div key={idx} className="flex items-center justify-center py-0.5">
                <div className="w-[18px] h-[18px] bg-sky-500 text-white rounded-full flex items-center justify-center font-bold ring-2 ring-amber-400 ring-offset-1 ring-offset-white">
                  {cell.day}
                </div>
              </div>
            );
          }
          return <div key={idx} className={"text-center py-1 " + textColor}>{cell.day}</div>;
        })}
      </div>
    </div>
  );
}

// ===== 일지 카드 (인라인 편집) =====
function EntryCard({ entry, isExpanded, isCurrent, isNew, onToggle, onUpdate, onSave, onDelete, onCancel }) {
  const [localData, setLocalData] = useState({
    author: entry.author || "",
    thisWeekDate: entry.thisWeekDate || getMondayDateStr(),
    nextWeekDate: entry.nextWeekDate || getNextMonday(getMondayDateStr()),
    thisWeekTasks: entry.thisWeekTasks || "",
    nextWeekTasks: entry.nextWeekTasks || "",
    notes: entry.notes || "",
  });
  const [editStatus, setEditStatus] = useState("idle"); // idle, editing, saving, saved
  const [hasChanges, setHasChanges] = useState(false);
  const saveTimerRef = useRef(null);
  const statusTimerRef = useRef(null);

  const avatar = getAvatarColor(localData.author || entry.author);

  // entry 가 외부에서 바뀌면 localData 동기화 (단, 편집 중이 아닐 때만)
  useEffect(() => {
    if (editStatus === "idle" || editStatus === "saved") {
      setLocalData({
        author: entry.author || "",
        thisWeekDate: entry.thisWeekDate || getMondayDateStr(),
        nextWeekDate: entry.nextWeekDate || getNextMonday(getMondayDateStr()),
        thisWeekTasks: entry.thisWeekTasks || "",
        nextWeekTasks: entry.nextWeekTasks || "",
        notes: entry.notes || "",
      });
    }
  }, [entry.id, entry.author, entry.thisWeekDate, entry.nextWeekDate, entry.thisWeekTasks, entry.nextWeekTasks, entry.notes]);

  // 자동 저장 (디바운싱 1.5초)
  const scheduleAutoSave = useCallback((newData) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setEditStatus("editing");
    setHasChanges(true);
    saveTimerRef.current = setTimeout(() => {
      doSave(newData);
    }, 1500);
  }, []);

  // 즉시 저장 (수동 저장 버튼 클릭 시)
  const doSave = async (dataToSave) => {
    const data = dataToSave || localData;
    // 작성자가 없으면 저장 안 함
    if (!data.author || !data.author.trim()) {
      setEditStatus("idle");
      return;
    }
    // 이번주 할 일이 없으면 저장 안 함
    if (!data.thisWeekTasks || !data.thisWeekTasks.trim()) {
      setEditStatus("idle");
      return;
    }
    setEditStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const weekLabel = getWeekInfo(data.thisWeekDate) + "(" + data.author + ")";
    const payload = {
      ...data,
      weekLabel,
    };

    const result = await onSave(entry.id, payload, isNew);
    if (result?.success) {
      setEditStatus("saved");
      setHasChanges(false);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => setEditStatus("idle"), 1500);
    } else {
      setEditStatus("editing");
    }
  };

  // 필드 변경 핸들러
  const handleChange = (field, value) => {
    const newData = { ...localData, [field]: value };
    if (field === "thisWeekDate") {
      newData.nextWeekDate = getNextMonday(value);
    }
    setLocalData(newData);
    scheduleAutoSave(newData);
  };

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const weekLabel = localData.author ? getWeekInfo(localData.thisWeekDate) + "(" + localData.author + ")" : (entry.weekLabel || "새 일지");

  // 카드 테두리 색상 (편집 상태에 따라)
  let cardClass = "bg-white rounded-lg border border-slate-200 hover:border-sky-300 overflow-hidden relative group transition";
  if (isNew || editStatus === "editing" || editStatus === "saving") {
    cardClass = "bg-white rounded-lg border-2 border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.15)] overflow-hidden relative";
  } else if (editStatus === "saved") {
    cardClass = "bg-white rounded-lg border-2 border-emerald-500 shadow-[0_0_0_3px_rgba(16,163,74,0.15)] overflow-hidden relative transition";
  } else if (isCurrent) {
    cardClass = "bg-white rounded-lg border-2 border-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.1)] overflow-hidden relative group";
  }

  return (
    <div className={cardClass}>
      {/* 좌측 강조 띠 */}
      <div className={
        "absolute left-0 top-0 bottom-0 w-1 transition-opacity " +
        (isNew || editStatus === "editing" || editStatus === "saving" ? "bg-amber-400 opacity-100"
          : editStatus === "saved" ? "bg-emerald-500 opacity-100"
          : isCurrent ? "bg-sky-500 opacity-100"
          : "bg-sky-500 opacity-0 group-hover:opacity-60")
      }></div>

      {/* 헤더 */}
      <div className="w-full px-5 py-3.5 flex items-center gap-3 text-left">
        <button onClick={onToggle} className="flex items-center gap-3 flex-1 hover:bg-slate-50 -mx-2 px-2 py-1 rounded">
          {isExpanded ? <ChevronDown size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isNew ? (
              <span className="bg-amber-400 text-amber-900 px-2 py-0.5 rounded text-[10px] font-semibold">✏️ 새 일지 작성 중</span>
            ) : editStatus === "editing" ? (
              <span className="bg-amber-400 text-amber-900 px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1">
                <Edit3Icon /> 편집 중
              </span>
            ) : editStatus === "saving" ? (
              <span className="bg-amber-400 text-amber-900 px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" /> 저장 중...
              </span>
            ) : editStatus === "saved" ? (
              <span className="bg-emerald-500 text-white px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1">
                <Check size={10} /> 저장됨
              </span>
            ) : (
              <>
                {isCurrent && (
                  <span className="bg-sky-500 text-white px-1.5 py-0.5 rounded text-[9px] font-medium">이번주</span>
                )}
                {entry.displayNumber && (
                  <span className="text-[11px] font-mono text-slate-400">#{entry.displayNumber}</span>
                )}
              </>
            )}
          </div>
          <div className="flex-1 text-sm font-medium">{weekLabel}</div>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {hasChanges && (
            <button onClick={() => doSave()} className="px-3 py-1 text-xs font-semibold bg-sky-900 text-white rounded hover:bg-sky-800 flex items-center gap-1.5">
              <Save size={11} />
              저장
            </button>
          )}
          {isNew && (
            <button onClick={onCancel} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded border border-slate-200">
              취소
            </button>
          )}
          {!isNew && (
            <>
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: avatar.bg, color: avatar.text }}>
                {(localData.author || entry.author || "?").charAt(0)}
              </div>
              <span className="text-xs text-slate-600">{localData.author || entry.author}</span>
            </>
          )}
        </div>
      </div>

      {/* 펼친 본문 */}
      {isExpanded && (
        <div className="px-5 pb-4 pt-2 border-t border-slate-100">
          {/* 작성자 + 날짜 (인라인 편집) */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-600 mb-1 block">작성자 *</label>
              <input
                type="text"
                value={localData.author}
                onChange={(e) => handleChange("author", e.target.value)}
                placeholder="이름을 입력하세요"
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600 mb-1 block">이번주 시작일 (월)</label>
              <input
                type="date"
                value={localData.thisWeekDate}
                onChange={(e) => handleChange("thisWeekDate", e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-600 mb-1 block">다음주 (자동)</label>
              <input
                type="date"
                value={localData.nextWeekDate}
                disabled
                className="w-full px-3 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-500"
              />
            </div>
          </div>

          {/* 3단 그리드 - 컬러 헤더 카드 */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {/* 이번주 할 일 (파랑톤) */}
            <div className="rounded-md overflow-hidden border border-sky-200">
              <div className="bg-sky-900 text-white px-3.5 py-2 text-sm font-semibold">
                이번주 할 일 · {localData.thisWeekDate}
              </div>
              <div className="bg-sky-50 p-1">
                <textarea
                  value={localData.thisWeekTasks}
                  onChange={(e) => handleChange("thisWeekTasks", e.target.value)}
                  placeholder="예) 1. 탄성파 탐사&#10;  1) 명랑 해상풍력단지&#10;    - 최종 보고서 제출"
                  rows={10}
                  className="w-full px-3 py-2 text-sm text-slate-800 bg-white rounded font-sans leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-sky-300 border-0"
                />
              </div>
            </div>

            {/* 다음주 할 일 (회색톤) */}
            <div className="rounded-md overflow-hidden border border-slate-200">
              <div className="bg-slate-600 text-white px-3.5 py-2 text-sm font-semibold">
                다음주 할 일 · {localData.nextWeekDate}
              </div>
              <div className="bg-slate-50 p-1">
                <textarea
                  value={localData.nextWeekTasks}
                  onChange={(e) => handleChange("nextWeekTasks", e.target.value)}
                  placeholder="다음주 계획을 입력하세요..."
                  rows={10}
                  className="w-full px-3 py-2 text-sm text-slate-800 bg-white rounded font-sans leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-slate-300 border-0"
                />
              </div>
            </div>

            {/* 확인 사항 (노랑톤) */}
            <div className="rounded-md overflow-hidden border border-amber-200">
              <div className="bg-amber-500 text-white px-3.5 py-2 text-sm font-semibold flex items-center gap-1.5">
                <AlertCircle size={14} />
                확인 사항
              </div>
              <div className="bg-amber-50 p-1">
                <textarea
                  value={localData.notes}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  placeholder="민방위 훈련, 회의 일정, 특이사항 등..."
                  rows={10}
                  className="w-full px-3 py-2 text-sm text-amber-900 bg-white rounded font-sans leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 border-0"
                />
              </div>
            </div>
          </div>

          {/* 하단 안내 + 삭제 버튼 */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div className="text-[11px] text-slate-400">
              💡 입력 후 1.5초 멈추면 자동 저장됩니다
            </div>
            {!isNew && (
              <button onClick={() => onDelete(entry.id)} className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded flex items-center gap-1.5 border border-red-200">
                <Trash2 size={11} />
                삭제
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 작은 아이콘 컴포넌트 (Edit3 대체)
function Edit3Icon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  );
}

export default function App() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [authorFilter, setAuthorFilter] = useState("전체");
  const [expandedId, setExpandedId] = useState(null);
  const [newEntry, setNewEntry] = useState(null); // 새 일지 임시 객체

  useEffect(() => { fetchEntries(); }, []);

  async function fetchEntries() {
    setLoading(true);
    const { data, error } = await supabase
      .from("journal_entries")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      alert("데이터 불러오기 실패: " + error.message);
    } else {
      const formatted = data.map((e, idx) => ({
        id: e.id,
        displayNumber: idx + 1,
        author: e.author,
        weekLabel: e.week_label,
        thisWeekDate: e.this_week_date,
        nextWeekDate: e.next_week_date,
        thisWeekTasks: e.this_week_tasks || "",
        nextWeekTasks: e.next_week_tasks || "",
        notes: e.notes || "",
        createdAt: e.created_at,
      }));
      const reversed = [...formatted].reverse();
      setEntries(reversed);
      if (newEntry === null) {
        const thisWeekEntry = reversed.find((e) => isThisWeek(e.thisWeekDate));
        if (thisWeekEntry) setExpandedId(thisWeekEntry.id);
        else if (reversed.length > 0 && expandedId === null) setExpandedId(reversed[0].id);
      }
    }
    setLoading(false);
  }

  // 통합 저장 함수 (새 일지 또는 기존 일지 업데이트)
  async function handleSave(id, data, isNew) {
    if (isNew) {
      // 새 일지: insert
      const { data: inserted, error } = await supabase.from("journal_entries").insert([{
        author: data.author,
        week_label: data.weekLabel,
        this_week_date: data.thisWeekDate,
        next_week_date: data.nextWeekDate,
        this_week_tasks: data.thisWeekTasks,
        next_week_tasks: data.nextWeekTasks,
        notes: data.notes,
      }]).select();

      if (error) {
        alert("저장 실패: " + error.message);
        return { success: false };
      }
      // 새 일지 모드 종료
      setNewEntry(null);
      if (inserted && inserted[0]) {
        setExpandedId(inserted[0].id);
      }
      await fetchEntries();
      return { success: true };
    } else {
      // 기존 일지: update
      const { error } = await supabase.from("journal_entries").update({
        author: data.author,
        week_label: data.weekLabel,
        this_week_date: data.thisWeekDate,
        next_week_date: data.nextWeekDate,
        this_week_tasks: data.thisWeekTasks,
        next_week_tasks: data.nextWeekTasks,
        notes: data.notes,
      }).eq("id", id);

      if (error) {
        alert("저장 실패: " + error.message);
        return { success: false };
      }
      await fetchEntries();
      return { success: true };
    }
  }

  async function handleDelete(id) {
    if (!confirm("정말 이 일지를 삭제하시겠어요? 삭제하면 복구할 수 없습니다.")) return;
    const { error } = await supabase.from("journal_entries").delete().eq("id", id);
    if (error) alert("삭제 실패: " + error.message);
    else await fetchEntries();
  }

  function handleNewEntry() {
    const todayMonday = getMondayDateStr();
    const newEntryData = {
      id: "NEW",
      author: "",
      weekLabel: "새 일지",
      thisWeekDate: todayMonday,
      nextWeekDate: getNextMonday(todayMonday),
      thisWeekTasks: "",
      nextWeekTasks: "",
      notes: "",
    };
    setNewEntry(newEntryData);
    setExpandedId("NEW");
  }

  function handleCancelNew() {
    setNewEntry(null);
  }

  const authors = useMemo(() => ["전체", ...new Set(entries.map((e) => e.author))], [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = q === "" || e.thisWeekTasks.toLowerCase().includes(q) || e.weekLabel.toLowerCase().includes(q) || e.notes.toLowerCase().includes(q);
      const matchesAuthor = authorFilter === "전체" || e.author === authorFilter;
      return matchesSearch && matchesAuthor;
    });
  }, [entries, searchQuery, authorFilter]);

  const authorStats = useMemo(() => {
    const stats = {};
    entries.forEach((e) => { stats[e.author] = (stats[e.author] || 0) + 1; });
    return stats;
  }, [entries]);

  const thisWeekSubmitted = useMemo(() => {
    return entries.filter((e) => isThisWeek(e.thisWeekDate)).map((e) => e.author);
  }, [entries]);

  const submittedRate = Object.keys(authorStats).length > 0
    ? Math.round((thisWeekSubmitted.length / Object.keys(authorStats).length) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "'Noto Sans KR', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-10 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0c4a6e 0%, #075985 100%)" }}>
        <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: "linear-gradient(90deg, transparent 0%, #fbbf24 30%, #fbbf24 70%, transparent 100%)" }}></div>
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center backdrop-blur">
              <Calendar size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-white text-lg font-medium tracking-tight">주간업무일지</h1>
              <p className="text-white/70 text-xs mt-0.5">마린엔지오 · {getTodayKorean()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchEntries} className="px-3 py-1.5 text-sm text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded-md flex items-center gap-1.5 transition">
              <RefreshCw size={14} />
              새로고침
            </button>
            <button onClick={handleNewEntry} disabled={newEntry !== null} className="px-4 py-1.5 text-sm font-semibold rounded-md flex items-center gap-1.5 transition shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: "#fbbf24", color: "#422006" }}>
              <Plus size={15} strokeWidth={3} />
              새 일지
            </button>
          </div>
        </div>
      </header>

      <div className="px-6 py-6 grid grid-cols-12 gap-6">
        <aside className="col-span-2 space-y-3">
          <div className="bg-white border border-sky-100 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users size={14} className="text-sky-900" />
              <h2 className="text-sm font-semibold">팀원 현황</h2>
            </div>
            <div className="space-y-1">
              {Object.entries(authorStats).map(([name, count]) => {
                const submitted = thisWeekSubmitted.includes(name);
                return (
                  <div key={name} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <div className={"w-1.5 h-1.5 rounded-full " + (submitted ? "bg-emerald-500" : "bg-slate-300")}></div>
                      <span className="text-xs text-slate-700">{name}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{count}건</span>
                  </div>
                );
              })}
              {Object.keys(authorStats).length === 0 && !loading && (
                <div className="text-xs text-slate-400 text-center py-3">아직 일지가 없습니다</div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 text-[10px] text-slate-500">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span>이번주 제출 완료</span>
            </div>
          </div>

          <div className="rounded-lg border border-sky-200 p-4" style={{ background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)" }}>
            <div className="text-xs font-medium text-sky-900 mb-1.5">이번주 현황</div>
            <div className="text-2xl font-bold text-sky-900 leading-none">
              {thisWeekSubmitted.length}
              <span className="text-base text-sky-700">/{Math.max(Object.keys(authorStats).length, 1)}</span>
            </div>
            <div className="text-[10px] text-slate-600 mt-1">제출률 {submittedRate}%</div>
            <div className="mt-2 h-1 bg-white/60 rounded-full overflow-hidden">
              <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: submittedRate + "%" }}></div>
            </div>
          </div>

          <MiniCalendar />

          <div className="bg-white border border-sky-100 rounded-lg p-4 text-center">
            <img src="/logo.jpg" alt="Marine & Geo" className="w-20 h-20 mx-auto object-contain" />
            <div className="text-[10px] text-slate-500 mt-2 font-medium tracking-wider">MARINE &amp; GEO</div>
            <div className="text-[9px] text-slate-400 mt-0.5">Surveying the Future</div>
          </div>
        </aside>

        <main className="col-span-10 space-y-3">
          <div className="bg-white border border-sky-100 rounded-lg p-3 flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded border border-slate-200">
              <Search size={14} className="text-slate-400" />
              <input type="text" placeholder="과거 일지 검색 (예: 신안 케이윈드파워)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 bg-transparent text-sm outline-none" />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 border border-sky-100 rounded">
              <Filter size={13} className="text-slate-400" />
              <select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)} className="bg-transparent text-sm outline-none cursor-pointer">
                {authors.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div className="text-xs text-slate-500 px-1">
            {loading ? "불러오는 중..." : filteredEntries.length + "개의 일지"}
            {newEntry && <span className="text-amber-600 font-semibold"> · 새 일지 작성 중</span>}
            {searchQuery && <span> · "{searchQuery}" 검색 결과</span>}
          </div>

          {loading && (
            <div className="bg-white border border-sky-100 rounded-lg p-12 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              데이터를 불러오는 중...
            </div>
          )}

          <div className="space-y-3">
            {/* 새 일지 (작성 중) - 항상 맨 위 */}
            {newEntry && (
              <EntryCard
                key="NEW"
                entry={newEntry}
                isExpanded={true}
                isCurrent={false}
                isNew={true}
                onToggle={() => {}}
                onSave={handleSave}
                onDelete={handleDelete}
                onCancel={handleCancelNew}
              />
            )}

            {/* 기존 일지들 */}
            {filteredEntries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const isCurrent = isThisWeek(entry.thisWeekDate);

              return (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  isExpanded={isExpanded}
                  isCurrent={isCurrent}
                  isNew={false}
                  onToggle={() => setExpandedId(isExpanded ? null : entry.id)}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              );
            })}
          </div>

          {!loading && filteredEntries.length === 0 && !newEntry && (
            <div className="bg-white border border-sky-100 rounded-lg p-12 text-center text-slate-500 text-sm">
              {entries.length === 0 ? "아직 작성된 일지가 없습니다. 우측 상단 '새 일지' 버튼을 눌러 시작하세요!" : "검색 결과가 없습니다."}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
