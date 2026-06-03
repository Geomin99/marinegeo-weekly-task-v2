// daily-reminder-summary — 일일 리마인드 요약 DTO 반환 (마스킹 완료)
// 보안: verify_jwt=false + x-reminder-secret 헤더를 app_config(service_role 전용)와 대조.
//       service_role 키는 Supabase에만 존재(자동 주입). 호출자는 마스킹된 요약만 수신.
// 설계: 포테토뭉(Codex) 정식 리뷰 v1. 받은편지함은 count만(제목·발신·본문 미포함).
import { createClient } from "jsr:@supabase/supabase-js@2";

const OWNER_UID = "c819d3f9-7476-4271-89db-254b7770529a"; // geomin99 (토뭉이님)
const EXPECTED_AUTHORS = ["여은민", "김찬수", "최승표"];

function kstToday(): Date {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function dday(due: string, today: Date): number {
  const d = new Date(due + "T00:00:00Z");
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

Deno.serve(async (req) => {
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 인증: 공유 시크릿 해시 대조 (DB엔 sha256 해시만 보관) ──
    const provided = req.headers.get("x-reminder-secret") || "";
    const providedHash = provided ? await sha256hex(provided) : "";
    const { data: cfg } = await sb.from("app_config").select("value").eq("key", "reminder_shared_secret").single();
    if (!cfg || !provided || providedHash !== cfg.value) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const today = kstToday();
    const todayStr = ymd(today);
    const weekStart = new Date(today); const wd = (today.getUTCDay() + 6) % 7; weekStart.setUTCDate(today.getUTCDate() - wd); // 월요일
    const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    const in7 = new Date(today); in7.setUTCDate(today.getUTCDate() + 7);

    // ── 센터 ──
    const { data: center } = await sb.from("center_tasks")
      .select("title, status, due_date").is("deleted_at", null);
    const cActive = (center || []).filter((t) => t.status !== "제출완료" && t.status !== "보관");
    const centerNeed = (center || []).filter((t) => t.status === "확인필요").length;
    const centerOverdue = cActive.filter((t) => t.due_date && dday(t.due_date, today) < 0).length;
    const centerDue7 = cActive.filter((t) => t.due_date && dday(t.due_date, today) >= 0 && dday(t.due_date, today) <= 7);
    const centerDueItems = centerDue7
      .map((t) => ({ title: t.title, dday: dday(t.due_date, today) }))
      .sort((a, b) => a.dday - b.dday).slice(0, 3);

    // ── 받은편지함(owner) — count만 ──
    const { data: inbox } = await sb.from("inbox_action_drafts")
      .select("status").eq("owner_user_id", OWNER_UID).is("deleted_at", null);
    const inboxNeed = (inbox || []).filter((d) => d.status === "needs_review").length;

    // ── 주간업무 — 이번주 제출 인원 ──
    const { data: journals } = await sb.from("journal_entries").select("author, this_week_date");
    const submittedAuthors = new Set(
      (journals || []).filter((j) => j.this_week_date && j.this_week_date >= ymd(weekStart) && j.this_week_date <= ymd(weekEnd)).map((j) => j.author),
    );
    const missingAuthors = EXPECTED_AUTHORS.filter((a) => !submittedAuthors.has(a));

    // ── 휴가·출장 — 오늘/이번주 부재 ──
    const { data: leaves } = await sb.from("leave_requests")
      .select("author, status, start_date, end_date");
    const activeLeaves = (leaves || []).filter((r) => r.status !== "rejected" && r.status !== "cancelled");
    const overlaps = (r: any, a: string, b: string) => (r.start_date || "") <= b && (r.end_date || r.start_date || "") >= a;
    const todayAbsent = [...new Set(activeLeaves.filter((r) => overlaps(r, todayStr, todayStr)).map((r) => r.author))];
    const weekAbsent = [...new Set(activeLeaves.filter((r) => overlaps(r, ymd(weekStart), ymd(weekEnd))).map((r) => r.author))];

    // ── 업무 메모(staff_notes) — 후속조치일 도래/지남 (대표 본인 리마인드) ──
    const { data: notes } = await sb.from("staff_notes")
      .select("title, employee_name, follow_up_date, status")
      .is("deleted_at", null)
      .in("status", ["open", "in_progress"])
      .not("follow_up_date", "is", null)
      .lte("follow_up_date", todayStr);
    const dueNotes = (notes || []).slice().sort((a, b) => (a.follow_up_date || "").localeCompare(b.follow_up_date || ""));
    const notesDueToday = dueNotes.filter((n) => n.follow_up_date === todayStr).length;
    const notesOverdue = dueNotes.filter((n) => n.follow_up_date < todayStr).length;
    const noteItems = dueNotes.slice(0, 2).map((n) => ({
      title: n.title || "(제목 없음)",
      employee: n.employee_name || "",
      dday: dday(n.follow_up_date, today),
    }));

    const summary = {
      date: todayStr,
      center: { needCheck: centerNeed, overdue: centerOverdue, due7: centerDue7.length, dueItems: centerDueItems },
      inbox: { needReview: inboxNeed },
      journal: { submitted: submittedAuthors.size, expected: EXPECTED_AUTHORS.length, missing: missingAuthors },
      leave: { todayAbsent, weekAbsentCount: weekAbsent.length },
      staffNotes: { dueToday: notesDueToday, overdue: notesOverdue, items: noteItems },
    };
    return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
