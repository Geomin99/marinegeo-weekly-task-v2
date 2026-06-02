// 구글 캘린더(MGEO) 공용 헬퍼 — LeaveView가 저장한 토큰/캘린더id를 재사용(읽기 전용).
// LeaveView 코드를 건드리지 않고 동일 localStorage 키를 읽어 이벤트를 생성한다.
import { supabase } from "./supabaseClient";

const TOKEN_KEY = "mgeo_gcal_token_v1";
const CAL_ID_KEY = "mgeo_gcal_calendar_id_v1";

export function loadGcalToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t?.access_token || !t?.expires_at) return null;
    if (t.expires_at <= Date.now()) return null;
    return t;
  } catch {
    return null;
  }
}

export function loadGcalCalendarId() {
  try {
    return localStorage.getItem(CAL_ID_KEY) || null;
  } catch {
    return null;
  }
}

// 휴가·출장 탭에서 구글(MGEO) 연동을 이미 한 사용자인지
export function gcalReady() {
  return !!(loadGcalToken() && loadGcalCalendarId());
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// 해양벤처진흥센터 일정 식별 색 (Google colorId 1 = Lavender 연보라).
// 토뭉이님 지정 2026-05-31 · 포테토뭉 검토. [해양벤처진흥센터]/[센터완료] 계열 공통.
export const CENTER_EVENT_COLOR_ID = "1";

// MGEO 공유 캘린더에 종일 이벤트 1일 생성. 자동 호출 금지 — 사용자 명시 동의 시에만 호출할 것.
// colorId 지정 시 이벤트 색 부여(센터 일정 식별용).
export async function createAllDayEvent({ summary, description, date, colorId }) {
  const token = loadGcalToken();
  if (!token) return { ok: false, reason: "no_token" };
  const calId = loadGcalCalendarId();
  if (!calId) return { ok: false, reason: "no_calendar" };
  try {
    const end = new Date(date + "T00:00:00");
    end.setDate(end.getDate() + 1); // Google all-day end는 exclusive
    const body = {
      summary,
      description: description || "",
      start: { date },
      end: { date: ymd(end) },
      ...(colorId ? { colorId } : {}),
    };
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await r.json();
    if (data.id) return { ok: true, eventId: data.id };
    return { ok: false, reason: data.error?.message || `status_${r.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// MGEO 캘린더에 임의 이벤트 1건 생성(종일·시간지정 공용). body는 Google events.insert 형식.
export async function createRawEvent(body) {
  const token = loadGcalToken();
  const calId = loadGcalCalendarId();
  if (!token || !calId) return { ok: false, reason: "not_ready" };
  try {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
      { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const d = await r.json().catch(() => ({}));
    if (d.id) return { ok: true, eventId: d.id };
    return { ok: false, reason: d.error?.message || `status_${r.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// MGEO 캘린더 이벤트 직접 수정(제목·시간·설명). body는 Google events.patch 형식.
export async function updateCalendarEvent(eventId, body) {
  const token = loadGcalToken();
  const calId = loadGcalCalendarId();
  if (!token || !calId) return { ok: false, reason: "not_ready" };
  try {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({}));
    return { ok: false, reason: d.error?.message || `status_${r.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// 휴가·출장 → MGEO 캘린더 동기화 (LeaveView 자동 + 대시보드 트리거 공용)
// ─────────────────────────────────────────────────────────────
const LEAVE_STATUS_KO = { pending: "신청", approved: "승인", rejected: "반려", cancelled: "취소" };

// 캘린더에 반영되는 필드만 모아 signature 생성 → DB calendar_sync_signature 와 다르면 dirty
export function calendarSignature(req) {
  return JSON.stringify([
    req.author ?? "", req.leave_type_name ?? "", req.status ?? "",
    req.start_date ?? "", req.end_date ?? "", req.is_all_day === false ? 0 : 1,
    req.start_time ?? "", req.end_time ?? "", req.destination ?? "",
    req.trip_purpose ?? "", req.companions ?? "", req.memo ?? "",
  ]);
}

// 동기화 필요 여부: 활성 건은 event 없음/서명 불일치, 취소·반려 건은 event 잔존
export function needsCalendarSync(req) {
  const active = req.status !== "rejected" && req.status !== "cancelled";
  if (active) return !req.google_calendar_event_id || req.calendar_sync_signature !== calendarSignature(req);
  return !!req.google_calendar_event_id;
}

// requests 전체를 MGEO 캘린더에 동기화(신규 INSERT / 수정 PATCH / 취소·반려 DELETE).
// 구글 성공 시에만 calendar_synced_at/signature 기록(누락 방지). 결과 카운트 반환.
export async function syncLeaveRequests(requests) {
  const token = loadGcalToken();
  const calId = loadGcalCalendarId();
  if (!calId || !token || !requests?.length)
    return { ok: false, reason: "not_ready", pushed: 0, updated: 0, removed: 0, errors: 0 };
  let pushed = 0, updated = 0, removed = 0, errors = 0;
  const calUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
  const authHeaders = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
  const markSynced = (id, sig, extra = {}) =>
    supabase.from("leave_requests")
      .update({ calendar_synced_at: new Date().toISOString(), calendar_sync_signature: sig, calendar_sync_error: null, ...extra })
      .eq("id", id);

  for (const req of requests) {
    const sig = calendarSignature(req);
    const active = req.status !== "rejected" && req.status !== "cancelled";
    try {
      // 취소·반려 → 이벤트 삭제 (404/410은 이미 삭제로 보고 성공 처리)
      if (!active) {
        if (!req.google_calendar_event_id) continue;
        const r = await fetch(`${calUrl}/${req.google_calendar_event_id}`, { method: "DELETE", headers: authHeaders });
        if (r.ok || r.status === 404 || r.status === 410) { await markSynced(req.id, sig, { google_calendar_event_id: null }); removed++; }
        else errors++;
        continue;
      }
      // 활성 건: 서명 동일하면 최신 → skip
      if (req.google_calendar_event_id && req.calendar_sync_signature === sig) continue;
      const startDate = req.start_date;
      const endDate = req.end_date || req.start_date;
      const summary = `[${req.author}] ${req.leave_type_name || "휴가"}${req.destination ? ` - ${req.destination}` : ""}`;
      const description = [
        `상태: ${LEAVE_STATUS_KO[req.status] || req.status}`,
        req.memo && `메모: ${req.memo}`,
        req.companions && `동행: ${req.companions}`,
        req.trip_purpose && `목적: ${req.trip_purpose}`,
      ].filter(Boolean).join("\n");
      let event;
      if (req.is_all_day === false && req.start_time && req.end_time) {
        const startISO = `${startDate}T${req.start_time.slice(0, 8)}+09:00`;
        const endISO = `${endDate}T${req.end_time.slice(0, 8)}+09:00`;
        event = { summary, description, start: { dateTime: startISO, timeZone: "Asia/Seoul" }, end: { dateTime: endISO, timeZone: "Asia/Seoul" } };
      } else {
        const endDt = new Date(endDate); endDt.setDate(endDt.getDate() + 1); // all-day end는 exclusive
        event = { summary, description, start: { date: startDate }, end: { date: ymd(endDt) } };
      }
      if (req.google_calendar_event_id) {
        const r = await fetch(`${calUrl}/${req.google_calendar_event_id}`, { method: "PATCH", headers: authHeaders, body: JSON.stringify(event) });
        if (r.ok) { await markSynced(req.id, sig); updated++; }
        else if (r.status === 404 || r.status === 410) { // 캘린더에서 사라짐 → 재생성(self-heal)
          const r2 = await fetch(calUrl, { method: "POST", headers: authHeaders, body: JSON.stringify(event) });
          const d2 = await r2.json();
          if (d2.id) { await markSynced(req.id, sig, { google_calendar_event_id: d2.id }); pushed++; } else errors++;
        } else errors++;
      } else {
        const r = await fetch(calUrl, { method: "POST", headers: authHeaders, body: JSON.stringify(event) });
        const data = await r.json();
        if (data.id) { await markSynced(req.id, sig, { google_calendar_event_id: data.id }); pushed++; } else errors++;
      }
    } catch (e) { errors++; }
  }
  return { ok: true, pushed, updated, removed, errors };
}
