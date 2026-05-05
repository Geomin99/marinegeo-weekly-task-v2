import { useState, useMemo, useEffect } from "react";
import { Search, Plus, Calendar, Users, ChevronDown, ChevronRight, X, Filter, RefreshCw, Loader2, Edit3, Trash2, AlertCircle, ChevronLeft } from "lucide-react";
import { supabase } from "./supabaseClient";

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

function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const monday = getMondayOfThisWeek();
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const target = new Date(dateStr);
  return target >= monday && target <= sunday;
}

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

export default function App() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [authorFilter, setAuthorFilter] = useState("전체");
  const [expandedId, setExpandedId] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

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
      const thisWeekEntry = reversed.find((e) => isThisWeek(e.thisWeekDate));
      if (thisWeekEntry) setExpandedId(thisWeekEntry.id);
      else if (reversed.length > 0 && expandedId === null) setExpandedId(reversed[0].id);
    }
    setLoading(false);
  }

  async function saveEntry(entry) {
    const { error } = await supabase.from("journal_entries").insert([{
      author: entry.author, week_label: entry.weekLabel,
      this_week_date: entry.thisWeekDate, next_week_date: entry.nextWeekDate,
      this_week_tasks: entry.thisWeekTasks, next_week_tasks: entry.nextWeekTasks,
      notes: entry.notes,
    }]);
    if (error) alert("저장 실패: " + error.message);
    else { await fetchEntries(); setShowNewModal(false); }
  }

  async function updateEntry(entry) {
    const { error } = await supabase.from("journal_entries").update({
      author: entry.author, week_label: entry.weekLabel,
      this_week_date: entry.thisWeekDate, next_week_date: entry.nextWeekDate,
      this_week_tasks: entry.thisWeekTasks, next_week_tasks: entry.nextWeekTasks,
      notes: entry.notes,
    }).eq("id", entry.id);
    if (error) alert("수정 실패: " + error.message);
    else { await fetchEntries(); setEditingEntry(null); }
  }

  async function deleteEntry(id) {
    if (!confirm("정말 이 일지를 삭제하시겠어요? 삭제하면 복구할 수 없습니다.")) return;
    const { error } = await supabase.from("journal_entries").delete().eq("id", id);
    if (error) alert("삭제 실패: " + error.message);
    else await fetchEntries();
  }

  const getWeekInfo = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
    const week = Math.ceil((d.getDate() + firstDay.getDay()) / 7);
    return month + "월 " + week + "주차";
  };

  const getNextMonday = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  };

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
            <button onClick={() => setShowNewModal(true)} className="px-4 py-1.5 text-sm font-semibold rounded-md flex items-center gap-1.5 transition shadow-md hover:shadow-lg" style={{ background: "#fbbf24", color: "#422006" }}>
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
            {searchQuery && <span> · "{searchQuery}" 검색 결과</span>}
          </div>

          {loading && (
            <div className="bg-white border border-sky-100 rounded-lg p-12 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              데이터를 불러오는 중...
            </div>
          )}

          <div className="space-y-3">
            {filteredEntries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const isCurrent = isThisWeek(entry.thisWeekDate);
              const avatar = getAvatarColor(entry.author);

              const cardClass = isCurrent
                ? "bg-white rounded-lg border-2 border-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.1)] overflow-hidden relative group"
                : "bg-white rounded-lg border border-slate-200 hover:border-sky-300 overflow-hidden relative group transition";

              return (
                <div key={entry.id} className={cardClass}>
                  <div className={
                    "absolute left-0 top-0 bottom-0 w-1 bg-sky-500 transition-opacity " +
                    (isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-60")
                  }></div>

                  <button onClick={() => setExpandedId(isExpanded ? null : entry.id)} className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-slate-50 transition text-left">
                    {isExpanded ? <ChevronDown size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isCurrent && (
                        <span className="bg-sky-500 text-white px-1.5 py-0.5 rounded text-[9px] font-medium">이번주</span>
                      )}
                      <span className="text-[11px] font-mono text-slate-400">#{entry.displayNumber}</span>
                    </div>
                    <div className="flex-1 text-sm font-medium">{entry.weekLabel}</div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: avatar.bg, color: avatar.text }}>
                        {entry.author.charAt(0)}
                      </div>
                      <span className="text-xs text-slate-600">{entry.author}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-4 pt-2 border-t border-slate-100">
                      <div className="grid grid-cols-3 gap-3 mb-4">

                        {/* 이번주 할 일 (파랑톤) */}
                        <div className="rounded-md overflow-hidden border border-sky-200">
                          <div className="bg-sky-900 text-white px-3.5 py-2 text-sm font-semibold">
                            이번주 할 일 · {entry.thisWeekDate}
                          </div>
                          <div className="bg-sky-50 px-3.5 py-3">
                            <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed text-left">{entry.thisWeekTasks}</pre>
                          </div>
                        </div>

                        {/* 다음주 할 일 (회색톤) */}
                        <div className="rounded-md overflow-hidden border border-slate-200">
                          <div className="bg-slate-600 text-white px-3.5 py-2 text-sm font-semibold">
                            다음주 할 일 · {entry.nextWeekDate}
                          </div>
                          <div className="bg-slate-50 px-3.5 py-3">
                            <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed text-left">{entry.nextWeekTasks || <span className="text-slate-400 italic">작성되지 않음</span>}</pre>
                          </div>
                        </div>

                        {/* 확인 사항 (노랑톤) */}
                        <div className="rounded-md overflow-hidden border border-amber-200">
                          <div className="bg-amber-500 text-white px-3.5 py-2 text-sm font-semibold flex items-center gap-1.5">
                            <AlertCircle size={14} />
                            확인 사항
                          </div>
                          <div className="bg-amber-50 px-3.5 py-3">
                            {entry.notes ? (
                              <div className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap text-left">{entry.notes}</div>
                            ) : (
                              <div className="text-sm text-slate-400 italic">없음</div>
                            )}
                          </div>
                        </div>

                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                        <button onClick={() => setEditingEntry(entry)} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded flex items-center gap-1.5 border border-slate-200">
                          <Edit3 size={11} />
                          수정
                        </button>
                        <button onClick={() => deleteEntry(entry.id)} className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded flex items-center gap-1.5 border border-red-200">
                          <Trash2 size={11} />
                          삭제
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!loading && filteredEntries.length === 0 && (
            <div className="bg-white border border-sky-100 rounded-lg p-12 text-center text-slate-500 text-sm">
              {entries.length === 0 ? "아직 작성된 일지가 없습니다." : "검색 결과가 없습니다."}
            </div>
          )}
        </main>
      </div>

      {showNewModal && (
        <EntryModal mode="new" onClose={() => setShowNewModal(false)} onSave={saveEntry} getWeekInfo={getWeekInfo} getNextMonday={getNextMonday} />
      )}

      {editingEntry && (
        <EntryModal mode="edit" existing={editingEntry} onClose={() => setEditingEntry(null)} onSave={updateEntry} getWeekInfo={getWeekInfo} getNextMonday={getNextMonday} />
      )}
    </div>
  );
}

function EntryModal({ mode, existing, onClose, onSave, getWeekInfo, getNextMonday }) {
  const today = new Date().toISOString().split("T")[0];
  const [thisWeekDate, setThisWeekDate] = useState(existing?.thisWeekDate || today);
  const [thisWeekTasks, setThisWeekTasks] = useState(existing?.thisWeekTasks || "");
  const [nextWeekTasks, setNextWeekTasks] = useState(existing?.nextWeekTasks || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [author, setAuthor] = useState(existing?.author || "");
  const [saving, setSaving] = useState(false);

  const nextWeekDate = getNextMonday(thisWeekDate);
  const weekInfo = getWeekInfo(thisWeekDate);

  async function handleSave() {
    if (!author || !thisWeekTasks) {
      alert("작성자와 이번주 할 일은 필수입니다.");
      return;
    }
    setSaving(true);
    await onSave({
      id: existing?.id,
      author,
      weekLabel: weekInfo + "(" + author + ")",
      thisWeekDate, nextWeekDate, thisWeekTasks, nextWeekTasks, notes,
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-bold">{mode === "edit" ? "일지 수정" : "새 주간업무일지"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">이번주 시작일 (월)</label>
              <input type="date" value={thisWeekDate} onChange={(e) => setThisWeekDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded text-sm" />
              <div className="text-xs text-slate-500 mt-1">자동: {weekInfo}</div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">다음주 (자동)</label>
              <input type="date" value={nextWeekDate} disabled className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-slate-50" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">작성자 *</label>
            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="이름" className="w-full px-3 py-2 border border-slate-200 rounded text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">이번주 할 일 *</label>
            <textarea value={thisWeekTasks} onChange={(e) => setThisWeekTasks(e.target.value)} placeholder="1. 탄성파 탐사" rows={8} className="w-full px-3 py-2 border border-slate-200 rounded text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">다음주 할 일</label>
            <textarea value={nextWeekTasks} onChange={(e) => setNextWeekTasks(e.target.value)} rows={8} className="w-full px-3 py-2 border border-slate-200 rounded text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">확인 사항</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="민방위 훈련, 회의 일정 등 (여러 줄 입력 가능)" rows={8} className="w-full px-3 py-2 border border-slate-200 rounded text-sm font-mono" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded disabled:opacity-50">취소</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-sky-900 text-white text-sm rounded hover:bg-sky-800 font-medium disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "저장 중..." : (mode === "edit" ? "수정 저장" : "저장")}
          </button>
        </div>
      </div>
    </div>
  );
}
