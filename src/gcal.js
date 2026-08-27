// 구글 캘린더(MGEO) 공용 헬퍼 — LeaveView가 저장한 토큰/캘린더id를 재사용한다.
// 2026-08-27: 토큰 만료 시 조용한 재발급(silent reissue)까지 담당하도록 확장.
//   종전에는 읽기 전용이라, access token(약 59분)이 만료되면 센터·통화로그 탭의
//   캘린더 추가가 항상 실패했다. 자동 갱신 타이머는 「캘린더」 탭의 GoogleCalendarSync가
//   마운트돼 있을 때만 살아 있어, 다른 탭에서는 되살릴 경로가 없었기 때문이다.
import { supabase } from "./supabaseClient";

const TOKEN_KEY = "mgeo_gcal_token_v1";
const CAL_ID_KEY = "mgeo_gcal_calendar_id_v1";
// 한 번이라도 구글 동의(grant)를 마쳤는지 — LeaveView가 세우는 플래그와 같은 키를 공유한다.
const GRANT_FLAG_KEY = "mgeo_gcal_granted_v1";

// LeaveView와 동일한 OAuth 설정 (Client ID는 공개정보라 브라우저 노출이 정상)
const GOOGLE_CLIENT_ID_FALLBACK = "897631356111-45ul0ohnrosarqd669d3vlj70gg7kq2i.apps.googleusercontent.com";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
// 구글이 콜백을 돌려주지 않는 경우 무한 대기를 막는 상한
const SILENT_REISSUE_TIMEOUT_MS = 10000;

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

function wasGranted() {
  try { return localStorage.getItem(GRANT_FLAG_KEY) === "1"; } catch { return false; }
}

function clearGranted() {
  try { localStorage.removeItem(GRANT_FLAG_KEY); } catch { /* noop */ }
}

function saveToken(token) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch { /* noop */ }
}

// 지금 이 순간 바로 호출 가능한 상태인지(유효 토큰 + 캘린더id 모두 있음)
export function gcalReady() {
  return !!(loadGcalToken() && loadGcalCalendarId());
}

// 토큰이 만료됐어도 과거 동의가 남아 있어 조용히 되살릴 수 있는 상태인지.
// 화면에서 '미연동' 경고를 띄울지 판단할 때 쓴다(경고 오탐 방지).
export function gcalCanSilentReconnect() {
  return wasGranted();
}

// GIS 로드 상한 — 실패한 스크립트 때문에 영구 대기하는 것을 막는다
const GIS_LOAD_TIMEOUT_MS = 8000;

// 재동의가 필요한 오류만 grant 플래그를 지운다. 일시적·환경적 오류까지 지우면
// 다음부터 조용한 재발급이 막혀 불필요한 consent 화면을 반복하게 된다.
const REGRANT_REQUIRED_ERRORS = new Set([
  "access_denied", "interaction_required", "consent_required", "login_required", "invalid_grant",
]);

// 이 오류일 때만 동의가 실제로 필요하다고 본다. LeaveView도 같은 판정을 쓴다.
export function isRegrantRequired(error) {
  return REGRANT_REQUIRED_ERRORS.has(error);
}

// ── GIS(Google Identity Services) 로더 ──────────────────────────
function gisAvailable() {
  return typeof window !== "undefined" && !!window.google?.accounts?.oauth2;
}

let gisPromise = null;
// LeaveView도 이 로더를 함께 쓴다. 로더가 둘이면 한쪽이 상대의 <script> 태그를 stale로 보고
// 제거해, 상대는 영영 오지 않을 load 이벤트를 기다리게 된다(연동 버튼이 준비 안 됨).
export function loadGis() {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(false);
  if (gisAvailable()) return Promise.resolve(true);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve) => {
    let el = null;
    let timer = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      const ok = gisAvailable();
      // 실패한 태그를 남겨두면 다음 호출이 '이미 끝난 이벤트'를 기다리다 영원히 멈춘다 → 반드시 치운다
      if (!ok && el) { try { el.remove(); } catch { /* noop */ } }
      resolve(ok);
    };
    // 이전 시도가 남긴 태그는 load/error 이벤트가 이미 지나갔을 수 있어, 리스너를 붙여도 영영 오지 않는다.
    // 그래서 기존 태그를 신뢰하지 않고 치운 뒤 항상 새 태그로 다시 시도한다(캐시가 있어 비용은 낮다).
    const stale = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (stale) { try { stale.remove(); } catch { /* noop */ } }
    el = document.createElement("script");
    el.src = GIS_SRC; el.async = true; el.defer = true;
    el.onload = finish;
    el.onerror = finish;
    timer = setTimeout(finish, GIS_LOAD_TIMEOUT_MS);
    document.head.appendChild(el);
  }).finally(() => { gisPromise = null; });
  return gisPromise;
}

// 이미 연동한 사용자를 위해 GIS를 미리 받아둔다.
// 클릭한 뒤에야 스크립트를 내려받으면 그 사이 브라우저 user activation이 소멸해
// 구글 인증 창이 팝업 차단에 걸릴 수 있다. 앱 진입 시 한 번 호출한다.
export function preloadGcal() {
  if (!wasGranted()) return;
  loadGis();
}

// ── 토큰 조용히 재발급 ──────────────────────────────────────────
function requestSilentToken() {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      resolve(v);
    };
    let client;
    try {
      client = window.google.accounts.oauth2.initTokenClient({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID_FALLBACK,
        scope: CAL_SCOPE,
        callback: (resp) => {
          // 상한을 넘겨 이미 실패로 처리된 뒤 도착한 늦은 콜백은 저장소를 건드리지 않는다
          // (뒤늦게 토큰을 되살리거나 grant 플래그를 지워 화면과 어긋나는 것을 막는다)
          if (settled) return;
          if (resp?.error || !resp?.access_token) {
            if (REGRANT_REQUIRED_ERRORS.has(resp?.error)) clearGranted();
            finish({ ok: false, reason: "no_token" });
            return;
          }
          const token = {
            access_token: resp.access_token,
            expires_at: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000,
          };
          saveToken(token);
          finish({ ok: true, token });
        },
        // 인증 창이 열리지 못했거나 닫힌 경우 — 상한까지 기다리지 않고 즉시 구분해 알린다
        // error_callback은 OAuth 오류가 아니라 창이 열리지 못했거나 닫힌 경우를 알린다
        error_callback: (err) => {
          if (settled) return;
          const type = String(err?.type || "");
          const reason =
            type === "popup_failed_to_open" ? "popup_blocked" :
            type === "popup_closed" ? "popup_closed" : "no_token";
          finish({ ok: false, reason });
        },
      });
    } catch {
      finish({ ok: false, reason: "no_token" });
      return;
    }
    timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), SILENT_REISSUE_TIMEOUT_MS);
    // prompt:"" = 동의 이력이 있으면 화면 없이 재발급. 동의가 없으면 여기까지 오지 않는다.
    try { client.requestAccessToken({ prompt: "" }); } catch { finish({ ok: false, reason: "no_token" }); }
  });
}

let reissueInFlight = null;

// 유효 토큰 확보(내부용). 실패 사유까지 담아 돌려준다.
async function acquireToken() {
  const current = loadGcalToken();
  if (current) return { ok: true, token: current };
  // 동의 이력이 없으면 팝업을 띄우지 않는다 (진입 시 자동 OAuth 금지 — 포테토뭉 권고 2026-06 유지)
  if (!wasGranted()) return { ok: false, reason: "no_grant" };
  if (reissueInFlight) return reissueInFlight;
  reissueInFlight = (async () => {
    const loaded = await loadGis();
    if (!loaded) return { ok: false, reason: "gis_unavailable" };
    return await requestSilentToken();
  })().finally(() => { reissueInFlight = null; });
  return reissueInFlight;
}

// 유효 토큰 확보: 살아 있으면 그대로, 만료·부재이고 과거 동의가 있으면 조용히 재발급.
export async function ensureGcalToken() {
  const r = await acquireToken();
  return r.ok ? r.token : null;
}

let calIdInFlight = null;

// MGEO 캘린더 id 확보: 저장된 값이 있으면 그대로, 없으면 calendarList에서 찾아 캐시한다.
export async function ensureGcalCalendarId(token) {
  const cached = loadGcalCalendarId();
  if (cached) return cached;
  if (!token) return null;
  if (calIdInFlight) return calIdInFlight;   // 동시 호출이 같은 조회를 중복 수행하지 않도록
  calIdInFlight = (async () => {
    try {
      const r = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const data = await r.json();
      if (data.error) return null;
      const mgeo = (data.items || []).find((c) => (c.summary || "").toUpperCase() === "MGEO");
      if (!mgeo) return null;
      try { localStorage.setItem(CAL_ID_KEY, mgeo.id); } catch { /* noop */ }
      return mgeo.id;
    } catch {
      return null;
    }
  })().finally(() => { calIdInFlight = null; });
  return calIdInFlight;
}

// 캘린더 호출 직전 공통 준비 단계. 실패 사유를 구분해 돌려준다.
//   no_grant        = 구글 연동을 한 적이 없음 → 「캘린더」 탭에서 연동 필요
//   no_token        = 동의는 있었으나 재발급 실패 → 재연동 필요
//   popup_blocked   = 인증 창이 열리지 못함(팝업 차단 등)
//   timeout         = 구글 응답이 상한 내에 오지 않음
//   gis_unavailable = 구글 인증 스크립트를 못 받음
//   no_calendar     = 토큰은 있으나 'MGEO' 이름의 캘린더를 찾지 못함
export async function ensureGcalReady() {
  const r = await acquireToken();
  if (!r.ok) return { ok: false, reason: r.reason };
  const calId = await ensureGcalCalendarId(r.token);
  if (!calId) return { ok: false, reason: "no_calendar" };
  return { ok: true, token: r.token, calId };
}

// 실패 사유 → 사람이 읽는 문장 (화면 문구를 한 곳에서 통일)
export function gcalReasonText(reason) {
  if (reason === "no_grant") return "구글 캘린더 미연동입니다. 「캘린더」 탭에서 구글 연동을 먼저 해주세요.";
  if (reason === "no_token") return "구글 연동이 만료되었습니다. 「캘린더」 탭에서 다시 연동해주세요.";
  if (reason === "popup_blocked") return "구글 인증 창이 열리지 못했습니다. 팝업 차단을 해제하거나 「캘린더」 탭에서 다시 연동해주세요.";
  if (reason === "popup_closed") return "구글 인증 창이 닫혔습니다. 다시 시도해주세요.";
  if (reason === "timeout") return "구글 응답이 지연되었습니다. 잠시 후 다시 시도하거나 「캘린더」 탭에서 다시 연동해주세요.";
  if (reason === "gis_unavailable") return "구글 인증 스크립트를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.";
  if (reason === "no_calendar") return "구글 계정에서 'MGEO' 캘린더를 찾지 못했습니다. 구글 캘린더에 'MGEO' 이름으로 캘린더를 만들어주세요.";
  return `캘린더 오류: ${reason}`;
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
  const ready = await ensureGcalReady();
  if (!ready.ok) return { ok: false, reason: ready.reason };
  const { token, calId } = ready;
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
  const ready = await ensureGcalReady();
  if (!ready.ok) return { ok: false, reason: ready.reason };
  const { token, calId } = ready;
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
  const ready = await ensureGcalReady();
  if (!ready.ok) return { ok: false, reason: ready.reason };
  const { token, calId } = ready;
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
  // 동기화할 건이 없는 것은 실패가 아니라 정상 no-op → ok:true 로 알린다
  if (!requests?.length)
    return { ok: true, reason: "no_requests", pushed: 0, updated: 0, removed: 0, errors: 0 };
  const ready = await ensureGcalReady();
  if (!ready.ok)
    return { ok: false, reason: ready.reason, pushed: 0, updated: 0, removed: 0, errors: 0 };
  const { token, calId } = ready;
  let pushed = 0, updated = 0, removed = 0, errors = 0;
  const calUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
  const authHeaders = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
  const markSynced = async (id, sig, extra = {}) => {
    // 구글은 성공했는데 서명 기록이 실패하면 다음 동기화에서 같은 건을 또 처리(루프/중복) 위험 → 최소한 경고로 노출
    const { error } = await supabase.from("leave_requests")
      .update({ calendar_synced_at: new Date().toISOString(), calendar_sync_signature: sig, calendar_sync_error: null, ...extra })
      .eq("id", id);
    if (error) console.warn("[gcal] markSynced 실패(다음 동기화에서 재시도):", id, error.message);
    return error;
  };

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
      // 공유 캘린더 개인정보 분리: 휴가 종류는 일반화, 메모·동행·목적은 미노출(description 비움).
      // 업무 조율상 출장/외근의 목적지만 유지. (포테토뭉 검토 2026-06-06)
      const lt = req.leave_type_name || "";
      const publicType = lt.includes("출장") ? "출장" : lt.includes("외근") ? "외근" : "휴가";
      const publicDest = (publicType === "출장" || publicType === "외근") ? (req.destination || "") : "";
      const summary = publicDest ? `[${req.author}] ${publicType} - ${publicDest}` : `[${req.author}] ${publicType}`;
      const description = "";
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
