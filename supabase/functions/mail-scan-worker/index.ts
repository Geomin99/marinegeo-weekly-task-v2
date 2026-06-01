// mail-scan-worker — 회사 PC watcher 전용 API (claim/ingest/finish)
// service_role 키는 Supabase 안에만. 회사 PC는 Gmail 스캔만 하고 DB 작업은 이 함수가 대행.
// 인증: x-reminder-secret(회사 PC↔Supabase 공유 시크릿, app_config 에 sha256 해시).
import { createClient } from "jsr:@supabase/supabase-js@2";

const OWNER_UID = "c819d3f9-7476-4271-89db-254b7770529a"; // geomin99 (받은편지함 owner allowlist)

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const provided = req.headers.get("x-reminder-secret") || "";
    const providedHash = provided ? await sha256hex(provided) : "";
    const { data: cfg } = await sb.from("app_config").select("value").eq("key", "reminder_shared_secret").single();
    if (!cfg || !provided || providedHash !== cfg.value) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // kill-switch
    const { data: ks } = await sb.from("app_config").select("value").eq("key", "mail_scan_enabled").single();
    const enabled = !ks || ks.value !== "false";

    if (action === "claim") {
      if (!enabled) return Response.json({ disabled: true });
      const { data: pend } = await sb.from("scan_requests")
        .select("*").eq("status", "pending").order("requested_at", { ascending: true }).limit(1).maybeSingle();
      if (!pend) return Response.json({ none: true });
      const { data: claimed } = await sb.from("scan_requests")
        .update({ status: "running", worker_id: body.worker_id || "pc", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", pend.id).eq("status", "pending").select("*").maybeSingle();
      if (!claimed) return Response.json({ none: true }); // 경쟁에서 밀림
      return Response.json({ request: { id: claimed.id, owner: claimed.owner, scope: claimed.scope } });
    }

    if (action === "ingest") {
      // 받은편지함 draft 는 owner=토뭉이님만 허용(allowlist 이중 방어)
      let centerCreated = 0, inboxCreated = 0, skipped = 0;
      const center = Array.isArray(body.center) ? body.center : [];
      const inbox = Array.isArray(body.inbox) ? body.inbox : [];

      for (const c of center) {
        if (!c.gmail_message_id) { skipped++; continue; }
        const { data: ex } = await sb.from("center_tasks").select("id").eq("gmail_message_id", c.gmail_message_id).limit(1).maybeSingle();
        if (ex) { skipped++; continue; }
        const { error } = await sb.from("center_tasks").insert({
          title: c.title, sender: c.sender ?? null, category: c.category, status: "확인필요",
          priority: c.priority || "보통", received_date: c.received_date ?? null, due_date: c.due_date ?? null,
          fiscal_year: c.fiscal_year ?? null, is_recurring: false, source: "email",
          gmail_message_id: c.gmail_message_id, note: c.note ?? null, created_by: "mail-scan",
        });
        if (error) { skipped++; } else { centerCreated++; }
      }

      for (const d of inbox) {
        if (!d.gmail_message_id) { skipped++; continue; }
        const { data: ex } = await sb.from("inbox_action_drafts").select("id").eq("gmail_message_id", d.gmail_message_id).limit(1).maybeSingle();
        if (ex) { skipped++; continue; }
        const { error } = await sb.from("inbox_action_drafts").insert({
          gmail_message_id: d.gmail_message_id, gmail_thread_id: d.gmail_thread_id ?? null, gmail_link: d.gmail_link ?? null,
          subject_masked: d.subject_masked ?? null, sender_name_masked: d.sender_name_masked ?? null,
          sender_email_domain: d.sender_email_domain ?? null, received_at: d.received_at,
          category: d.category ?? "other", status: "needs_review", priority: d.priority || "normal",
          due_date: d.due_date ?? null, summary_masked: d.summary_masked ?? null,
          evidence_flags: d.evidence_flags ?? {}, source: "gmail_inbox", created_by: "mail-scan",
          owner_user_id: OWNER_UID, expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
        });
        if (error) { skipped++; } else { inboxCreated++; }
      }
      return Response.json({ centerCreated, inboxCreated, skipped });
    }

    if (action === "finish") {
      const upd: Record<string, unknown> = {
        status: body.status === "failed" ? "failed" : "done",
        finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        center_created_count: body.center_created_count ?? 0,
        inbox_draft_created_count: body.inbox_draft_created_count ?? 0,
        skipped_count: body.skipped_count ?? 0,
        error_message: body.error_message ?? null,
      };
      await sb.from("scan_requests").update(upd).eq("id", body.id);
      return Response.json({ ok: true });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
