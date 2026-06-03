import { useState } from "react";
import { StickyNote, X } from "lucide-react";
import { STAFF, MEMO_TYPES, PRIORITIES, STATUSES, VISIBILITIES, createStaffNote } from "./staffNotes";

// 회의록·통화로그·센터 등에서 '업무 메모로 저장'. owner(관리자)만 노출.
// props: session, viewer, related={module,id}, defaultTitle, defaultEmployee, defaultType, onNotice, iconOnly
export function StaffNoteButton({ session, viewer, related, defaultTitle, defaultEmployee, defaultType, onNotice, iconOnly = true, label = "업무 메모" }) {
  const [open, setOpen] = useState(false);
  if (viewer?.role !== "owner") return null;
  return (
    <>
      <button className={iconOnly ? "icon-btn" : "btn btn-ghost"} title="업무 메모로 저장" onClick={() => setOpen(true)}>
        <StickyNote size={iconOnly ? 15 : 13} />{!iconOnly && <span> {label}</span>}
      </button>
      {open && (
        <QuickModal session={session} related={related} defaultTitle={defaultTitle}
                    defaultEmployee={defaultEmployee} defaultType={defaultType}
                    onClose={() => setOpen(false)} onNotice={onNotice} />
      )}
    </>
  );
}

function QuickModal({ session, related, defaultTitle, defaultEmployee, defaultType, onClose, onNotice }) {
  const [f, setF] = useState({
    employee_id: defaultEmployee || "", memo_type: defaultType || "후속조치",
    title: defaultTitle || "", content: "",
    priority: "보통", status: "open", follow_up_date: "", visibility: "private",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.employee_id) { onNotice?.("대상 직원을 선택하세요.", "error"); return; }
    if (!f.content.trim()) { onNotice?.("내용을 입력하세요.", "error"); return; }
    setBusy(true);
    try {
      const { error } = await createStaffNote(session, {
        ...f, related_module: related?.module || null, related_id: related?.id ?? null,
      });
      if (error) throw error;
      onNotice?.("업무 메모로 저장했습니다.", "success");
      onClose();
    } catch (e) { onNotice?.(`저장 실패: ${e.message}`, "error"); }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,.5)" }} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full overflow-hidden" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--mg-navy)", color: "#fff" }}>
          <div className="flex items-center gap-2"><StickyNote size={18} /><h3 className="font-bold">업무 메모로 저장</h3></div>
          <button onClick={onClose} className="hover:opacity-70"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-[13px]">
          <div className="grid grid-cols-2 gap-2">
            <div><div className="mlbl">대상 직원 *</div><select value={f.employee_id} onChange={(e) => set("employee_id", e.target.value)} className="vc-input"><option value="">선택</option>{STAFF.map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}</select></div>
            <div><div className="mlbl">유형</div><select value={f.memo_type} onChange={(e) => set("memo_type", e.target.value)} className="vc-input">{MEMO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          </div>
          <div><div className="mlbl">제목</div><input value={f.title} onChange={(e) => set("title", e.target.value)} className="vc-input" /></div>
          <div><div className="mlbl">내용 *</div><textarea value={f.content} onChange={(e) => set("content", e.target.value)} rows={3} className="vc-input" placeholder="이 직원에게 전달·확인할 내용" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><div className="mlbl">중요도</div><select value={f.priority} onChange={(e) => set("priority", e.target.value)} className="vc-input">{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><div className="mlbl">후속 조치일</div><input type="date" value={f.follow_up_date} onChange={(e) => set("follow_up_date", e.target.value)} className="vc-input" /></div>
            <div className="col-span-2"><div className="mlbl">공개 범위</div><select value={f.visibility} onChange={(e) => set("visibility", e.target.value)} className="vc-input">{VISIBILITIES.map((v) => <option key={v.v} value={v.v}>{v.label}</option>)}</select></div>
          </div>
          {related?.module && <div className="text-[11.5px]" style={{ color: "#94a3b8" }}>연결: {related.module} 기록과 연결됩니다.</div>}
        </div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t" style={{ borderColor: "var(--mg-line)", background: "#f8fbfd" }}>
          <button onClick={onClose} className="btn btn-ghost" disabled={busy}>취소</button>
          <button onClick={save} className="btn btn-primary" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}
