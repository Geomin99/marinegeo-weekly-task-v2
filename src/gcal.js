// 구글 캘린더(MGEO) 공용 헬퍼 — LeaveView가 저장한 토큰/캘린더id를 재사용(읽기 전용).
// LeaveView 코드를 건드리지 않고 동일 localStorage 키를 읽어 이벤트를 생성한다.
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

// MGEO 공유 캘린더에 종일 이벤트 1일 생성. 자동 호출 금지 — 사용자 명시 동의 시에만 호출할 것.
export async function createAllDayEvent({ summary, description, date }) {
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
