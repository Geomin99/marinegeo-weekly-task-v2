import { useState, useEffect, useMemo, useRef, Component } from "react";
import {
  Users, Plus, RotateCcw, Trash2, Pencil, X, Search,
  ClipboardList, CheckSquare, AlertTriangle, ChevronDown, ChevronUp, Lock,
  Upload, FileAudio, Mic, ClipboardPaste, PencilLine, ShieldAlert,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { ErpHero } from "./ErpHero.jsx";

// 흰화면 크래시 방지 (헌법 코드검증 의무 — 캘린더 흰화면 계기)
class MeetErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error("[Meeting]", err); } catch { /* noop */ } }
  render() {
    if (this.state.err) return (
      <div style={{ padding: 24, color: "#b91c1c" }}>회의록 화면 오류 — 새로고침해 주세요.
        <button onClick={() => this.setState({ err: null })} style={{ marginLeft: 8, textDecoration: "underline" }}>다시 시도</button></div>
    );
    return this.props.children;
  }
}

const MEETING_TYPES = ["내부 회의", "거래처 미팅", "해양벤처진흥센터", "프로젝트 회의", "계약/청구 회의", "기술 검토", "자료처리/해석 회의", "인사/급여", "기타"];
const METHODS = ["대면", "온라인", "전화", "혼합"];
const AUDIO_ACCEPT = ".m4a,.mp3,.wav,.webm,.mp4,.mpeg,.mpga,audio/*";

// 상태 7종 (DB enum) · badge 색
const STATUS = {
  draft:        { label: "초안",     bg: "#e5e7eb", fg: "#374151" },
  transcribing: { label: "전사중",   bg: "#dbeafe", fg: "#1e4f8f" },
  summarized:   { label: "요약완료", bg: "#d9f0e3", fg: "#1f5c3b" },
  reviewing:    { label: "검토중",   bg: "#fff1c7", fg: "#6b4a00" },
  confirmed:    { label: "확정",     bg: "#d9f0e3", fg: "#16633a" },
  follow_up:    { label: "후속조치중", bg: "#fde2e2", fg: "#8a2f2f" },
  done:         { label: "완료",     bg: "#dfe7f3", fg: "#1f3a5f" },
};
const STATUS_ORDER = ["draft", "transcribing", "summarized", "reviewing", "confirmed", "follow_up", "done"];
// 공개범위 4종 badge
const VIS = {
  all:          { label: "전체",       bg: "#e5e7eb", fg: "#374151" },
  participants: { label: "참석자만",   bg: "#dbeafe", fg: "#1e4f8f" },
  admin:        { label: "관리자만",   bg: "#fff1c7", fg: "#6b4a00" },
  owner_only:   { label: "대표 전용",  bg: "#fde2e2", fg: "#8a2f2f" },
};

function Badge({ map, k }) {
  const c = map[k] || { label: k, bg: "#e5e7eb", fg: "#374151" };
  return <span style={{ background: c.bg, color: c.fg, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>{c.label}</span>;
}

function fmtDate(s) { return s ? String(s).slice(0, 16).replace("T", " ") : ""; }
function lines(t) { return (t || "").split("\n").map(x => x.trim()).filter(Boolean); }
function parseParticipants(t) {
  return lines(t).map(row => {
    const [name, email] = row.split(",").map(x => (x || "").trim());
    return { display_name: name || email, email: email ? email.toLowerCase() : null, role: "attendee", is_internal: true };
  });
}
function weekStart() { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d; }

export default function MeetingView({ session, viewer, onNotice }) {
  const email = (session?.user?.email || "").toLowerCase();
  const myName = viewer?.name || null;
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState("summary");
  const [parts, setParts] = useState({});       // meeting_id -> participants[]
  const [modal, setModal] = useState(null);      // null | {} (new) | row (edit)
  const [confirmDel, setConfirmDel] = useState(null);
  const [busy, setBusy] = useState(false);
  // 필터
  const [q, setQ] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");

  useEffect(() => { reload(); }, []);

  // 전사·요약 진행 중이면 6초마다 자동 갱신 → 회사 PC 워커가 채우면 화면 자동 반영
  useEffect(() => {
    const active = list.some(m => m.status === "transcribing" || m.status === "summarized" && !m.summary_text);
    if (!active) return;
    const iv = setInterval(() => reload(), 6000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  async function reload() {
    setLoading(true);
    const { data, error } = await supabase.from("meetings").select("*").order("meeting_date", { ascending: false, nullsFirst: false });
    if (error) onNotice?.(`불러오기 실패: ${error.message}`, "error");
    setList(data || []);
    setLoading(false);
  }

  async function loadParticipants(id) {
    if (parts[id]) return;
    const { data } = await supabase.from("meeting_participants").select("*").eq("meeting_id", id);
    setParts(p => ({ ...p, [id]: data || [] }));
  }

  function openDetail(r) {
    const next = openId === r.id ? null : r.id;
    setOpenId(next); setTab("summary");
    if (next) loadParticipants(r.id);
  }

  // 입력 3방식 공통 저장. inputType: 'manual' | 'audio' | 'paste'
  async function saveAny(form, editing, inputType, file) {
    if (!form.title.trim()) { onNotice?.("회의명을 입력하세요.", "error"); return; }
    if (inputType === "audio" && !editing && !file) { onNotice?.("음성파일을 선택하세요.", "error"); return; }
    setBusy(true);
    try {
      // 음성=전사 대기, 붙여넣기=원문 직입력, 직접작성=폼 상태
      const method = editing ? (editing.input_method || "manual") : inputType;
      const payload = {
        title: form.title.trim(),
        meeting_date: form.meeting_date ? new Date(form.meeting_date).toISOString() : null,
        meeting_type: form.meeting_type || null,
        meeting_method: form.meeting_method || null,
        location: form.location || null,
        visibility: form.visibility || "participants",
        agenda: lines(form.agenda),
        minutes_text: form.minutes_text || null,
        decisions: lines(form.decisions),
        action_items: lines(form.action_items).map(t => ({ task: t, source: "manual", status: "open" })),
        updated_at: new Date().toISOString(),
      };
      if (editing) {
        payload.status = form.status || "draft";
        payload.follow_up_required = form.status === "follow_up";
      } else if (inputType === "audio") {
        payload.input_method = "audio"; payload.status = "transcribing";
      } else if (inputType === "paste") {
        payload.input_method = "paste"; payload.status = "draft";
        payload.transcript_text = form.paste_text || null;
      } else {
        payload.input_method = "manual"; payload.status = form.status || "draft";
        payload.follow_up_required = form.status === "follow_up";
      }

      let meetingId;
      if (editing) {
        const { error } = await supabase.from("meetings").update(payload).eq("id", editing.id);
        if (error) throw error; meetingId = editing.id;
      } else {
        meetingId = crypto.randomUUID();
        const { error } = await supabase.from("meetings").insert({
          id: meetingId, owner_user_id: session?.user?.id, created_by: myName || email,
          created_by_email: email, ...payload,
        });
        if (error) throw error;
      }

      // 음성파일 업로드 (회의 생성 후 — Storage RLS는 meeting_id 폴더 기준)
      if (!editing && inputType === "audio" && file) {
        const fileId = crypto.randomUUID();
        const ext = (file.name.split(".").pop() || "dat").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "dat";
        const path = `${meetingId}/${fileId}/audio.${ext}`;
        const { error: upErr } = await supabase.storage.from("meeting-audio")
          .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (upErr) {
          // 업로드 실패 → 방금 만든 회의 롤백(보관) — RPC로 soft-delete
          await supabase.rpc("meeting_soft_delete", { p_id: meetingId });
          throw new Error(`음성 업로드 실패: ${upErr.message}`);
        }
        await supabase.from("meeting_files").insert({
          id: fileId, meeting_id: meetingId, kind: "audio", storage_path: path,
          original_filename: file.name, mime_type: file.type || null, size_bytes: file.size, uploaded_by: email,
        });
      }

      const rows = parseParticipants(form.participants).map(p => ({ ...p, meeting_id: meetingId }));
      await supabase.from("meeting_participants").delete().eq("meeting_id", meetingId);
      if (rows.length) await supabase.from("meeting_participants").insert(rows);
      setParts(p => ({ ...p, [meetingId]: rows }));
      onNotice?.(editing ? "회의록을 수정했습니다."
        : inputType === "audio" ? "업로드 완료 — 전사 대기열에 등록되었습니다."
        : "회의록을 등록했습니다.", "success");
      setModal(null); reload();
    } catch (e) { onNotice?.(`저장 실패: ${e.message}`, "error"); }
    setBusy(false);
  }

  async function doDelete(row) {
    setConfirmDel(null); setBusy(true);
    try {
      // soft-delete는 SECURITY DEFINER RPC로 (SELECT 정책 deleted_at IS NULL 충돌 회피)
      const { error } = await supabase.rpc("meeting_soft_delete", { p_id: row.id });
      if (error) throw error;
      onNotice?.("삭제(보관)되었습니다.", "success"); reload();
    } catch (e) { onNotice?.(`삭제 실패: ${e.message}`, "error"); }
    setBusy(false);
  }

  // KPI
  const kpi = useMemo(() => {
    const ws = weekStart();
    let thisWeek = 0, reviewing = 0, follow = 0, confirmed = 0, openTasks = 0;
    for (const m of list) {
      if (m.meeting_date && new Date(m.meeting_date) >= ws) thisWeek++;
      if (m.status === "reviewing") reviewing++;
      if (m.status === "follow_up") follow++;
      if (m.status === "confirmed") confirmed++;
      if (Array.isArray(m.action_items)) openTasks += m.action_items.filter(a => a && a.status !== "done").length;
    }
    return { thisWeek, reviewing, follow, confirmed, openTasks };
  }, [list]);

  // 필터 적용
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter(m => {
      if (fType && m.meeting_type !== fType) return false;
      if (fStatus && m.status !== fStatus) return false;
      if (needle) {
        const hay = [m.title, m.summary_text, m.minutes_text, (m.agenda || []).join(" "),
          (m.decisions || []).join(" "), m.related_project_name, m.meeting_type].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [list, q, fType, fStatus]);

  return (
    <MeetErrorBoundary>
    <section className="module-frame">
      <ErpHero
        title="회의록"
        meta={`전체 ${list.length}건 · 내부회의·프로젝트·거래처 미팅 기록`}
        tags={["업무 자산", "권한별 열람(RLS)", "전사=로컬 whisper"]}
        actions={<button onClick={reload}><RotateCcw size={14} /> 새로고침</button>}
      />

      <div className="px-1 py-4">
        {/* KPI */}
        <div className="dash-kpis" style={{ marginBottom: 14 }}>
          {[
            { icon: <Users size={18} />, v: kpi.thisWeek, l: "이번주 회의" },
            { icon: <ClipboardList size={18} />, v: kpi.reviewing, l: "검토중" },
            { icon: <CheckSquare size={18} />, v: kpi.openTasks, l: "미완료 할 일" },
            { icon: <AlertTriangle size={18} />, v: kpi.follow, l: "후속조치 필요" },
            { icon: <CheckSquare size={18} />, v: kpi.confirmed, l: "확정 회의록" },
          ].map((k, i) => (
            <div className="kpi-card" key={i}>
              <span className="kpi-icon">{k.icon}</span>
              <span className="kpi-body"><strong className="kpi-value">{k.v}</strong><span className="kpi-label">{k.l}</span></span>
            </div>
          ))}
        </div>

        {/* 툴바 */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button className="btn btn-primary" onClick={() => setModal({})}><Plus size={14} /> 새 회의록</button>
          <div className="flex items-center gap-1.5 rounded-md border px-2" style={{ borderColor: "#d9e3ee", background: "#fff" }}>
            <Search size={14} style={{ color: "#94a3b8" }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="회의명·안건·결정·요약 검색"
                   className="py-1.5 text-[13px] outline-none" style={{ width: 220 }} />
          </div>
          <select value={fType} onChange={e => setFType(e.target.value)} className="vc-input" style={{ width: "auto" }}>
            <option value="">유형 전체</option>
            {MEETING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="vc-input" style={{ width: "auto" }}>
            <option value="">상태 전체</option>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </div>

        {/* 목록 */}
        {loading ? <div className="dash-empty">불러오는 중…</div>
          : filtered.length === 0 ? (
            <div className="rounded-xl border bg-white p-6 text-center text-[13px]" style={{ borderColor: "#d9e3ee", color: "#94a3b8" }}>
              {list.length === 0 ? "아직 회의록이 없습니다. '새 회의록'으로 등록하세요." : "조건에 맞는 회의록이 없습니다."}
            </div>
          ) : (
            <div className="grid gap-2.5">
              {filtered.map(m => {
                const open = openId === m.id;
                const taskN = Array.isArray(m.action_items) ? m.action_items.length : 0;
                return (
                  <div key={m.id} className="rounded-xl border bg-white" style={{ borderColor: "#d9e3ee" }}>
                    <div className="p-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge map={STATUS} k={m.status} />
                          <Badge map={VIS} k={m.visibility} />
                          {m.visibility === "owner_only" && <Lock size={12} style={{ color: "#8a2f2f" }} />}
                          {m.meeting_type && <span className="badge muted">{m.meeting_type}</span>}
                          {taskN > 0 && <span className="badge blue">할 일 {taskN}</span>}
                          {m.follow_up_required && <span className="badge amber">후속필요</span>}
                        </div>
                        <div className="font-bold text-[14.5px]" style={{ color: "#142033" }}>{m.title}</div>
                        <div className="text-[11.5px] mt-1" style={{ color: "#94a3b8" }}>
                          {fmtDate(m.meeting_date)}{m.meeting_method ? ` · ${m.meeting_method}` : ""}{m.location ? ` · ${m.location}` : ""}
                          {m.related_project_name ? ` · ${m.related_project_name}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button className="icon-btn" title="상세" onClick={() => openDetail(m)}>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
                        <button className="icon-btn" title="수정" onClick={() => setModal(m)}><Pencil size={15} /></button>
                        <button className="icon-btn danger" title="삭제" onClick={() => setConfirmDel(m)} disabled={busy}><Trash2 size={15} /></button>
                      </div>
                    </div>
                    {open && (
                      <div className="px-4 pb-4 border-t pt-3" style={{ borderColor: "#eef3f8" }}>
                        {/* 탭 */}
                        <div className="flex gap-1 mb-3 flex-wrap">
                          {[["summary", "요약"], ["minutes", "회의록"], ["transcript", "전사 원문"], ["tasks", "할 일"], ["people", "참석자"]].map(([key, lbl]) => (
                            <button key={key} onClick={() => setTab(key)}
                                    className="px-3 py-1.5 text-[12px] font-semibold rounded-md"
                                    style={tab === key ? { background: "#1f3a5f", color: "#fff" } : { background: "#fff", color: "#56657a", border: "1px solid #d9e3ee" }}>
                              {lbl}
                            </button>
                          ))}
                        </div>
                        {tab === "summary" && (
                          <div className="space-y-3 text-[13px]">
                            {m.summary_text ? <div><div className="tlbl">핵심 요약</div><p className="whitespace-pre-wrap" style={{ color: "#334155" }}>{m.summary_text}</p></div>
                              : <p style={{ color: "#94a3b8" }}>AI 요약은 음성 전사·정리 단계(2차)에서 채워집니다.</p>}
                            {Array.isArray(m.decisions) && m.decisions.length > 0 && <div><div className="tlbl">결정사항</div><ul className="list-disc pl-5" style={{ color: "#334155" }}>{m.decisions.map((d, i) => <li key={i}>{typeof d === "string" ? d : d.decision}</li>)}</ul></div>}
                          </div>
                        )}
                        {tab === "minutes" && (
                          <div className="space-y-3 text-[13px]">
                            {Array.isArray(m.agenda) && m.agenda.length > 0 && <div><div className="tlbl">안건</div><ul className="list-disc pl-5" style={{ color: "#334155" }}>{m.agenda.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
                            <div><div className="tlbl">회의 내용</div><p className="whitespace-pre-wrap" style={{ color: "#334155" }}>{m.minutes_text || "—"}</p></div>
                          </div>
                        )}
                        {tab === "transcript" && (
                          <p className="text-[12.5px] whitespace-pre-wrap leading-relaxed" style={{ color: "#475467", maxHeight: 280, overflow: "auto" }}>
                            {m.transcript_text || "전사 원문은 음성 업로드·전사 단계(2차)에서 채워집니다."}
                          </p>
                        )}
                        {tab === "tasks" && (
                          Array.isArray(m.action_items) && m.action_items.length > 0
                            ? <ul className="space-y-1.5 text-[13px]">{m.action_items.map((a, i) => (
                                <li key={i} className="flex items-center gap-2"><CheckSquare size={13} style={{ color: "#245f9a" }} />
                                  <span style={{ color: "#334155" }}>{a.task}</span>
                                  {a.assignee_name && <span className="badge muted">{a.assignee_name}</span>}
                                  {a.due_date && <span className="badge amber">{a.due_date}</span>}</li>))}</ul>
                            : <p className="text-[13px]" style={{ color: "#94a3b8" }}>등록된 할 일이 없습니다.</p>
                        )}
                        {tab === "people" && (
                          (parts[m.id] || []).length > 0
                            ? <div className="flex flex-wrap gap-1.5">{(parts[m.id] || []).map((p, i) => (
                                <span key={i} className="badge muted">{p.display_name}{p.org_name ? ` · ${p.org_name}` : ""}</span>))}</div>
                            : <p className="text-[13px]" style={{ color: "#94a3b8" }}>참석자가 없습니다.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {modal && <MeetingModal init={modal} busy={busy} myName={myName}
                              participants={parts[modal.id] || []}
                              onClose={() => setModal(null)}
                              onSave={(form, inputType, file) => saveAny(form, modal.id ? modal : null, inputType, file)} />}

      {confirmDel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,.55)" }} onClick={() => setConfirmDel(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(420px,100%)", boxShadow: "0 18px 50px rgba(0,0,0,.3)" }}>
            <h3 style={{ margin: 0, color: "#1f3a5f", fontSize: 17, fontWeight: 800 }}>회의록을 삭제할까요?</h3>
            <p style={{ margin: "8px 0 0", color: "#56657a", fontSize: 13 }}>"{confirmDel.title}"을(를) 보관 처리합니다. 목록에서 사라집니다.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setConfirmDel(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d9e3ee", background: "#fff", color: "#56657a", fontWeight: 600, cursor: "pointer" }}>취소</button>
              <button onClick={() => doDelete(confirmDel)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #dc2626", background: "#dc2626", color: "#fff", fontWeight: 700, cursor: "pointer" }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </section>
    </MeetErrorBoundary>
  );
}

// ── 작성·수정 모달 (입력 3방식: 직접작성·음성파일·메모붙여넣기) ───────────
function MeetingModal({ init, busy, myName, participants, onClose, onSave }) {
  const editing = !!init?.id;
  const fileRef = useRef(null);
  const [inputType, setInputType] = useState(editing ? "manual" : "manual"); // manual | audio | paste
  const [file, setFile] = useState(null);
  const [f, setF] = useState({
    title: init.title || "",
    meeting_date: init.meeting_date ? String(init.meeting_date).slice(0, 16) : "",
    meeting_type: init.meeting_type || "",
    meeting_method: init.meeting_method || "",
    location: init.location || "",
    visibility: init.visibility || "participants",
    status: init.status || "draft",
    agenda: Array.isArray(init.agenda) ? init.agenda.join("\n") : "",
    minutes_text: init.minutes_text || "",
    decisions: Array.isArray(init.decisions) ? init.decisions.map(d => typeof d === "string" ? d : d.decision).join("\n") : "",
    action_items: Array.isArray(init.action_items) ? init.action_items.map(a => a.task).join("\n") : "",
    participants: (participants || []).map(p => p.email ? `${p.display_name}, ${p.email}` : p.display_name).join("\n"),
    paste_text: init.transcript_text || "",
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const isManual = editing || inputType === "manual";

  const TABS = [["manual", "직접작성", <PencilLine size={13} />], ["audio", "음성파일", <Mic size={13} />], ["paste", "메모 붙여넣기", <ClipboardPaste size={13} />]];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,.5)" }} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full overflow-hidden" style={{ maxWidth: 620, maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--mg-navy)", color: "#fff" }}>
          <h3 className="font-bold">{editing ? "회의록 수정" : "새 회의록"}</h3>
          <button onClick={onClose} className="hover:opacity-70"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-[13px] overflow-auto">
          {/* 입력 방식 탭 (신규만) */}
          {!editing && (
            <div className="flex gap-2">
              {TABS.map(([key, lbl, ic]) => (
                <button key={key} type="button" onClick={() => setInputType(key)}
                        className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md flex items-center justify-center gap-1.5"
                        style={inputType === key ? { background: "var(--mg-accent)", color: "#fff" } : { background: "#fff", color: "var(--mg-sub)", border: "1px solid var(--mg-line)" }}>
                  {ic} {lbl}
                </button>
              ))}
            </div>
          )}

          {/* 회의 기본 정보 (공통) */}
          <div><div className="mlbl">회의명 *</div><input value={f.title} onChange={e => set("title", e.target.value)} className="vc-input" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><div className="mlbl">일시</div><input type="datetime-local" value={f.meeting_date} onChange={e => set("meeting_date", e.target.value)} className="vc-input" /></div>
            <div><div className="mlbl">유형</div><select value={f.meeting_type} onChange={e => set("meeting_type", e.target.value)} className="vc-input"><option value="">선택</option>{MEETING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><div className="mlbl">방식</div><select value={f.meeting_method} onChange={e => set("meeting_method", e.target.value)} className="vc-input"><option value="">선택</option>{METHODS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><div className="mlbl">장소</div><input value={f.location} onChange={e => set("location", e.target.value)} className="vc-input" /></div>
            <div><div className="mlbl">공개 범위</div><select value={f.visibility} onChange={e => set("visibility", e.target.value)} className="vc-input">{Object.entries(VIS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
            {isManual && <div><div className="mlbl">상태</div><select value={f.status} onChange={e => set("status", e.target.value)} className="vc-input">{STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}</select></div>}
          </div>
          <div><div className="mlbl">참석자 <span style={{ color: "#94a3b8", fontWeight: 400 }}>(한 줄에 한 명: 이름, 이메일)</span></div>
            <textarea value={f.participants} onChange={e => set("participants", e.target.value)} rows={2} className="vc-input" placeholder={`김찬수, chanse7979@gmail.com\n최승표`} /></div>

          {/* 직접작성 */}
          {isManual && <>
            <div><div className="mlbl">안건 <span style={{ color: "#94a3b8", fontWeight: 400 }}>(한 줄에 하나)</span></div><textarea value={f.agenda} onChange={e => set("agenda", e.target.value)} rows={2} className="vc-input" /></div>
            <div><div className="mlbl">회의 내용</div><textarea value={f.minutes_text} onChange={e => set("minutes_text", e.target.value)} rows={4} className="vc-input" /></div>
            <div><div className="mlbl">결정사항 <span style={{ color: "#94a3b8", fontWeight: 400 }}>(한 줄에 하나)</span></div><textarea value={f.decisions} onChange={e => set("decisions", e.target.value)} rows={2} className="vc-input" /></div>
            <div><div className="mlbl">할 일 <span style={{ color: "#94a3b8", fontWeight: 400 }}>(한 줄에 하나)</span></div><textarea value={f.action_items} onChange={e => set("action_items", e.target.value)} rows={2} className="vc-input" /></div>
          </>}

          {/* 음성파일 */}
          {!editing && inputType === "audio" && <>
            <div><div className="mlbl">음성파일 *</div>
              <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} onChange={e => setFile(e.target.files?.[0] || null)} className="block w-full text-[13px]" />
              {file && <div className="text-[12px] mt-1" style={{ color: "var(--mg-sub)" }}><FileAudio size={12} className="inline" /> {file.name} · {(file.size / 1048576).toFixed(1)}MB</div>}
            </div>
            <div className="rounded-md p-2.5 flex items-start gap-2 text-[12px]" style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}>
              <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>전사는 회사 PC 안 로컬 whisper로만 처리되며 외부로 전송되지 않습니다. 요약(Hermes 구독)은 마스킹 후 진행됩니다. 등록하면 전사 대기열에 올라가고, 완료되면 자동으로 채워집니다.</span>
            </div>
          </>}

          {/* 메모 붙여넣기 */}
          {!editing && inputType === "paste" && <>
            <div><div className="mlbl">메모/회의록 원문 붙여넣기</div>
              <textarea value={f.paste_text} onChange={e => set("paste_text", e.target.value)} rows={7} className="vc-input" placeholder="카카오톡·이메일·수기 메모를 붙여넣으면 전사 원문으로 저장됩니다. AI 정리는 요약 단계에서 진행됩니다." /></div>
          </>}
        </div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t" style={{ borderColor: "var(--mg-line)", background: "#f8fbfd" }}>
          <button onClick={onClose} className="btn btn-ghost" disabled={busy}>취소</button>
          <button onClick={() => onSave(f, editing ? "manual" : inputType, file)} className="btn btn-primary" disabled={busy}>
            {busy ? "저장 중…" : editing ? "수정" : inputType === "audio" ? <><Upload size={14} /> 업로드</> : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
