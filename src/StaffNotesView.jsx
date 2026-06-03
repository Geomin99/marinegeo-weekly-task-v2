import { useState, useEffect, useMemo, Component } from "react";
import {
  StickyNote, Plus, RotateCcw, Trash2, Pencil, X, Search, Lock,
  AlertTriangle, CheckSquare, CalendarClock, Link2,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { ErpHero } from "./ErpHero.jsx";
import {
  STAFF, nameForEmail, MEMO_TYPES, TYPE_COLORS, PRIORITIES, PRIORITY_COLORS,
  STATUSES, STATUS_COLORS, statusLabel, VISIBILITIES, visLabel, MODULE_LABEL, createStaffNote,
} from "./staffNotes";

class NoteErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error("[StaffNotes]", err); } catch { /* noop */ } }
  render() {
    if (this.state.err) return <div style={{ padding: 24, color: "#b91c1c" }}>직원 메모 화면 오류 — 새로고침해 주세요.</div>;
    return this.props.children;
  }
}

function Badge({ map, k, label }) {
  const c = map[k] || { bg: "#e5e7eb", fg: "#374151" };
  return <span style={{ background: c.bg, color: c.fg, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>{label || k}</span>;
}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function StaffNotesView({ session, viewer, onNotice }) {
  const email = (session?.user?.email || "").toLowerCase();
  const isOwner = viewer?.role === "owner";
  const myName = viewer?.name || null;
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [fEmp, setFEmp] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fModule, setFModule] = useState("");
  const [sort, setSort] = useState("recent");  // recent | followup | priority

  useEffect(() => { reload(); }, []);
  async function reload() {
    setLoading(true);
    const { data, error } = await supabase.from("staff_notes").select("*").order("created_at", { ascending: false });
    if (error) onNotice?.(`불러오기 실패: ${error.message}`, "error");
    setList(data || []);
    setLoading(false);
  }

  async function save(form, editing) {
    if (!form.content.trim()) { onNotice?.("내용을 입력하세요.", "error"); return; }
    if (!form.employee_id) { onNotice?.("대상 직원을 선택하세요.", "error"); return; }
    setBusy(true);
    try {
      const resolved_at = form.status === "done" ? new Date().toISOString() : null;
      if (editing) {
        const { error } = await supabase.from("staff_notes").update({
          employee_id: form.employee_id.toLowerCase(), employee_name: nameForEmail(form.employee_id),
          memo_type: form.memo_type, title: form.title || null, content: form.content,
          priority: form.priority, status: form.status, follow_up_date: form.follow_up_date || null,
          visibility: form.visibility, resolved_at, updated_at: new Date().toISOString(),
        }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await createStaffNote(session, { ...form, author_name: myName });
        if (error) throw error;
      }
      onNotice?.(editing ? "메모를 수정했습니다." : "메모를 등록했습니다.", "success");
      setModal(null); reload();
    } catch (e) { onNotice?.(`저장 실패: ${e.message}`, "error"); }
    setBusy(false);
  }

  async function doDelete(row) {
    setConfirmDel(null); setBusy(true);
    try {
      const { error } = await supabase.rpc("staff_note_soft_delete", { p_id: row.id });
      if (error) throw error;
      onNotice?.("보관 처리(삭제)되었습니다.", "success"); reload();
    } catch (e) { onNotice?.(`삭제 실패: ${e.message}`, "error"); }
    setBusy(false);
  }

  // 직원: 나에게 공유된 메모 '확인' 처리
  async function acknowledge(row) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("staff_note_acknowledge", { p_id: row.id });
      if (error) throw error;
      onNotice?.("확인했습니다.", "success"); reload();
    } catch (e) { onNotice?.(`확인 실패: ${e.message}`, "error"); }
    setBusy(false);
  }

  const tStr = todayStr();
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let arr = list.filter((n) => {
      if (fEmp && n.employee_id !== fEmp) return false;
      if (fType && n.memo_type !== fType) return false;
      if (fStatus && n.status !== fStatus) return false;
      if (fModule && (n.related_module || "") !== fModule) return false;
      if (needle) {
        const hay = [n.title, n.content, n.employee_name, n.memo_type].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (sort === "followup") arr = [...arr].sort((a, b) => (a.follow_up_date || "9999").localeCompare(b.follow_up_date || "9999"));
    else if (sort === "priority") { const w = { 긴급: 0, 높음: 1, 보통: 2, 낮음: 3 }; arr = [...arr].sort((a, b) => (w[a.priority] ?? 9) - (w[b.priority] ?? 9)); }
    return arr;
  }, [list, q, fEmp, fType, fStatus, fModule, sort]);

  // 현재 목록에 실제로 존재하는 관련 모듈만 필터 옵션으로 노출
  const moduleOptions = useMemo(() => {
    const set = new Set(list.map((n) => n.related_module).filter(Boolean));
    return [...set];
  }, [list]);

  const kpi = useMemo(() => {
    let check = 0, overdue = 0, openN = 0, urgent = 0;
    for (const n of list) {
      const active = n.status !== "done" && n.status !== "archived";
      if (active) openN++;
      if (active && n.follow_up_date === tStr) check++;
      if (active && n.follow_up_date && n.follow_up_date < tStr) overdue++;
      if (active && n.priority === "긴급") urgent++;
    }
    return { check, overdue, openN, urgent };
  }, [list, tStr]);

  return (
    <NoteErrorBoundary>
    <section className="module-frame">
      <ErpHero
        title={isOwner ? "업무 메모" : "공유된 업무 기록"}
        meta={isOwner ? `내부 관리 메모 · 전체 ${list.length}건` : `나에게 공유된 업무 기록 · ${list.length}건`}
        tags={isOwner ? ["내부 관리", "업무 연결", "권한별 열람(RLS)"] : ["내게 공유된 기록", "읽기 전용"]}
        actions={<button onClick={reload}><RotateCcw size={14} /> 새로고침</button>}
      />
      <div className="px-1 py-4">
        {!isOwner && (
          <div className="rounded-lg p-3 mb-4 text-[12.5px]" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a5f" }}>
            나에게 <b>공유된 메모</b>만 표시됩니다 (읽기 전용). 비공개 관리 메모는 보이지 않습니다.
          </div>
        )}
        {isOwner && (
          <div className="dash-kpis" style={{ marginBottom: 14 }}>
            {[
              { icon: <CalendarClock size={18} />, v: kpi.check, l: "오늘 확인" },
              { icon: <AlertTriangle size={18} />, v: kpi.overdue, l: "후속조치 지남" },
              { icon: <CheckSquare size={18} />, v: kpi.openN, l: "미완료" },
              { icon: <AlertTriangle size={18} />, v: kpi.urgent, l: "긴급" },
            ].map((k, i) => (
              <div className="kpi-card" key={i}><span className="kpi-icon">{k.icon}</span>
                <span className="kpi-body"><strong className="kpi-value">{k.v}</strong><span className="kpi-label">{k.l}</span></span></div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {isOwner && <button className="btn btn-primary" onClick={() => setModal({})}><Plus size={14} /> 새 메모</button>}
          <div className="flex items-center gap-1.5 rounded-md border px-2" style={{ borderColor: "var(--mg-line)", background: "#fff" }}>
            <Search size={14} style={{ color: "#94a3b8" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·내용·직원 검색" className="py-1.5 text-[13px] outline-none" style={{ width: 200 }} />
          </div>
          {isOwner && (
            <select value={fEmp} onChange={(e) => setFEmp(e.target.value)} className="vc-input" style={{ width: "auto" }}>
              <option value="">직원 전체</option>{STAFF.map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
            </select>
          )}
          <select value={fType} onChange={(e) => setFType(e.target.value)} className="vc-input" style={{ width: "auto" }}>
            <option value="">유형 전체</option>{MEMO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="vc-input" style={{ width: "auto" }}>
            <option value="">상태 전체</option>{STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
          {moduleOptions.length > 0 && (
            <select value={fModule} onChange={(e) => setFModule(e.target.value)} className="vc-input" style={{ width: "auto" }}>
              <option value="">출처 전체</option>{moduleOptions.map((m) => <option key={m} value={m}>{MODULE_LABEL[m] || m}</option>)}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="vc-input" style={{ width: "auto" }}>
            <option value="recent">최신순</option><option value="followup">후속조치일순</option><option value="priority">중요도순</option>
          </select>
        </div>

        {loading ? <div className="dash-empty">불러오는 중…</div>
          : filtered.length === 0 ? (
            <div className="rounded-xl border bg-white p-6 text-center text-[13px]" style={{ borderColor: "var(--mg-line)", color: "#94a3b8" }}>
              {list.length === 0 ? (isOwner ? "아직 메모가 없습니다. '새 메모'로 작성하세요." : "공유된 메모가 없습니다.") : "조건에 맞는 메모가 없습니다."}
            </div>
          ) : (
            <div className="grid gap-2.5">
              {filtered.map((n) => {
                const overdue = n.follow_up_date && n.follow_up_date < tStr && n.status !== "done" && n.status !== "archived";
                return (
                  <div key={n.id} className="rounded-xl border bg-white" style={{ borderColor: "var(--mg-line)" }}>
                    <div className="p-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge map={TYPE_COLORS} k={n.memo_type} />
                          <Badge map={PRIORITY_COLORS} k={n.priority} />
                          <Badge map={STATUS_COLORS} k={n.status} label={statusLabel(n.status)} />
                          <span className="badge muted">{n.employee_name || nameForEmail(n.employee_id)}</span>
                          {n.visibility === "private" && <Lock size={12} style={{ color: "#8a2f2f" }} />}
                          {n.related_module && <span className="badge blue"><Link2 size={11} className="inline" /> {MODULE_LABEL[n.related_module] || n.related_module}</span>}
                        </div>
                        {n.title && <div className="font-bold text-[14.5px]" style={{ color: "#142033" }}>{n.title}</div>}
                        <div className="text-[13px] mt-0.5 whitespace-pre-wrap" style={{ color: "#334155" }}>{n.content}</div>
                        <div className="text-[11.5px] mt-1.5 flex items-center gap-2 flex-wrap" style={{ color: "#94a3b8" }}>
                          <span>작성: {nameForEmail(n.author_email)} · {String(n.created_at).slice(0, 10)}</span>
                          {n.follow_up_date && <span style={{ color: overdue ? "#dc2626" : "#94a3b8", fontWeight: overdue ? 700 : 400 }}><CalendarClock size={11} className="inline" /> 후속 {n.follow_up_date}{overdue ? " (지남)" : ""}</span>}
                          {isOwner && <span>· {visLabel(n.visibility)}</span>}
                          {(n.visibility === "employee" || n.visibility === "team") && (
                            <span style={{ color: n.acknowledged_at ? "#16a34a" : "#dc2626", fontWeight: 600 }}>· {n.acknowledged_at ? `확인됨 ${String(n.acknowledged_at).slice(0, 10)}` : "미확인"}</span>
                          )}
                        </div>
                      </div>
                      {isOwner ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button className="icon-btn" title="수정" onClick={() => setModal(n)}><Pencil size={15} /></button>
                          <button className="icon-btn danger" title="삭제" onClick={() => setConfirmDel(n)} disabled={busy}><Trash2 size={15} /></button>
                        </div>
                      ) : !n.acknowledged_at ? (
                        <button className="btn btn-primary shrink-0" style={{ padding: "5px 12px", fontSize: 12.5 }} onClick={() => acknowledge(n)} disabled={busy}>확인</button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {modal && isOwner && <NoteModal init={modal} busy={busy} onClose={() => setModal(null)} onSave={(f) => save(f, modal.id ? modal : null)} />}

      {confirmDel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,.55)" }} onClick={() => setConfirmDel(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(420px,100%)", boxShadow: "0 18px 50px rgba(0,0,0,.3)" }}>
            <h3 style={{ margin: 0, color: "var(--mg-navy)", fontSize: 17, fontWeight: 800 }}>메모를 삭제할까요?</h3>
            <p style={{ margin: "8px 0 0", color: "var(--mg-sub)", fontSize: 13 }}>보관 처리되어 목록에서 사라집니다.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setConfirmDel(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--mg-line)", background: "#fff", color: "var(--mg-sub)", fontWeight: 600, cursor: "pointer" }}>취소</button>
              <button onClick={() => doDelete(confirmDel)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #dc2626", background: "#dc2626", color: "#fff", fontWeight: 700, cursor: "pointer" }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </section>
    </NoteErrorBoundary>
  );
}

function NoteModal({ init, busy, onClose, onSave }) {
  const editing = !!init?.id;
  const [f, setF] = useState({
    employee_id: init.employee_id || "", memo_type: init.memo_type || "일반",
    title: init.title || "", content: init.content || "",
    priority: init.priority || "보통", status: init.status || "open",
    follow_up_date: init.follow_up_date || "", visibility: init.visibility || "private",
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,.5)" }} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full overflow-hidden" style={{ maxWidth: 560, maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--mg-navy)", color: "#fff" }}>
          <div className="flex items-center gap-2"><StickyNote size={18} /><h3 className="font-bold">{editing ? "관리 메모 수정" : "새 관리 메모"}</h3></div>
          <button onClick={onClose} className="hover:opacity-70"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-[13px] overflow-auto">
          <div className="grid grid-cols-2 gap-2">
            <div><div className="mlbl">대상 직원 *</div><select value={f.employee_id} onChange={(e) => set("employee_id", e.target.value)} className="vc-input"><option value="">선택</option>{STAFF.map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}</select></div>
            <div><div className="mlbl">유형</div><select value={f.memo_type} onChange={(e) => set("memo_type", e.target.value)} className="vc-input">{MEMO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          </div>
          <div><div className="mlbl">제목</div><input value={f.title} onChange={(e) => set("title", e.target.value)} className="vc-input" placeholder="없으면 내용으로 대체" /></div>
          <div><div className="mlbl">내용 *</div><textarea value={f.content} onChange={(e) => set("content", e.target.value)} rows={4} className="vc-input" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><div className="mlbl">중요도</div><select value={f.priority} onChange={(e) => set("priority", e.target.value)} className="vc-input">{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><div className="mlbl">상태</div><select value={f.status} onChange={(e) => set("status", e.target.value)} className="vc-input">{STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select></div>
            <div><div className="mlbl">후속 조치일</div><input type="date" value={f.follow_up_date} onChange={(e) => set("follow_up_date", e.target.value)} className="vc-input" /></div>
            <div><div className="mlbl">공개 범위</div><select value={f.visibility} onChange={(e) => set("visibility", e.target.value)} className="vc-input">{VISIBILITIES.map((v) => <option key={v.v} value={v.v}>{v.label}</option>)}</select></div>
          </div>
          <div className="rounded-md p-2.5 text-[12px]" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a5f" }}>
            기본 <b>비공개</b>(관리자만). "직원 공유"로 두면 해당 직원도 본인 메모를 읽을 수 있습니다.
          </div>
        </div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t" style={{ borderColor: "var(--mg-line)", background: "#f8fbfd" }}>
          <button onClick={onClose} className="btn btn-ghost" disabled={busy}>취소</button>
          <button onClick={() => onSave(f)} className="btn btn-primary" disabled={busy}>{busy ? "저장 중…" : editing ? "수정" : "등록"}</button>
        </div>
      </div>
    </div>
  );
}
