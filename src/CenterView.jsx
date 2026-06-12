import { useCallback, useMemo, useState } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Filter,
  FolderOpen,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { gcalReady, createAllDayEvent, CENTER_EVENT_COLOR_ID } from "./gcal";
import { ErpHero } from "./ErpHero.jsx";
import { StaffNoteButton } from "./QuickStaffNote.jsx";

// ── 표준 분류·상태·우선순위 (포테토뭉 합의 6/5/3종) ──
const CATEGORIES = ["공공요금", "제출업무", "지원사업", "교육·시설", "입주·계약"];
const STATUSES = ["신규", "확인필요", "자료준비", "승인대기", "제출완료", "보관"];
const PRIORITIES = ["높음", "보통", "낮음"];

const STATUS_BADGE = {
  신규: "blue",
  확인필요: "amber",
  자료준비: "blue",
  승인대기: "amber",
  제출완료: "green",
  보관: "muted",
};
const PRIORITY_BADGE = { 높음: "red", 보통: "muted", 낮음: "muted" };

// ── 개인정보 입력 가드 (실수 방지 1차 장치 — 보안 장치 아님) ──
const RRN_RE = /\d{6}-?\d{7}/;          // 주민등록번호 패턴
const LONG_DIGITS_RE = /\d{11,}/;        // 계좌·연락처류 11자리+ 연속 숫자 (구분자 제거 후)
const FILE_EXT_RE = /\.(pdf|xlsx?|hwpx?|docx?|pptx?|zip|jpe?g|png|csv|txt|seg?y)$/i; // 파일명(확장자)

function piiViolation(task) {
  const fields = [
    ["제목", task.title],
    ["메모", task.note],
    ["W경로", task.w_path],
    ["보낸이", task.sender],
    ["담당자", task.assignee],
  ];
  for (const [label, val] of fields) {
    if (val && RRN_RE.test(val)) return `${label}에 주민등록번호로 보이는 값이 있습니다. 개인정보는 저장할 수 없습니다.`;
    if (val && LONG_DIGITS_RE.test(val.replace(/[-\s]/g, ""))) {
      return `${label}에 계좌·연락처로 보이는 숫자열이 있습니다. 개인정보·금융정보는 저장할 수 없습니다.`;
    }
  }
  // w_path 는 폴더 경로까지만 — 파일명(확장자) 차단
  if (task.w_path && FILE_EXT_RE.test(task.w_path.trim())) {
    return "W드라이브 경로는 폴더까지만 입력해주세요. 파일명(확장자)은 저장할 수 없습니다.";
  }
  return null;
}

const EMPTY_FORM = {
  title: "",
  sender: "",
  category: "제출업무",
  status: "신규",
  priority: "보통",
  received_date: "",
  due_date: "",
  fiscal_year: String(new Date().getFullYear()),
  is_recurring: false,
  assignee: "",
  w_path: "",
  gmail_message_id: "",
  submitted: false,
  note: "",
};

function toForm(row) {
  return {
    title: row.title || "",
    sender: row.sender || "",
    category: row.category || "제출업무",
    status: row.status || "신규",
    priority: row.priority || "보통",
    received_date: row.received_date || "",
    due_date: row.due_date || "",
    fiscal_year: row.fiscal_year != null ? String(row.fiscal_year) : "",
    is_recurring: !!row.is_recurring,
    assignee: row.assignee || "",
    w_path: row.w_path || "",
    gmail_message_id: row.gmail_message_id || "",
    submitted: !!row.submitted,
    note: row.note || "",
  };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.round((due - today) / 86400000);
}

export default function CenterView({ tasks = [], loading = false, onReload, onNotice, session, viewer }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("전체");
  const [statusFilter, setStatusFilter] = useState("전체");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = 신규
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmTask, setConfirmTask] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [completeTarget, setCompleteTarget] = useState(null);
  const [completeDate, setCompleteDate] = useState("");
  const [addCal, setAddCal] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const notify = useCallback((m, t = "info") => onNotice?.(m, t), [onNotice]);

  // scan_requests 폴링 — done/failed 까지 대기 (워커 1분 폴링이라 최대 90초)
  const pollScanRequest = useCallback(async (id, timeoutMs = 90000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { data, error } = await supabase
        .from("scan_requests")
        .select("id, status, center_created_count, error_message")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (data && (data.status === "done" || data.status === "failed")) return data;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return { id, status: "timeout", center_created_count: 0, error_message: null };
  }, []);

  // 단순 새로고침 = fetchCenter (저장·삭제·완료 처리 후 호출)
  // 2026-06-12 회귀 fix: reload 의미를 단순 SELECT로 복원. Gmail 분석은 refreshAndScan에 분리.
  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await onReload?.();
    } finally {
      setRefreshing(false);
    }
  }, [onReload]);

  // Toolbar 새로고침 버튼 전용 = scan_requests 트리거 + 폴링 + fetchCenter
  const refreshAndScan = useCallback(async () => {
    if (scanning) return;
    const ownerId = session?.user?.id;
    if (!ownerId) {
      notify("로그인 정보가 없어 새로고침할 수 없습니다.", "error");
      return;
    }
    setScanning(true);
    setRefreshing(true);
    try {
      // 1. scan_requests insert (scope='center', unique 충돌 시 기존 active 요청 재사용)
      let requestId;
      const ins = await supabase
        .from("scan_requests")
        .insert({ owner: ownerId, scope: "center", requested_by: ownerId })
        .select("id")
        .maybeSingle();
      if (ins.error) {
        if (ins.error.code === "23505") {
          const { data: active, error: actErr } = await supabase
            .from("scan_requests")
            .select("id")
            .eq("owner", ownerId)
            .in("status", ["pending", "running"])
            .order("requested_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (actErr) throw actErr;
          requestId = active?.id;
          if (!requestId) throw new Error("진행 중인 요청을 찾지 못했습니다.");
        } else {
          throw ins.error;
        }
      } else {
        requestId = ins.data?.id;
      }
      notify("Gmail에서 새 센터 메일을 가져오는 중입니다.", "info");
      const result = await pollScanRequest(requestId);
      await onReload?.();
      if (result.status === "failed") {
        notify(`Gmail 분석 실패: ${result.error_message || "원인 미상"}`, "error");
      } else if (result.status === "timeout") {
        notify("워커 처리가 지연되고 있습니다. 잠시 뒤 새로고침을 다시 눌러주세요.", "info");
      } else if ((result.center_created_count || 0) === 0) {
        notify("새 메일은 없습니다. 화면을 갱신했습니다.", "info");
      } else {
        notify(`Gmail에서 ${result.center_created_count}건이 새로 추가됐습니다.`, "success");
      }
    } catch (e) {
      notify(`새로고침 실패: ${e.message || e}`, "error");
    } finally {
      setScanning(false);
      setRefreshing(false);
    }
  }, [scanning, session, notify, onReload, pollScanRequest]);

  const counters = useMemo(() => {
    let dueSoon = 0, needCheck = 0, done = 0;
    for (const t of tasks) {
      if (t.status === "확인필요") needCheck += 1;
      if (t.status === "제출완료") done += 1;
      const d = daysUntil(t.due_date);
      if (d != null && d <= 7 && t.status !== "제출완료" && t.status !== "보관") dueSoon += 1;
    }
    return { dueSoon, needCheck, done };
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (categoryFilter !== "전체" && t.category !== categoryFilter) return false;
      if (statusFilter !== "전체" && t.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${t.title} ${t.sender} ${t.assignee} ${t.note} ${t.w_path}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, search, categoryFilter, statusFilter]);

  const activeTasks = useMemo(
    () => filtered.filter((t) => t.status !== "제출완료" && t.status !== "보관"),
    [filtered],
  );
  const doneTasks = useMemo(
    () => filtered.filter((t) => t.status === "제출완료" || t.status === "보관"),
    [filtered],
  );

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }
  function openEdit(row) {
    setEditingId(row.id);
    setForm(toForm(row));
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) { notify("업무명(제목)을 입력해주세요.", "error"); return; }
    const violation = piiViolation(form);
    if (violation) { notify(violation, "error"); return; }

    setSaving(true);
    // 감사성 시각 보존: 이미 찍힌 제출/완료 시각은 단순 수정 시 덮어쓰지 않음
    const original = editingId == null ? null : tasks.find((t) => t.id === editingId);
    const now = new Date().toISOString();
    const payload = {
      title: form.title.trim(),
      sender: form.sender.trim() || null,
      category: form.category,
      status: form.status,
      priority: form.priority,
      received_date: form.received_date || null,
      due_date: form.due_date || null,
      fiscal_year: form.fiscal_year ? Number(form.fiscal_year) : null,
      is_recurring: form.is_recurring,
      assignee: form.assignee.trim() || null,
      w_path: form.w_path.trim() || null,
      gmail_message_id: form.gmail_message_id.trim() || null,
      submitted: form.submitted,
      submitted_at: form.submitted ? (original?.submitted_at || now) : null,
      completed_at: form.status === "제출완료" ? (original?.completed_at || now) : null,
      note: form.note.trim() || null,
    };

    let error;
    if (editingId == null) {
      ({ error } = await supabase.from("center_tasks").insert([payload]));
    } else {
      ({ error } = await supabase.from("center_tasks").update(payload).eq("id", editingId));
    }
    setSaving(false);
    if (error) { notify(`저장 실패: ${error.message}`, "error"); return; }
    setModalOpen(false);
    notify(editingId == null ? "업무가 등록되었습니다." : "업무가 수정되었습니다.", "success");
    reload();
  }

  async function doSoftDelete() {
    const row = confirmTask;
    setConfirmTask(null);
    if (!row) return;
    // soft-delete는 SECURITY DEFINER RPC로 (SELECT 정책 deleted_at IS NULL과의 충돌 회피)
    const { error } = await supabase.rpc("center_task_soft_delete", { p_id: row.id });
    if (error) { notify(`삭제 실패: ${error.message}`, "error"); return; }
    notify("보관 처리(삭제)되었습니다.", "success");
    reload();
  }

  async function setStatus(row, status, submitted) {
    const now = new Date().toISOString();
    const patch = {
      status,
      submitted,
      submitted_at: submitted ? (row.submitted_at || now) : null,
      completed_at: status === "제출완료" ? (row.completed_at || now) : null,
    };
    const { error } = await supabase.from("center_tasks").update(patch).eq("id", row.id);
    if (error) { notify(`상태 변경 실패: ${error.message}`, "error"); return; }
    notify(status === "제출완료" ? "완료 처리했습니다." : "진행 상태로 되돌렸습니다.", "success");
    reload();
  }
  const markUndone = (row) => setStatus(row, "확인필요", false);

  function todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function openComplete(row) {
    setCompleteTarget(row);
    setCompleteDate(todayYmd());
    setAddCal(false);
    setCompleting(false);
  }
  async function doComplete(withCalendar) {
    const row = completeTarget;
    if (!row) return;
    setCompleting(true);
    const completedIso = new Date(completeDate + "T00:00:00").toISOString();
    const patch = {
      status: "제출완료",
      submitted: true,
      submitted_at: row.submitted_at || new Date().toISOString(),
      completed_at: completedIso,
    };
    let calNote = "";
    // 헌법: 자동 생성 금지 — withCalendar(사용자 명시 동의)일 때만, 그리고 중복 방지
    if (withCalendar && !row.google_calendar_event_id) {
      const res = await createAllDayEvent({
        summary: `[센터완료] ${row.title}`,
        description: `해양벤처진흥센터 업무 완료 기록\n분류: ${row.category}${row.assignee ? ` · 담당: ${row.assignee}` : ""}`,
        date: completeDate,
        colorId: CENTER_EVENT_COLOR_ID,
      });
      if (res.ok) {
        patch.google_calendar_event_id = res.eventId;
        patch.calendar_created_at = new Date().toISOString();
        calNote = " · 캘린더 추가됨";
      } else if (res.reason === "no_token" || res.reason === "no_calendar") {
        calNote = " · 캘린더 미연동(휴가·출장 탭에서 구글 연동 먼저)";
      } else {
        calNote = ` · 캘린더 실패(${res.reason})`;
      }
    }
    const { error } = await supabase.from("center_tasks").update(patch).eq("id", row.id);
    setCompleting(false);
    setCompleteTarget(null);
    if (error) { notify(`완료 처리 실패: ${error.message}`, "error"); return; }
    const failed = calNote.includes("실패") || calNote.includes("미연동");
    notify(`완료 처리했습니다${calNote}.`, failed ? "info" : "success");
    reload();
  }

  async function copyPath(path) {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      notify("W드라이브 경로를 복사했습니다.", "success");
    } catch {
      notify("복사에 실패했습니다. 경로를 직접 선택해주세요.", "error");
    }
  }

  function gmailUrl(id) {
    return id ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}` : null;
  }

  function renderTask(t, done) {
    const d = daysUntil(t.due_date);
    const overdue = d != null && d < 0 && t.status !== "제출완료" && t.status !== "보관";
    const soon = d != null && d >= 0 && d <= 7 && t.status !== "제출완료" && t.status !== "보관";
    const strip = t.status === "제출완료" ? "green" : t.status === "보관" ? "muted" : overdue ? "red" : soon ? "amber" : "blue";
    return (
      <section className={`panel center-task strip-${strip}${done ? " is-done" : ""}`} key={t.id}>
        <div className="center-task-main">
          <div className="center-task-head">
            <span className={`badge ${STATUS_BADGE[t.status] || "muted"}`}>{t.status}</span>
            <span className="badge muted">{t.category}</span>
            {t.priority === "높음" && !done && <span className="badge red">높음</span>}
            {t.is_recurring && <span className="badge muted">반복</span>}
            {t.submitted && <span className="badge green">제출/회신</span>}
            {t.due_date && (overdue || soon) && (
              <span className={`badge ${overdue ? "red" : "amber"}`}>{overdue ? `마감 ${-d}일 지남` : `마감 D-${d}`}</span>
            )}
          </div>
          <h3 className="center-task-title" onClick={() => openEdit(t)}>{t.title}</h3>
          <div className="center-task-meta">
            {t.sender && <span>보낸이 {t.sender}</span>}
            {t.assignee && <span>담당 {t.assignee}</span>}
            {t.received_date && <span>수신 {t.received_date}</span>}
            {t.due_date && <span>마감 {t.due_date}</span>}
            {t.fiscal_year && <span>{t.fiscal_year}년</span>}
          </div>
          {t.note && <p className="center-task-note">{t.note}</p>}
        </div>
        <div className="center-task-actions">
          {done ? (
            <button className="icon-btn" title="진행으로 되돌리기" onClick={() => markUndone(t)}><RotateCcw size={15} /></button>
          ) : (
            <button className="icon-btn done" title="완료 처리" onClick={() => openComplete(t)}><CheckCircle2 size={16} /></button>
          )}
          {t.w_path && (
            <button className="icon-btn" title="W드라이브 경로 복사" onClick={() => copyPath(t.w_path)}>
              <FolderOpen size={15} /><Copy size={13} />
            </button>
          )}
          {t.gmail_message_id && (
            <a className="icon-btn" title="Gmail에서 열기" href={gmailUrl(t.gmail_message_id)} target="_blank" rel="noreferrer">
              <Mail size={15} />
            </a>
          )}
          <StaffNoteButton session={session} viewer={viewer} onNotice={onNotice}
                           related={{ module: "marine_center", id: t.id }} defaultTitle={t.title} defaultType="센터" />
          <button className="icon-btn" title="수정" onClick={() => openEdit(t)}><Save size={15} /></button>
          <button className="icon-btn danger" title="삭제(보관)" onClick={() => setConfirmTask(t)}><Trash2 size={15} /></button>
        </div>
      </section>
    );
  }

  return (
    <div className="journal-layout">
      <ErpHero
        title="해양벤처진흥센터"
        meta={`센터 행정 업무판 · 진행 ${activeTasks.length}건 · 완료·종료 ${doneTasks.length}건`}
        tags={[
          "수동 업무판",
          ...(counters.dueSoon > 0 ? [{ label: `마감 임박 ${counters.dueSoon}`, hot: true }] : []),
          ...(scanning ? [{ label: "Gmail 분석 중", hot: true }] : []),
        ]}
        actions={(
          <>
            <button onClick={() => refreshAndScan()} disabled={refreshing || scanning}><RefreshCw size={14} className={refreshing ? "erp-spin" : ""} /> {scanning ? "Gmail 분석 중…" : (refreshing ? "새로고침 중…" : "새로고침")}</button>
            <button onClick={openNew}><Plus size={14} /> 새 업무</button>
          </>
        )}
      />
      {/* 카운터 — 미니 KPI */}
      <div className="center-kpis">
        <div className="center-kpi tone-red">
          <span className="kpi-accent" />
          <span className="kpi-icon"><Clock3 size={16} /></span>
          <span className="kpi-body"><strong className="kpi-value">{counters.dueSoon}</strong><span className="kpi-label">마감 임박</span></span>
        </div>
        <div className="center-kpi tone-amber">
          <span className="kpi-accent" />
          <span className="kpi-icon"><AlertCircle size={16} /></span>
          <span className="kpi-body"><strong className="kpi-value">{counters.needCheck}</strong><span className="kpi-label">확인 필요</span></span>
        </div>
        <div className="center-kpi tone-mint">
          <span className="kpi-accent" />
          <span className="kpi-icon"><CheckCircle2 size={16} /></span>
          <span className="kpi-body"><strong className="kpi-value">{counters.done}</strong><span className="kpi-label">제출 완료</span></span>
        </div>
      </div>

      {/* 툴바 */}
      <div className="toolbar panel">
        <div className="search-box">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="업무명, 보낸이, 담당자, 메모 검색"
          />
          {search && <button onClick={() => setSearch("")} aria-label="검색어 지우기"><X size={15} /></button>}
        </div>
        <div className="select-filter">
          <Filter size={15} />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="전체">전체 분류</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="select-filter">
          <Filter size={15} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="전체">전체 상태</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn btn-ghost" onClick={() => refreshAndScan()} disabled={refreshing || scanning}>
          <RefreshCw size={15} className={refreshing ? "erp-spin" : ""} /> {scanning ? "Gmail 분석 중…" : (refreshing ? "새로고침 중…" : "새로고침")}
        </button>
        <button className="btn btn-primary" onClick={openNew}>
          <Plus size={16} /> 새 업무
        </button>
      </div>

      <div className="result-line">
        {loading ? "데이터를 불러오는 중입니다." : `진행 ${activeTasks.length}건 · 완료·종료 ${doneTasks.length}건`}
      </div>

      {loading && (
        <div className="empty-state panel">
          <Loader2 size={18} className="spin" />
          <p>센터 업무를 불러오는 중입니다.</p>
        </div>
      )}

      {!loading && (
        <>
          {activeTasks.length > 0 ? (
            <div className="center-task-list">
              {activeTasks.map((t) => renderTask(t, false))}
            </div>
          ) : (
            <div className="empty-state panel">
              <Archive size={22} />
              <h3>진행 중인 센터 업무가 없습니다.</h3>
              <p>새 업무를 등록하거나 필터를 조정해보세요.</p>
            </div>
          )}

          {doneTasks.length > 0 && (
            <div className="center-done">
              <button className="center-done-toggle" onClick={() => setShowDone((v) => !v)}>
                {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                완료 · 종료된 업무 ({doneTasks.length})
              </button>
              {showDone && (
                <div className="center-task-list">
                  {doneTasks.map((t) => renderTask(t, true))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 등록/수정 모달 */}
      {modalOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="center-modal panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="center-modal-head">
              <h3>{editingId == null ? "센터 업무 등록" : "센터 업무 수정"}</h3>
              <button className="icon-btn" onClick={() => !saving && setModalOpen(false)} aria-label="닫기"><X size={16} /></button>
            </div>

            <div className="center-form">
              <label className="full">
                <span>업무명 / 메일 제목 *</span>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 2026년 입주기업 실태조사 제출 요청" />
              </label>
              <label>
                <span>보낸 사람 / 기관</span>
                <input value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} placeholder="예: 해양벤처진흥센터" />
              </label>
              <label>
                <span>담당자</span>
                <input value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} />
              </label>
              <label>
                <span>분류</span>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>
                <span>상태</span>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>
                <span>우선순위</span>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label>
                <span>회계연도</span>
                <input type="number" value={form.fiscal_year} onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })} />
              </label>
              <label>
                <span>수신일</span>
                <input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} />
              </label>
              <label>
                <span>마감일</span>
                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </label>
              <label className="full">
                <span>W드라이브 폴더 경로 <em>(폴더까지만 · 파일명 제외)</em></span>
                <input value={form.w_path} onChange={(e) => setForm({ ...form, w_path: e.target.value })} placeholder="W:\\2. 해양벤처진흥센터\\14. 2021년 입주기업실태조사" />
              </label>
              <label className="full">
                <span>Gmail 메시지 ID <em>(선택)</em></span>
                <input value={form.gmail_message_id} onChange={(e) => setForm({ ...form, gmail_message_id: e.target.value })} placeholder="예: 18f0a1b2c3d4e5f6" />
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })} />
                <span>연단위 반복 업무</span>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={form.submitted} onChange={(e) => setForm({ ...form, submitted: e.target.checked })} />
                <span>외부 제출/회신 완료</span>
              </label>
              <label className="full">
                <span>메모 <em>(개인정보·주민번호·계좌 입력 금지)</em></span>
                <textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
            </div>

            <div className="center-modal-actions">
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)} disabled={saving}>취소</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 (회사 confirm 모달 — 브라우저 confirm 미사용) */}
      {confirmTask && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon"><AlertCircle size={20} /></div>
            <div>
              <h3>이 업무를 삭제할까요?</h3>
              <p>“{confirmTask.title}” 항목이 목록에서 제거됩니다. 데이터는 즉시 영구삭제되지 않고 보관 처리됩니다.</p>
            </div>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmTask(null)}>취소</button>
              <button className="btn btn-danger" onClick={doSoftDelete}>삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* 완료 처리 모달 (완료일 선택 + 구글캘린더 opt-in) */}
      {completeTarget && (
        <div className="modal-backdrop" role="presentation">
          <div className="center-complete panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="center-modal-head">
              <h3><CheckCircle2 size={17} /> 완료 처리</h3>
              <button className="icon-btn" onClick={() => !completing && setCompleteTarget(null)} aria-label="닫기"><X size={16} /></button>
            </div>
            <div className="center-complete-body">
              <p className="cc-title">{completeTarget.title}</p>
              <label className="cc-field">
                <span>완료일</span>
                <input type="date" value={completeDate} onChange={(e) => setCompleteDate(e.target.value)} />
              </label>
              {completeTarget.google_calendar_event_id ? (
                <p className="cc-note">이미 구글 캘린더에 추가된 업무입니다.</p>
              ) : (
                <>
                  <label className="cc-check">
                    <input type="checkbox" checked={addCal} onChange={(e) => setAddCal(e.target.checked)} />
                    <span>구글 캘린더(MGEO)에 완료일 추가</span>
                  </label>
                  {addCal && !gcalReady() && (
                    <p className="cc-warn">구글 캘린더 미연동 — 「휴가·출장」 탭에서 구글 연동을 먼저 해야 추가됩니다. (연동 안 돼도 완료 처리는 됩니다)</p>
                  )}
                </>
              )}
            </div>
            <div className="center-modal-actions">
              <button className="btn btn-ghost" onClick={() => setCompleteTarget(null)} disabled={completing}>취소</button>
              <button className="btn btn-primary" onClick={() => doComplete(addCal && !completeTarget.google_calendar_event_id)} disabled={completing}>
                {completing ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                {addCal && !completeTarget.google_calendar_event_id ? " 완료 + 캘린더 추가" : " 완료만 처리"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
