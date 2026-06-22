// =============================================================================
// findFilesApi.js — find-UX(파일 위치 찾기) 클라이언트 래퍼 (draft)
//
// 작성: Claude code (토심이) / 2026-06-22
// 4자 결론(D 하이브리드): 클라우드 카탈로그 필터(이름 없음) → 후보 토큰 →
//   로컬 resolver_service(LAN, Supabase JWT 인증, JWKS ES256 검증)에서 이름검색·실경로.
//
// ⚠️ resolver는 사내 LAN(Caddy TLS) 경유. VITE_RESOLVER_URL 미설정이면 find-UX 비활성.
//    실동작은 LAN 인프라(서비스계정·Caddy·방화벽·CA배포) 후. 배포=토뭉이님 게이트.
// =============================================================================
import { supabase } from "./supabaseClient";

function edgeUrl(fn) {
  const base = import.meta.env.VITE_SUPABASE_URL || "https://chbjgrvjnwygogjbktpa.supabase.co";
  return `${base}/functions/v1/${fn}`;
}
// resolver(LAN) 베이스 URL — 배포 시 사내 DNS(https://resolver.office.marinegeo.lan)로 설정.
export const RESOLVER_URL = import.meta.env.VITE_RESOLVER_URL || "";
export const FINDUX_ENABLED = import.meta.env.VITE_FINDUX_ENABLED === "1";

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

// 클라우드 카탈로그 필터(이름·경로 없음) → 후보 토큰 + 집계.
export async function catalogFilter({ years = null, formats = null, sizes = null, limit = 1000 }) {
  const t = await token();
  if (!t) return { ok: false, code: "unauthorized", detail: "로그인이 필요합니다." };
  try {
    const r = await fetch(edgeUrl("kb-catalog-filter"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}`, "Cache-Control": "no-store" },
      body: JSON.stringify({ years, formats, size_buckets: sizes, limit }),
    });
    const b = await r.json();
    if (!r.ok) return { ok: false, code: b.error || `http_${r.status}`, detail: b.detail };
    return { ok: true, total: b.total, returned: b.returned, tokens: b.tokens || [], facets: b.facets || {} };
  } catch (e) {
    return { ok: false, code: "network_error", detail: e.message };
  }
}

// resolver /search — 후보 토큰 범위에서 이름검색(LAN, Supabase JWT). resolver가 JWKS로 검증.
export async function resolverSearch({ tokens, q, matchMode = "basename", limit = 20 }) {
  if (!RESOLVER_URL) return { ok: false, code: "resolver_unconfigured", detail: "resolver 미설정(관리자 구성 필요)." };
  const t = await token();
  if (!t) return { ok: false, code: "unauthorized", detail: "로그인이 필요합니다." };
  try {
    const r = await fetch(`${RESOLVER_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
      body: JSON.stringify({ tokens, q, match_mode: matchMode, limit, purpose: "find_ux" }),
    });
    const b = await r.json();
    if (!r.ok) return { ok: false, code: b.error || `http_${r.status}`, detail: b.detail };
    return { ok: true, matches: b.matches || [], scanned: b.scanned };
  } catch (e) {
    return { ok: false, code: "resolver_unreachable", detail: "resolver 연결 불가(LAN/로그인 확인)." };
  }
}

// resolver /resolve_batch — 선택 토큰의 실경로(소량). 클릭 시 호출, 감사로그 남음.
export async function resolverResolve({ tokens }) {
  if (!RESOLVER_URL) return { ok: false, code: "resolver_unconfigured" };
  const t = await token();
  if (!t) return { ok: false, code: "unauthorized" };
  try {
    const r = await fetch(`${RESOLVER_URL}/resolve_batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
      body: JSON.stringify({ tokens, purpose: "find_ux" }),
    });
    const b = await r.json();
    if (!r.ok) return { ok: false, code: b.error || `http_${r.status}`, detail: b.detail };
    return { ok: true, results: b.results || {} };
  } catch (e) {
    return { ok: false, code: "resolver_unreachable", detail: "resolver 연결 불가." };
  }
}
