// voice-worker — 통화 음성 전사 워커 API (claim/result/fail)
// 회사 PC faster-whisper 워커 전용. service_role은 Supabase 안에만. 인증: x-reminder-secret(sha256 해시).
import { createClient } from "jsr:@supabase/supabase-js@2";

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
    const now = new Date().toISOString();

    if (body.action === "claim") {
      const { data: job } = await sb.from("voice_call_logs")
        .select("id, storage_path, original_filename").eq("status", "pending")
        .is("deleted_at", null).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (!job) return Response.json({ none: true });
      const { data: claimed } = await sb.from("voice_call_logs")
        .update({ status: "processing", worker_id: body.worker_id || "pc", processing_started_at: now, updated_at: now })
        .eq("id", job.id).eq("status", "pending").select("id, storage_path, original_filename").maybeSingle();
      if (!claimed) return Response.json({ none: true });
      const { data: signed, error: sErr } = await sb.storage.from("voice-calls").createSignedUrl(claimed.storage_path, 900);
      if (sErr || !signed) {
        await sb.from("voice_call_logs").update({ status: "failed", error_message: "signed url 실패: " + (sErr?.message || ""), updated_at: now }).eq("id", claimed.id);
        return Response.json({ none: true });
      }
      return Response.json({ job: { id: claimed.id, original_filename: claimed.original_filename, signed_url: signed.signedUrl } });
    }

    if (body.action === "result") {
      await sb.from("voice_call_logs").update({
        transcript_text: body.transcript_text ?? null,
        transcript_segments: body.segments ?? null,
        language: body.language ?? null,
        stt_engine: body.stt_engine ?? "faster-whisper",
        stt_model: body.stt_model ?? null,
        duration_seconds: body.duration_seconds ?? null,
        status: "transcribed", processed_at: now, updated_at: now, error_message: null,
      }).eq("id", body.id);
      return Response.json({ ok: true });
    }

    if (body.action === "summary") {
      await sb.from("voice_call_logs").update({
        summary_text: body.summary_text ?? null,
        summary_json: body.summary_json ?? null,
        requests: body.requests ?? null,
        decisions: body.decisions ?? null,
        action_items: body.action_items ?? null,
        key_points: body.key_points ?? null,
        due_dates: body.due_dates ?? null,
        follow_up_required: !!body.follow_up_required,
        extraction_model: "hermes(gpt-5.5)",
        is_confirmed: false,
        status: "completed", processed_at: now, updated_at: now,
      }).eq("id", body.id);
      return Response.json({ ok: true });
    }

    if (body.action === "fail") {
      // status=failed는 terminal(재claim은 pending만)이라 루프 없음. retry_count는 서버에서 +1 누적(정확 기록).
      const { data: cur } = await sb.from("voice_call_logs").select("retry_count").eq("id", body.id).maybeSingle();
      const nextRetry = (cur?.retry_count ?? 0) + 1;
      await sb.from("voice_call_logs").update({
        status: "failed", error_message: (body.error_message || "").slice(0, 400),
        retry_count: nextRetry, processed_at: now, updated_at: now,
      }).eq("id", body.id);
      return Response.json({ ok: true, retry_count: nextRetry });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
