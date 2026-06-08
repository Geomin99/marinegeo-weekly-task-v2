// 직원 메모 공통 상수·헬퍼 (StaffNotesView + 연결 버튼 + 대시보드 위젯 공용)
import { supabase } from "./supabaseClient";

// 사람 직원만 (공용계정 marinegeo99 제외)
export const STAFF = [
  { email: "geomin99@gmail.com", name: "여은민" },
  { email: "chanse7979@gmail.com", name: "김찬수" },
  { email: "pyoring94@gmail.com", name: "최승표" },
];
export const nameForEmail = (e) => STAFF.find((s) => s.email === (e || "").toLowerCase())?.name || e;
export const emailForName = (n) => STAFF.find((s) => s.name === n)?.email || null;

// memo_type = '왜 적었는지'만 담당. 출처(회의/통화/센터)는 related_module로 분리 (2026-06-04 포테토뭉 정리).
export const MEMO_TYPES = ["일반", "업무지시", "확인필요", "후속조치", "칭찬성과", "주의리스크", "개인일정"];

export const TYPE_COLORS = {
  "일반": { bg: "#e5e7eb", fg: "#374151" }, "업무지시": { bg: "#dbeafe", fg: "#1e4f8f" },
  "확인필요": { bg: "#fff1c7", fg: "#6b4a00" }, "후속조치": { bg: "#e6e3f8", fg: "#4f4a91" },
  "칭찬성과": { bg: "#d9f0e3", fg: "#1f5c3b" }, "주의리스크": { bg: "#fde2e2", fg: "#8a2f2f" },
  "개인일정": { bg: "#e0f2fe", fg: "#075985" },
  // 레거시 호환(과거 메모가 가진 값) — 드롭다운엔 없지만 배지 색은 유지
  "회의": { bg: "#ede9fe", fg: "#5b21b6" }, "통화": { bg: "#ffedd5", fg: "#9a3412" }, "센터": { bg: "#e6e3f8", fg: "#4f4a91" },
};
export const PRIORITIES = ["낮음", "보통", "높음", "긴급"];
export const PRIORITY_COLORS = {
  "낮음": { bg: "#eef2f7", fg: "#64748b" }, "보통": { bg: "#e5e7eb", fg: "#374151" },
  "높음": { bg: "#fff1c7", fg: "#6b4a00" }, "긴급": { bg: "#fde2e2", fg: "#b4234b" },
};
export const STATUSES = [
  { v: "open", label: "접수" }, { v: "in_progress", label: "진행중" },
  { v: "done", label: "완료" }, { v: "archived", label: "보관" },
];
export const STATUS_COLORS = {
  open: { bg: "#e5e7eb", fg: "#374151" }, in_progress: { bg: "#fff1c7", fg: "#6b4a00" },
  done: { bg: "#d9f0e3", fg: "#16633a" }, archived: { bg: "#dfe7f3", fg: "#1f3a5f" },
};
export const statusLabel = (v) => STATUSES.find((s) => s.v === v)?.label || v;
export const VISIBILITIES = [
  { v: "private", label: "비공개(관리자)" }, { v: "employee", label: "직원 공유" },
  { v: "team", label: "팀 공유" }, { v: "admin", label: "관리자만" },
];
export const visLabel = (v) => VISIBILITIES.find((x) => x.v === v)?.label || v;
export const MODULE_LABEL = {
  weekly_task: "주간업무", marine_center: "해양벤처진흥센터", vacation: "휴가·출장",
  call_log: "업무 통화 로그", meeting: "회의록", project: "프로젝트",
  inbox: "받은편지함", journal: "주간업무",
};
// 받은편지함 draft priority(urgent/high/normal/low) → 메모 중요도
export const PRIORITY_FROM_DRAFT = { urgent: "긴급", high: "높음", normal: "보통", low: "낮음" };

// owner가 '직원 메모로 저장' 시 공통 INSERT (author_email은 RLS와 일치해야 함)
// 2026-06-08 0020 마이그레이션 RPC: 담당자(본인)가 메모 응답·상태 갱신
// 허용 status: open / in_progress / done. 다른 컬럼은 RPC 내부에서 봉쇄.
export async function respondToStaffNote(session, { id, status, responseText }) {
  if (!id) throw new Error("id 없음");
  if (!["open", "in_progress", "done"].includes(status)) throw new Error("status 잘못됨");
  const { data, error } = await supabase.rpc("staff_note_respond", {
    p_id: id,
    p_status: status,
    p_response_text: responseText ?? "",
  });
  if (error) throw error;
  return data;
}

export async function createStaffNote(session, payload) {
  const email = (session?.user?.email || "").toLowerCase();
  return supabase.from("staff_notes").insert({
    employee_id: (payload.employee_id || "").toLowerCase(),
    employee_name: payload.employee_name || nameForEmail(payload.employee_id),
    author_email: email,
    author_name: payload.author_name || null,
    memo_type: payload.memo_type || "일반",
    title: payload.title || null,
    content: payload.content,
    related_module: payload.related_module || null,
    related_id: payload.related_id != null ? String(payload.related_id) : null,
    priority: payload.priority || "보통",
    status: payload.status || "open",
    follow_up_date: payload.follow_up_date || null,
    visibility: payload.visibility || "private",
  });
}
