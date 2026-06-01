// meeting-worker — 회의 음성 전사·요약 워커 API (claim/result/summary/fail)
// voice-worker 거울. 회사 PC faster-whisper 워커 전용. service_role은 Supabase 안에만. 인증: x-reminder-secret(sha256).
// 차이: 음성파일은 meeting_files(kind=audio)에 있어 claim에서 조인. 상태=meetings enum(transcribing→summarized).
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
      // 전사 대기(transcribing) + 미점유(processing_started_at null) + 음성입력 회의
      const { data: job } = await sb.from("meetings")
        .select("id, title").eq("status", "transcribing").eq("input_method", "audio")
        .is("processing_started_at", null).is("deleted_at", null)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (!job) return Response.json({ none: true });
      const { data: claimed } = await sb.from("meetings")
        .update({ worker_id: body.worker_id || "pc", processing_started_at: now, updated_at: now })
        .eq("id", job.id).is("processing_started_at", null).select("id, title").maybeSingle();
      if (!claimed) return Response.json({ none: true });
      const { data: af } = await sb.from("meeting_files")
        .select("storage_path, original_filename").eq("meeting_id", claimed.id).eq("kind", "audio")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (!af?.storage_path) {
        await sb.from("meetings").update({ error_message: "음성파일 없음", processing_started_at: null, updated_at: now }).eq("id", claimed.id);
        return Response.json({ none: true });
      }
      const { data: signed, error: sErr } = await sb.storage.from("meeting-audio").createSignedUrl(af.storage_path, 900);
      if (sErr || !signed) {
        await sb.from("meetings").update({ error_message: "signed url 실패: " + (sErr?.message || ""), processing_started_at: null, updated_at: now }).eq("id", claimed.id);
        return Response.json({ none: true });
      }
      return Response.json({ job: { id: claimed.id, title: claimed.title, original_filename: af.original_filename, signed_url: signed.signedUrl } });
    }

    if (body.action === "result") {
      // 전사 결과 저장 (status는 transcribing 유지 — 같은 클레임에서 곧장 summary로 진행)
      await sb.from("meetings").update({
        transcript_text: body.transcript_text ?? null,
        transcript_segments: body.segments ?? null,
        language: body.language ?? null,
        stt_engine: body.stt_engine ?? "faster-whisper",
        stt_model: body.stt_model ?? null,
        updated_at: now, error_message: null,
      }).eq("id", body.id);
      return Response.json({ ok: true });
    }

    if (body.action === "summary") {
      // AI 회의록 정리(초안) — is_confirmed=false, status=summarized. 사람이 검토→확정.
      await sb.from("meetings").update({
        summary_text: body.summary_text ?? null,
        summary_json: body.summary_json ?? null,
        minutes_text: body.minutes_text ?? undefined,
        agenda: body.agenda ?? undefined,
        decisions: body.decisions ?? null,
        action_items: body.action_items ?? null,
        key_points: body.key_points ?? null,
        due_dates: body.due_dates ?? null,
        follow_up_required: !!body.follow_up_required,
        extraction_model: "hermes(gpt-5.5)",
        is_confirmed: false,
        status: "summarized", processed_at: now, updated_at: now,
      }).eq("id", body.id);
      return Response.json({ ok: true });
    }

    if (body.action === "fail") {
      // 재시도 허용: processing_started_at 해제. retry_count 누적.
      await sb.from("meetings").update({
        error_message: (body.error_message || "").slice(0, 400),
        retry_count: (body.retry_count ?? 0),
        processing_started_at: null, updated_at: now,
      }).eq("id", body.id);
      return Response.json({ ok: true });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
