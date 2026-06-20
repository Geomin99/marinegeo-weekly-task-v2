// =============================================================================
// kbSearchApi.js
// MG Knowledge Finder — kb-search Edge Function 클라이언트 래퍼
//
// 작성: Claude code (토심이)
// 일자: 2026-06-21
// 계획 ref: C:\marinegeo\.omc\plans\mg-knowledge-finder-plan.md (rev3 §④)
// API 계약 ref: mg-kb/search/functions/kb-search/index.ts
//
// 역할:
//   - Supabase 세션 JWT를 Authorization 헤더에 첨부해 kb-search를 호출한다.
//   - no-store Cache-Control 고정 (서버에서도 설정하지만 클라이언트 이중 방어).
//   - 정규화된 에러 객체 { ok: false, code, detail } 반환 — UI가 switch로 처리.
//   - 테이블 직접 접근 없음. 모든 조회는 Edge Function 경유.
//
// ⚠️ 배포는 토뭉이님 명시 승인 후 별도 진행 (Edge Function kb-search 선배포 필요).
// =============================================================================

import { supabase } from "./supabaseClient"; // weekly-task 기존 클라이언트 재사용

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

// 배포 시 Vercel 환경변수 또는 Vite import.meta.env로 교체 가능.
// 드래프트: 하드코딩 대신 supabase 클라이언트에서 URL을 파생.
//
// Supabase Edge Function URL 패턴:
//   https://<project-ref>.supabase.co/functions/v1/<function-name>
//
// @param {string} projectRef  Supabase 프로젝트 ref (chbjgrvjnwygogjbktpa)
function edgeFunctionUrl(fnName) {
  // supabaseClient.js와 동일한 프로젝트 URL.
  // VITE_SUPABASE_URL이 빌드에 없으면 상대경로가 되어 잘못된 도메인(vercel.app)으로
  // 요청이 가므로, 하드코딩 fallback으로 항상 Supabase 프로젝트를 가리키게 한다.
  const base = import.meta.env.VITE_SUPABASE_URL || "https://chbjgrvjnwygogjbktpa.supabase.co";
  return `${base}/functions/v1/${fnName}`;
}

const KB_SEARCH_URL = edgeFunctionUrl("kb-search");

// ---------------------------------------------------------------------------
// 타입 문서 (JSDoc — 런타임 미영향)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} KBSearchParams
 * @property {string} query    검색어 (2~200자, 공백만 입력 불가)
 *                             P0 #11: maxLength 200 (서버 일치). 최소 2자.
 * @property {number} [limit]  반환 행 수 (1~50, 기본 30). fixed cap — UI는 pagination 없음.
 * @property {number} [offset] 페이지 오프셋 (0~1000, 기본 0). UI에서는 항상 0으로 호출.
 */

/**
 * @typedef {Object} KBSearchResult
 * @property {string}  doc_id       문서 UUID
 * @property {string}  [result_id]  결과 행 UUID (서버가 주면 React key 우선 사용)
 * @property {string}  [chunk_id]   청크 UUID (result_id 없을 때 doc_id와 조합해 key 구성)
 * @property {number}  [page]       페이지 번호 (chunk_id 없을 때 fallback key)
 * @property {string}  filename     파일명
 * @property {string}  folder_root  루트 폴더 레이블 (allowlist 루트 이름)
 * @property {string}  unc_path     UNC 경로 (\\server\share\...\file.ext).
 *                                  카드에는 abbreviateUncPath()로 축약 표시 (P0 #13).
 *                                  전체 경로는 복사 버튼으로만 클립보드 제공.
 * @property {string}  doc_type     파일 확장자 (pdf, docx, hwp, pptx, md, ...)
 * @property {string}  quality      품질등급 (good | partial | ocr | failed)
 * @property {string}  snippet      하이라이트 스니펫 (<mark> 태그만 포함 가능).
 *                                  dangerouslySetInnerHTML 금지 — renderSnippet() 사용 (P0 #14).
 * @property {number}  score        FTS 랭킹 점수
 */

/**
 * @typedef {Object} KBSearchResponse
 * @property {boolean}          ok       성공 여부
 * @property {KBSearchResult[]} results  결과 목록 (ok=true 시)
 * @property {number}           [total]  전체 결과 수 (ok=true 시, cap 적용 후).
 *                                       UI에서 미표시 (P0 #14).
 * @property {string}           [code]   에러 코드 (ok=false 시)
 * @property {string}           [detail] 에러 상세 메시지 (ok=false 시, 사용자 비노출 용도)
 */

// ---------------------------------------------------------------------------
// 메인 함수
// ---------------------------------------------------------------------------

/**
 * kb-search Edge Function 호출.
 *
 * 보안 계약 (Edge Function index.ts 기준):
 *   [A] 세션 JWT를 Authorization: Bearer로 전송 — 미인증 시 401.
 *   [B] 테이블 직접 접근 없음 — service_role RPC kb_search() 경유.
 *   [C] rate limit·query length·empty query 방어는 서버 측에서 처리.
 *       클라이언트는 query trim만 수행 (이중 방어).
 *   [D] kill switch 비활성 시 503 반환.
 *   [E] no-store Cache-Control (서버+클라이언트 이중).
 *
 * @param {KBSearchParams} params
 * @returns {Promise<KBSearchResponse>}
 */
export async function kbSearch({ query, limit = 30, offset = 0 }) {
  // ── 클라이언트 측 기본 유효성 검사 ──────────────────────────────────────
  // 서버에서도 동일 검사를 수행하므로 여기서는 네트워크 왕복을 줄이기 위한 조기 반환.
  const trimmedQuery = (query || "").trim();
  if (!trimmedQuery) {
    return { ok: false, code: "empty_query", detail: "검색어를 입력해주세요." };
  }
  if (trimmedQuery.length > 200) {
    return { ok: false, code: "query_too_long", detail: "검색어가 너무 깁니다 (최대 200자)." };
  }

  // ── 세션 JWT 취득 ────────────────────────────────────────────────────────
  // supabase.auth.getSession()은 캐시된 세션을 반환하므로 매번 호출해도 빠름.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, code: "unauthorized", detail: "로그인이 필요합니다." };
  }

  // ── Edge Function 호출 ───────────────────────────────────────────────────
  let resp;
  try {
    resp = await fetch(KB_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        // no-store: 서버에서도 설정하지만 브라우저 캐시 이중 방어.
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        query:  trimmedQuery,
        limit:  Math.min(Math.max(Math.floor(limit), 1), 50),
        offset: Math.min(Math.max(Math.floor(offset), 0), 1000),
      }),
    });
  } catch (networkErr) {
    // 네트워크 오류 (오프라인, CORS, DNS 실패 등)
    return {
      ok:     false,
      code:   "network_error",
      detail: `네트워크 오류: ${networkErr.message}`,
    };
  }

  // ── 응답 파싱 ────────────────────────────────────────────────────────────
  let body;
  try {
    body = await resp.json();
  } catch {
    return { ok: false, code: "parse_error", detail: "서버 응답을 파싱할 수 없습니다." };
  }

  // HTTP 성공 (200)
  if (resp.ok) {
    return {
      ok:      true,
      results: body.results || [],
      total:   typeof body.total === "number" ? body.total : (body.results?.length ?? 0),
    };
  }

  // HTTP 에러 — 서버 code/detail을 그대로 전달 (UI에서 switch 처리).
  return {
    ok:     false,
    code:   body.error || `http_${resp.status}`,
    detail: body.detail,
    status: resp.status,
  };
}
