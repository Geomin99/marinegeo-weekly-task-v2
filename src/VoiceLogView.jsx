import { useState, useRef, useEffect } from "react";
import { Mic, Upload, FileAudio, Trash2, RotateCcw, ChevronDown, ChevronUp, ShieldAlert, CalendarPlus } from "lucide-react";
import { supabase } from "./supabaseClient";
import { ErpHero } from "./ErpHero.jsx";
import { gcalReady, createAllDayEvent } from "./gcal";
import { StaffNoteButton } from "./QuickStaffNote.jsx";

// 업무 통화 로그 (geomin99 전용). 업로드 → 비공개 Storage(voice-calls) → voice_call_logs(pending).
// 전사(로컬 whisper 워커)·요약(토심이)은 후속 단계에서 status를 채운다.
const ACCEPT = ".m4a,.mp3,.wav,.webm,.mp4,.mpeg,.mpga,audio/*";
const STATUS = {
  uploaded:    { label: "업로드됨", cls: "muted" },
  pending:     { label: "전사 대기", cls: "amber" },
  processing:  { label: "전사중",   cls: "amber" },
  transcribed: { label: "전사완료", cls: "blue" },
  summarized:  { label: "요약완료", cls: "blue" },
  completed:   { label: "완료",     cls: "green" },
  failed:      { label: "오류",     cls: "red" },
};

function fmtDate(s) { return s ? String(s).slice(0, 16).replace("T", " ") : ""; }
function fmtSize(n) { return n ? (n / 1048576).toFixed(1) + "MB" : ""; }

// 통화녹음 파일명에서 날짜·시간·상대 자동 추출 (예: "통화 녹음 김현우 부사장님_260528_140059.m4a")
function parseFilename(name) {
  const out = {};
  const m = name.match(/(\d{2})(\d{2})(\d{2})[_\-.](\d{2})(\d{2})(\d{2})/);
  if (m) {
    const [, yy, mm, dd, hh, mi] = m;
    out.call_date = `20${yy}-${mm}-${dd}T${hh}:${mi}`; // datetime-local 형식
  }
  let base = name.replace(/\.[^.]+$/, "");              // 확장자 제거
  base = base.replace(/^\s*통화\s*녹음\s*/, "");          // "통화 녹음 " 접두 제거
  base = base.replace(/[_\-\s]*\d{6}[_\-.]\d{6}.*$/, "").trim(); // 날짜_시간 이후 제거
  if (base) { out.contact_person = base; out.title = `통화 - ${base}`; }
  return out;
}

export default function VoiceLogView({ logs, loading, onReload, onNotice, ownerId, session, viewer }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ title: "", organization_name: "", contact_person: "", phone_number: "", call_date: "" });
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [confirmRow, setConfirmRow] = useState(null);  // 삭제 확인 (브라우저 confirm 금지 — 회사 모달)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleUpload() {
    if (!file) { onNotice?.("음성파일을 선택하세요.", "error"); return; }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      // 저장 키는 ASCII 안전값(한글·공백 키는 Storage가 거부). 원본 파일명은 DB(original_filename)에 보존.
      const ext = (file.name.split(".").pop() || "dat").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "dat";
      const path = `${ownerId}/${id}/audio.${ext}`;
      const { error: upErr } = await supabase.storage.from("voice-calls")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) { onNotice?.(`업로드 실패: ${upErr.message}`, "error"); setBusy(false); return; }
      const { error } = await supabase.from("voice_call_logs").insert({
        id, owner_user_id: ownerId, created_by: "geomin99",
        title: form.title || file.name, organization_name: form.organization_name || null,
        contact_person: form.contact_person || null, phone_number: form.phone_number || null,
        call_date: form.call_date ? new Date(form.call_date).toISOString() : new Date().toISOString(),
        storage_path: path, original_filename: file.name, mime_type: file.type || null,
        size_bytes: file.size, status: "pending",
      });
      if (error) { onNotice?.(`기록 저장 실패: ${error.message}`, "error"); setBusy(false); return; }
      onNotice?.("업로드 완료 — 전사 대기열에 등록되었습니다.", "success");
      setFile(null); setForm({ title: "", organization_name: "", contact_person: "", phone_number: "", call_date: "" });
      if (fileRef.current) fileRef.current.value = "";
      onReload?.();
    } catch (e) { onNotice?.(`오류: ${e.message}`, "error"); }
    setBusy(false);
  }

  async function handleDelete(row) {
    setConfirmRow(null);
    setBusy(true);
    try {
      if (row.storage_path) await supabase.storage.from("voice-calls").remove([row.storage_path]);
      await supabase.from("voice_call_logs").update({ deleted_at: new Date().toISOString() }).eq("id", row.id);
      onNotice?.("삭제(보관)되었습니다.", "success");
      onReload?.();
    } catch (e) { onNotice?.(`삭제 실패: ${e.message}`, "error"); }
    setBusy(false);
  }

  async function addToCalendar(row) {
    if (!gcalReady()) { onNotice?.("구글 미연동 — 휴가·출장 탭에서 먼저 연동하세요.", "error"); return; }
    const dues = Array.isArray(row.due_dates) ? row.due_dates.filter((d) => d && d.date) : [];
    if (!dues.length) { onNotice?.("등록할 마감이 없습니다.", "info"); return; }
    setBusy(true);
    let ok = 0;
    for (const d of dues) {
      const res = await createAllDayEvent({
        summary: `[통화] ${d.label || row.title}`,
        description: `업무 통화 로그 · ${row.organization_name || ""} ${row.contact_person || ""}`.trim(),
        date: d.date,
      });
      if (res.ok) ok++;
    }
    setBusy(false);
    onNotice?.(ok ? `캘린더에 ${ok}건 추가했습니다.` : "캘린더 추가 실패", ok ? "success" : "error");
  }

  const list = (logs || []).filter((r) => !r.deleted_at);

  // 전사 진행 중(pending/processing) 건이 있으면 6초마다 자동 갱신 → 완료되면 화면 자동 반영
  useEffect(() => {
    const active = list.some((r) => r.status === "pending" || r.status === "processing");
    if (!active) return;
    const iv = setInterval(() => onReload?.(), 6000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs]);

  return (
    <section className="module-frame">
      <ErpHero
        title="업무 통화 로그"
        meta={`geomin99 전용 · 통화 ${list.length}건 · 전사=로컬 whisper · 요약=토심이`}
        tags={["개인 전용", "음성 비공개 보관", "외부전송 없음"]}
        actions={<button onClick={onReload}><RotateCcw size={14} /> 새로고침</button>}
      />

      <div className="px-1 py-4">
        {/* 안내 문구 */}
        <div className="rounded-lg p-3 mb-4 flex items-start gap-2 text-[12.5px]"
             style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}>
          <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>업무 기록 목적의 음성파일만 업로드하세요. 통화 녹음·전사는 회사 PC 안에서만 처리되며 외부로 전송되지 않습니다. 민감정보가 포함된 기록은 접근 권한·보존 기간을 확인하세요.</span>
        </div>

        {/* 업로드 카드 */}
        <div className="rounded-xl border bg-white p-4 mb-5" style={{ borderColor: "#d9e3ee" }}>
          <div className="text-[13px] font-bold mb-3 flex items-center gap-1.5" style={{ color: "#142033" }}>
            <Mic size={15} /> 통화 음성 업로드
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT}
                 onChange={(e) => {
                   const f = e.target.files?.[0] || null;
                   setFile(f);
                   if (f) {
                     const p = parseFilename(f.name);
                     setForm((cur) => ({
                       title: cur.title || p.title || "",
                       organization_name: cur.organization_name || "",
                       contact_person: cur.contact_person || p.contact_person || "",
                       phone_number: cur.phone_number || "",
                       call_date: cur.call_date || p.call_date || "",
                     }));
                   }
                 }}
                 className="block w-full text-[13px] mb-3" />
          {file && <div className="text-[12px] mb-3" style={{ color: "#475467" }}><FileAudio size={12} className="inline" /> {file.name} · {fmtSize(file.size)}</div>}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input placeholder="제목(통화 주제)" value={form.title} onChange={(e) => set("title", e.target.value)} className="vc-input" />
            <input placeholder="업체/기관명" value={form.organization_name} onChange={(e) => set("organization_name", e.target.value)} className="vc-input" />
            <input placeholder="담당자" value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} className="vc-input" />
            <input placeholder="전화번호" value={form.phone_number} onChange={(e) => set("phone_number", e.target.value)} className="vc-input" />
            <input type="datetime-local" value={form.call_date} onChange={(e) => set("call_date", e.target.value)} className="vc-input" />
          </div>
          <button className="btn btn-primary" onClick={handleUpload} disabled={busy || !file}>
            <Upload size={14} /> {busy ? "업로드 중…" : "업로드"}
          </button>
        </div>

        {/* 목록 */}
        <div className="text-[13px] font-bold mb-2" style={{ color: "#142033" }}>통화 기록 ({list.length})</div>
        {loading ? (
          <div className="dash-empty">불러오는 중…</div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border bg-white p-6 text-center text-[13px]" style={{ borderColor: "#d9e3ee", color: "#94a3b8" }}>
            아직 통화 기록이 없습니다. 위에서 음성파일을 업로드하세요.
          </div>
        ) : (
          <div className="grid gap-2.5">
            {list.map((r) => {
              const st = STATUS[r.status] || STATUS.uploaded;
              const open = openId === r.id;
              return (
                <div key={r.id} className="rounded-xl border bg-white" style={{ borderColor: "#d9e3ee" }}>
                  <div className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        {r.follow_up_required && <span className="badge amber">후속필요</span>}
                        {r.organization_name && <span className="badge muted">{r.organization_name}</span>}
                      </div>
                      <div className="font-bold text-[14.5px]" style={{ color: "#142033" }}>{r.title}</div>
                      <div className="text-[11.5px] mt-1" style={{ color: "#94a3b8" }}>
                        {r.contact_person && `${r.contact_person} · `}{r.phone_number && `${r.phone_number} · `}
                        통화 {fmtDate(r.call_date)} · {r.original_filename} {fmtSize(r.size_bytes)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button className="icon-btn" title="상세" onClick={() => setOpenId(open ? null : r.id)}>
                        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                      <StaffNoteButton session={session} viewer={viewer} onNotice={onNotice}
                                       related={{ module: "call_log", id: r.id }} defaultTitle={r.title} defaultType="통화" />
                      <button className="icon-btn danger" title="삭제" onClick={() => setConfirmRow(r)} disabled={busy}><Trash2 size={15} /></button>
                    </div>
                  </div>
                  {open && (
                    <div className="px-4 pb-4 border-t pt-3" style={{ borderColor: "#eef3f8" }}>
                      {r.status === "pending" || r.status === "processing" ? (
                        <p className="text-[12.5px]" style={{ color: "#94a3b8" }}>전사 대기/진행 중입니다 — 회사 PC 워커가 처리하면 전사·요약이 여기에 채워집니다.</p>
                      ) : (
                        <>
                          {Array.isArray(r.due_dates) && r.due_dates.length > 0 && (
                            <button className="btn btn-ghost" style={{ marginBottom: 10 }} onClick={() => addToCalendar(r)} disabled={busy}>
                              <CalendarPlus size={13} /> 마감을 캘린더에 추가 ({r.due_dates.length})
                            </button>
                          )}
                          {r.summary_text && (<div className="mb-3"><div className="text-[12px] font-bold mb-1" style={{ color: "#245f9a" }}>요약</div><p className="text-[13px] whitespace-pre-wrap" style={{ color: "#334155" }}>{r.summary_text}</p></div>)}
                          {r.transcript_text && (<div><div className="text-[12px] font-bold mb-1" style={{ color: "#245f9a" }}>전사 원문</div><p className="text-[12.5px] whitespace-pre-wrap leading-relaxed" style={{ color: "#475467", maxHeight: 260, overflow: "auto" }}>{r.transcript_text}</p></div>)}
                          {!r.summary_text && !r.transcript_text && <p className="text-[12.5px]" style={{ color: "#94a3b8" }}>전사 결과가 아직 없습니다.</p>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 삭제 확인 (브라우저 confirm 금지 — 회사 모달) */}
      {confirmRow && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,.55)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(420px,100%)", boxShadow: "0 18px 50px rgba(0,0,0,.3)" }}>
            <h3 style={{ margin: 0, color: "var(--mg-navy)", fontSize: 17, fontWeight: 800 }}>통화 기록을 삭제할까요?</h3>
            <p style={{ margin: "8px 0 0", color: "var(--mg-sub)", fontSize: 13 }}>"{confirmRow.title}" 항목을 보관 처리합니다. 목록에서 사라집니다.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setConfirmRow(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--mg-line)", background: "#fff", color: "var(--mg-sub)", fontWeight: 600, cursor: "pointer" }}>취소</button>
              <button onClick={() => handleDelete(confirmRow)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #dc2626", background: "#dc2626", color: "#fff", fontWeight: 700, cursor: "pointer" }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
