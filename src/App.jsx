import { useState, useMemo, useEffect } from "react";
import { Search, Plus, Calendar, Users, ChevronDown, ChevronRight, X, Filter, RefreshCw, Loader2, Edit3, Trash2 } from "lucide-react";
import { supabase } from "./supabaseClient";

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
      .order("this_week_date", { ascending: false });

    if (error) {
      alert("데이터 불러오기 실패: " + error.message);
    } else {
      const formatted = data.map((e) => ({
        id: e.id,
        author: e.author,
        weekLabel: e.week_label,
        thisWeekDate: e.this_week_date,
        nextWeekDate: e.next_week_date,
        thisWeekTasks: e.this_week_tasks || "",
        nextWeekTasks: e.next_week_tasks || "",
        notes: e.notes || "",
        createdAt: e.created_at,
      }));
      setEntries(formatted);
      if (formatted.length > 0 && expandedId === null) setExpandedId(formatted[0].id);
    }
    setLoading(false);
  }

  async function saveEntry(entry) {
    const { error } = await supabase.from("journal_entries").insert([{
      author: entry.author,
      week_label: entry.weekLabel,
      this_week_date: entry.thisWeekDate,
      next_week_date: entry.nextWeekDate,
      this_week_tasks: entry.thisWeekTasks,
      next_week_tasks: entry.nextWeekTasks,
      notes: entry.notes,
    }]);

    if (error) {
      alert("저장 실패: " + error.message);
    } else {
      await fetchEntries();
      setShowNewModal(false);
    }
  }

  async function updateEntry(entry) {
    const { error } = await supabase
      .from("journal_entries")
      .update({
        author: entry.author,
        week_label: entry.weekLabel,
        this_week_date: entry.thisWeekDate,
        next_week_date: entry.nextWeekDate,
        this_week_tasks: entry.thisWeekTasks,
        next_week_tasks: entry.nextWeekTasks,
        notes: entry.notes,
      })
      .eq("id", entry.id);

    if (error) {
      alert("수정 실패: " + error.message);
    } else {
      await fetchEntries();
      setEditingEntry(null);
    }
  }

  async function deleteEntry(id) {
    if (!confirm("정말 이 일지를 삭제하시겠어요? 삭제하면 복구할 수 없습니다.")) return;

    const { error } = await supabase.from("journal_entries").delete().eq("id", id);

    if (error) {
      alert("삭제 실패: " + error.message);
    } else {
      await fetchEntries();
    }
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
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return entries.filter((e) => new Date(e.createdAt) > oneWeekAgo).map((e) => e.author);
  }, [entries]);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900" style={{ fontFamily: "'Noto Sans KR', system-ui, sans-serif" }}>
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-stone-900 rounded flex items-center justify-center">
              <Calendar size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">주간업무일지</h1>
              <p className="text-xs text-stone-500">마린엔지오 · 탄성파 탐사팀 (DB 연결됨)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchEntries} className="px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 rounded flex items-center gap-1.5">
              <RefreshCw size={15} />
              새로고침
            </button>
            <button onClick={() => setShowNewModal(true)} className="px-4 py-2 bg-stone-900 text-white text-sm rounded hover:bg-stone-700 flex items-center gap-1.5 font-medium">
              <Plus size={15} />
              새 일지
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-12 gap-6">
        <aside className="col-span-3 space-y-4">
          <div className="bg-white border border-stone-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-stone-500" />
              <h2 className="text-sm font-semibold">팀원별 작성 현황</h2>
            </div>
            <div className="space-y-2">
              {Object.entries(authorStats).map(([name, count]) => {
                const submitted = thisWeekSubmitted.includes(name);
                return (
                  <div key={name} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <div className={"w-2 h-2 rounded-full " + (submitted ? "bg-emerald-500" : "bg-stone-300")}></div>
                      <span className="text-sm text-stone-700">{name}</span>
                    </div>
                    <span className="text-xs text-stone-500 font-mono">{count}건</span>
                  </div>
                );
              })}
              {Object.keys(authorStats).length === 0 && !loading && (
                <div className="text-xs text-stone-400 text-center py-4">아직 일지가 없습니다</div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-2 text-xs text-stone-500">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <span>이번주 제출 완료</span>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold mb-3">통계</h2>
            <div className="space-y-3">
              <div>
                <div className="text-2xl font-bold tracking-tight">{entries.length}</div>
                <div className="text-xs text-stone-500">총 일지 수</div>
              </div>
              <div>
                <div className="text-2xl font-bold tracking-tight text-emerald-600">
                  {thisWeekSubmitted.length}/{Math.max(Object.keys(authorStats).length, 1)}
                </div>
                <div className="text-xs text-stone-500">이번주 제출률</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="col-span-9 space-y-4">
          <div className="bg-white border border-stone-200 rounded-lg p-3 flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-stone-50 rounded border border-stone-200">
              <Search size={15} className="text-stone-400" />
              <input type="text" placeholder="과거 일지 검색 (예: 신안 케이윈드파워)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 bg-transparent text-sm outline-none" />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-stone-400 hover:text-stone-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 border border-stone-200 rounded">
              <Filter size={14} className="text-stone-400" />
              <select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)} className="bg-transparent text-sm outline-none cursor-pointer">
                {authors.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div className="text-xs text-stone-500 px-1">
            {loading ? "불러오는 중..." : filteredEntries.length + "개의 일지"}
            {searchQuery && <span> · "{searchQuery}" 검색 결과</span>}
          </div>

          {loading && (
            <div className="bg-white border border-stone-200 rounded-lg p-12 text-center text-stone-500 text-sm flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              데이터를 불러오는 중...
            </div>
          )}

          <div className="space-y-3">
            {filteredEntries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              return (
                <div key={entry.id} className="bg-white border border-stone-200 rounded-lg overflow-hidden hover:border-stone-300 transition">
                  <button onClick={() => setExpandedId(isExpanded ? null : entry.id)} className="w-full px-5 py-4 flex items-center gap-4 hover:bg-stone-50 transition text-left">
                    {isExpanded ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
                    <div className="flex-1 grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-1 text-xs font-mono text-stone-400">#{entry.id}</div>
                      <div className="col-span-3"><div className="text-sm font-medium">{entry.weekLabel}</div></div>
                      <div className="col-span-3 text-xs text-stone-500 font-mono">{entry.thisWeekDate} → {entry.nextWeekDate}</div>
                      <div className="col-span-3 text-xs text-stone-600 truncate">{entry.thisWeekTasks.split("\n")[0]}</div>
                      <div className="col-span-2 flex items-center justify-end gap-2">
                        <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center text-[10px] font-bold text-stone-600">{entry.author.charAt(0)}</div>
                        <span className="text-xs text-stone-600">{entry.author}</span>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-stone-100">
                      <div className="grid grid-cols-2 gap-6 mb-4">
                        <div>
                          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">이번주 할 일 · {entry.thisWeekDate}</div>
                          <pre className="text-sm text-stone-800 whitespace-pre-wrap font-sans leading-relaxed">{entry.thisWeekTasks}</pre>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">다음주 할 일 · {entry.nextWeekDate}</div>
                            <pre className="text-sm text-stone-800 whitespace-pre-wrap font-sans leading-relaxed">{entry.nextWeekTasks || <span className="text-stone-400 italic">작성되지 않음</span>}</pre>
                          </div>
                          {entry.notes && (
                            <div>
                              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">확인 사항</div>
                              <div className="text-sm text-stone-800 bg-amber-50 border-l-2 border-amber-400 px-3 py-2 rounded-r">{entry.notes}</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* === 수정/삭제 버튼 === */}
                      <div className="flex items-center gap-2 pt-3 border-t border-stone-100">
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100 rounded flex items-center gap-1.5 border border-stone-200"
                        >
                          <Edit3 size={12} />
                          수정
                        </button>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded flex items-center gap-1.5 border border-stone-200"
                        >
                          <Trash2 size={12} />
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
            <div className="bg-white border border-stone-200 rounded-lg p-12 text-center text-stone-500 text-sm">
              {entries.length === 0 ? "아직 작성된 일지가 없습니다." : "검색 결과가 없습니다."}
            </div>
          )}
        </main>
      </div>

      {showNewModal && (
        <EntryModal
          mode="new"
          onClose={() => setShowNewModal(false)}
          onSave={saveEntry}
          getWeekInfo={getWeekInfo}
          getNextMonday={getNextMonday}
        />
      )}

      {editingEntry && (
        <EntryModal
          mode="edit"
          existing={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSave={updateEntry}
          getWeekInfo={getWeekInfo}
          getNextMonday={getNextMonday}
        />
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
      thisWeekDate,
      nextWeekDate,
      thisWeekTasks,
      nextWeekTasks,
      notes,
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-stone-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-bold">{mode === "edit" ? "일지 수정" : "새 주간업무일지"}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-stone-600 mb-1 block">이번주 시작일 (월)</label>
              <input type="date" value={thisWeekDate} onChange={(e) => setThisWeekDate(e.target.value)} className="w-full px-3 py-2 border border-stone-200 rounded text-sm" />
              <div className="text-xs text-stone-500 mt-1">자동: {weekInfo}</div>
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 mb-1 block">다음주 (자동)</label>
              <input type="date" value={nextWeekDate} disabled className="w-full px-3 py-2 border border-stone-200 rounded text-sm bg-stone-50" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-600 mb-1 block">작성자 *</label>
            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="이름" className="w-full px-3 py-2 border border-stone-200 rounded text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-600 mb-1 block">이번주 할 일 *</label>
            <textarea value={thisWeekTasks} onChange={(e) => setThisWeekTasks(e.target.value)} placeholder="1. 탄성파 탐사" rows={8} className="w-full px-3 py-2 border border-stone-200 rounded text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-600 mb-1 block">다음주 할 일</label>
            <textarea value={nextWeekTasks} onChange={(e) => setNextWeekTasks(e.target.value)} rows={4} className="w-full px-3 py-2 border border-stone-200 rounded text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-600 mb-1 block">확인 사항</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="민방위 훈련, 회의 일정 등" className="w-full px-3 py-2 border border-stone-200 rounded text-sm" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 rounded disabled:opacity-50">취소</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-stone-900 text-white text-sm rounded hover:bg-stone-700 font-medium disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "저장 중..." : (mode === "edit" ? "수정 저장" : "저장")}
          </button>
        </div>
      </div>
    </div>
  );
}