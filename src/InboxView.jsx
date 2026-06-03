import { useState, useRef } from "react";
import { ExternalLink, CheckCircle2, Archive, RotateCcw, Inbox, Clock, Mail } from "lucide-react";
import { supabase } from "./supabaseClient";
import { ErpHero } from "./ErpHero.jsx";
import { StaffNoteButton } from "./QuickStaffNote.jsx";
import { PRIORITY_FROM_DRAFT } from "./staffNotes";

const OWNER_EMAIL = "geomin99@gmail.com"; // 받은편지함은 대표 개인 triage — 기본 대상=대표 본인

// 받은편지함 업무 추출 초안 (A안) — 토뭉이님 전용. inbox_action_drafts(RLS owner) 조회.
const CAT_LABEL = {
  client_or_project: "발주처·프로젝트",
  school_industry: "학교·산학",
  center: "센터",
  admin_tax: "행정·세무",
  personal_review: "개인 확인",
  other: "기타",
};
const PRIO = {
  urgent: { label: "긴급", bg: "#fde2e1", fg: "#b42318" },
  high:   { label: "높음", bg: "#fef0c7", fg: "#b54708" },
  normal: { label: "보통", bg: "#e0eaf6", fg: "#175cd3" },
  low:    { label: "낮음", bg: "#eceff3", fg: "#475467" },
};
const PRIO_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };

function fmt(s) { return s ? String(s).slice(0, 10) : ""; }

function DraftCard({ d, busy, onStatus, session, viewer, hasNote, onNotesChanged, onNotice }) {
  const p = PRIO[d.priority] || PRIO.normal;
  const done = d.status === "done" || d.status === "archived";
  const strip = d.status === "done" ? "green" : d.status === "archived" ? "muted"
    : d.priority === "urgent" ? "red" : d.priority === "high" ? "amber" : "blue";
  const prioBadge = d.priority === "urgent" ? "red" : d.priority === "high" ? "amber" : "muted";
  return (
    <section className={`panel center-task strip-${strip}${done ? " is-done" : ""}`}>
      <div className="center-task-main">
        <div className="center-task-head">
          <span className={`badge ${prioBadge}`}>{p.label}</span>
          <span className="badge muted">{CAT_LABEL[d.category] || "기타"}</span>
          {d.due_date && <span className="badge amber">마감 {fmt(d.due_date)}</span>}
          {d.status === "done" && <span className="badge green">완료</span>}
          {d.status === "archived" && <span className="badge muted">보관</span>}
        </div>
        <h3 className="center-task-title">{d.subject_masked}</h3>
        <div className="center-task-meta">
          {d.sender_name_masked && <span>보낸이 {d.sender_name_masked}</span>}
          {d.sender_email_domain && <span>{d.sender_email_domain}</span>}
          {d.received_at && <span>수신 {fmt(d.received_at)}</span>}
        </div>
        {d.summary_masked && <p className="center-task-note">{d.summary_masked}</p>}
      </div>
      <div className="center-task-actions">
        {d.status === "needs_review" && (
          <StaffNoteButton
            session={session} viewer={viewer}
            related={{ module: "inbox", id: d.id }}
            defaultTitle={d.subject_masked || ""}
            defaultContent={d.summary_masked || ""}
            defaultType="확인필요"
            defaultEmployee={OWNER_EMAIL}
            defaultPriority={PRIORITY_FROM_DRAFT[d.priority] || "보통"}
            defaultFollowUp={d.due_date ? String(d.due_date).slice(0, 10) : ""}
            onNotice={onNotice} onSaved={onNotesChanged} hasNote={hasNote}
          />
        )}
        {done ? (
          <button className="icon-btn" title="확인필요로 되돌리기" onClick={() => onStatus(d.id, "needs_review")} disabled={busy}><RotateCcw size={15} /></button>
        ) : (
          <button className="icon-btn done" title="완료 처리" onClick={() => onStatus(d.id, "done")} disabled={busy}><CheckCircle2 size={16} /></button>
        )}
        {d.gmail_link && (
          <a className="icon-btn" title="원문 메일 열기" href={d.gmail_link} target="_blank" rel="noreferrer"><Mail size={15} /></a>
        )}
        {!done && (
          <button className="icon-btn" title="보관" onClick={() => onStatus(d.id, "archived")} disabled={busy}><Archive size={15} /></button>
        )}
      </div>
    </section>
  );
}

export default function InboxView({ drafts, onReload, onNotice, ownerId, session, viewer, relatedKeys, onNotesChanged }) {
  const hasNoteFor = (id) => relatedKeys?.has(`inbox:${id}`) || false;
  const [busyId, setBusyId] = useState(null);
  const [scan, setScan] = useState(null);
  const pollRef = useRef(null);

  async function requestScan() {
    try {
      const { data: active } = await supabase.from("scan_requests")
        .select("*").in("status", ["pending", "running"]).order("requested_at", { ascending: false }).limit(1);
      if (active && active.length) { setScan(active[0]); pollScan(active[0].id); onNotice?.("이미 메일 분석이 진행 중입니다.", "info"); return; }
      const { data, error } = await supabase.from("scan_requests")
        .insert({ owner: ownerId, requested_by: ownerId, scope: "both" }).select("*").single();
      if (error) { onNotice?.(`요청 실패: ${error.message}`, "error"); return; }
      setScan(data); onNotice?.("메일 분석 요청됨 — 잠시 후 반영됩니다.", "success"); pollScan(data.id);
    } catch (e) { onNotice?.(`요청 오류: ${e.message}`, "error"); }
  }
  function pollScan(id) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data } = await supabase.from("scan_requests").select("*").eq("id", id).maybeSingle();
      if (!data) return;
      setScan(data);
      if (data.status === "done" || data.status === "failed") {
        clearInterval(pollRef.current); pollRef.current = null;
        if (data.status === "done") { onReload?.(); onNotice?.(`분석 완료 · 센터 ${data.center_created_count} · 받은편지함 ${data.inbox_draft_created_count}`, "success"); }
        else onNotice?.(`분석 실패: ${data.error_message || "다시 시도"}`, "error");
        setTimeout(() => setScan(null), 5000);
      }
    }, 3000);
  }
  const scanning = scan && (scan.status === "pending" || scan.status === "running");
  const list = (drafts || []).filter((d) => !d.deleted_at);
  const open = list.filter((d) => d.status === "needs_review")
    .sort((a, b) => (PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]) || (a.received_at < b.received_at ? 1 : -1));
  const handled = list.filter((d) => d.status === "done" || d.status === "archived")
    .sort((a, b) => (a.received_at < b.received_at ? 1 : -1));

  async function onStatus(id, status) {
    setBusyId(id);
    const { error } = await supabase.from("inbox_action_drafts")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    setBusyId(null);
    if (error) { onNotice?.(`변경 실패: ${error.message}`, "error"); return; }
    onNotice?.(status === "done" ? "완료 처리했습니다." : status === "archived" ? "보관함으로 옮겼습니다." : "확인필요로 되돌렸습니다.", "success");
    onReload?.();
  }

  return (
    <section className="module-frame">
      <ErpHero
        title="내 받은편지함 업무"
        meta={`토뭉이님 전용 · 확인필요 ${open.length} · 처리됨 ${handled.length} · 받은편지함 메일 자동 추출`}
        tags={["개인 전용", "메일 자동 추출", ...(open.length > 0 ? [{ label: `확인필요 ${open.length}`, hot: true }] : [])]}
        actions={(
          <>
            <button className="erp-act-primary" onClick={requestScan} disabled={scanning}
                    title="센터·받은편지함 메일을 스캔해 새 업무 초안을 만듭니다">
              <Mail size={14} className={scanning ? "erp-spin" : ""} /> {scanning ? (scan.status === "running" ? "분석 중…" : "요청됨…") : "메일 분석"}
            </button>
            <button onClick={onReload}><RotateCcw size={14} /> 새로고침</button>
          </>
        )}
      />

      <div className="px-1 py-4">
        <div className="text-[13px] font-bold mb-2 flex items-center gap-1.5" style={{ color: "#142033" }}>
          <Inbox size={15} /> 확인 필요 ({open.length})
        </div>
        {open.length === 0 ? (
          <div className="rounded-xl border bg-white p-6 text-center text-[13px]" style={{ borderColor: "#d9e3ee", color: "#94a3b8" }}>
            확인할 업무가 없습니다. (받은편지함에서 새 업무가 감지되면 여기에 초안으로 쌓입니다)
          </div>
        ) : (
          <div className="grid gap-2.5">
            {open.map((d) => <DraftCard key={d.id} d={d} busy={busyId === d.id} onStatus={onStatus}
              session={session} viewer={viewer} hasNote={hasNoteFor(d.id)} onNotesChanged={onNotesChanged} onNotice={onNotice} />)}
          </div>
        )}

        {handled.length > 0 && (
          <>
            <div className="text-[13px] font-bold mt-6 mb-2" style={{ color: "#637083" }}>처리됨 ({handled.length})</div>
            <div className="grid gap-2.5 opacity-80">
              {handled.map((d) => <DraftCard key={d.id} d={d} busy={busyId === d.id} onStatus={onStatus}
                session={session} viewer={viewer} hasNote={hasNoteFor(d.id)} onNotesChanged={onNotesChanged} onNotice={onNotice} />)}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
