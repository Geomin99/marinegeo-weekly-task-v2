// =============================================================================
// KBSearchView.jsx
// MG Knowledge Finder — 검색 탭 컴포넌트
//
// 작성: Claude code (토심이)
// 일자: 2026-06-21
// 수정: 2026-06-21 (4자 회담 P0 #10~14 반영 / 실 앱 통합)
// 계획 ref: C:\marinegeo\.omc\plans\mg-knowledge-finder-plan.md (rev3 §④)
// API 래퍼: ./kbSearchApi.js
//
// ⭐ 핵심 UX 보안 규칙 (P0, 계획 §수용기준 23)
//   - 민감/제외 차단 시 "검색 결과 없음"으로만 응답.
//   - "권한 없음", "차단됨", "민감 문서가 있지만 표시 불가" 등 존재 암시 메시지 금지.
//   - 서비스 비활성(kill switch) 안내는 "서비스 점검 중입니다" 으로만.
//   - 금지어: 민감·차단·권한없음·필터링·제외·일부결과·관리자문의
//
// ⭐ UNC 경로 (P0 #13, 계획 §수용기준 7)
//   - 결과 카드에는 축약 경로만 표시 (상위폴더 / 파일명).
//   - 전체 UNC는 [경로 복사] 버튼으로만 클립보드 제공.
//   - tooltip에 전체 경로 표시 금지.
//   - 복사 성공/실패 시 onNotice(showToast) — 브라우저 alert 금지.
//
// ⭐ 품질 배지 (P0 #12, 계획 §수용기준 5)
//   good     → "본문 양호"   (badge green)
//   partial  → "일부 추출"   (badge amber)
//   ocr      → "스캔 필요"   (badge orange)  ← CSS badge.orange 필수
//   failed   → "추출 실패"   (badge muted)
//   ⚠️ 통합 시 CSS 필수: .badge.green, .badge.amber, .badge.orange, .badge.muted
//      색상만으로 의미 전달 금지 — 텍스트 라벨 필수, aria-label 설명, WCAG AA 대비.
//
// ⭐ kill switch 연동 (계획 §보강 9)
//   - 503 응답 시 검색창 비활성화 + "서비스 점검 중입니다" 안내.
//   - 존재 암시 금지 원칙 유지.
//
// ⭐ React key (P0 #10)
//   - key = `${doc_id}:${chunk_id ?? page ?? index}` composite.
//   - index 단독 금지. 서버가 result_id/chunk_id 주면 그걸 우선.
//
// ⭐ maxLength (P0 #11)
//   - input maxLength=200 (서버 일치).
//   - "123/200" 카운터 표시. submit 전 동일 검증.
//
// ⚠️ 배포는 토뭉이님 명시 승인 후 별도 진행 (Edge Function kb-search 선배포 필요).
// =============================================================================

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  Copy,
  FileText,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { kbSearch } from "./kbSearchApi";
import { ErpHero } from "./ErpHero";

// ---------------------------------------------------------------------------
// 상수 / 설정
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 30;  // per-request 행 수 (서버 상한 50 이내)
const MAX_QUERY_LENGTH = 200;  // P0 #11: 서버와 일치. 210 여유분 제거.

// 품질 배지 정의 — 추출 품질등급별 표시 레이블·색상 클래스
// P0 #12: 텍스트 라벨 필수(색상만으로 의미 전달 금지). WCAG AA 대비 주석 포함.
// ⚠️ 통합 담당자: 아래 4종 CSS 클래스가 앱 CSS에 정의돼 있어야 한다.
//   .badge.green  — 배경 #d1fae5, 글자 #065f46  (WCAG AA 대비 ≥ 4.5:1)
//   .badge.amber  — 배경 #fef3c7, 글자 #92400e  (WCAG AA 대비 ≥ 4.5:1)
//   .badge.orange — 배경 #ffedd5, 글자 #9a3412  (WCAG AA 대비 ≥ 4.5:1) ← 누락 주의
//   .badge.muted  — 배경 #f3f4f6, 글자 #374151  (WCAG AA 대비 ≥ 4.5:1)
//   각 배지는 aria-label로 품질 의미를 스크린리더에 추가 설명한다. (아래 JSX 참조)
const QUALITY_BADGE = {
  good:    { label: "본문 양호",  cls: "badge green",  ariaDesc: "추출 품질: 본문 정상 추출" },
  partial: { label: "일부 추출", cls: "badge amber",  ariaDesc: "추출 품질: 일부 텍스트만 추출됨" },
  ocr:     { label: "스캔 필요", cls: "badge orange", ariaDesc: "추출 품질: 스캔 이미지, OCR 필요" },
  failed:  { label: "추출 실패", cls: "badge muted",  ariaDesc: "추출 품질: 텍스트 추출 실패" },
};
function qualityBadge(quality) {
  return QUALITY_BADGE[quality] || { label: quality || "알 수 없음", cls: "badge muted", ariaDesc: "추출 품질 미확인" };
}

// 파일 확장자별 아이콘 문자 (Bootstrap Icons 미사용 fallback용 텍스트 레이블)
// 기존 앱은 lucide-react 사용 — 여기서도 FileText 단일 아이콘으로 통일.
const DOC_TYPE_LABEL = {
  pdf:  "PDF",
  docx: "Word",
  doc:  "Word",
  hwp:  "HWP",
  hwpx: "HWP",
  pptx: "PPT",
  ppt:  "PPT",
  md:   "MD",
  txt:  "TXT",
};

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

/**
 * P0 #13: UNC 경로 축약 표시 유틸.
 * 카드에는 "상위폴더 / 파일명" 형식만 표시.
 * 전체 UNC는 [경로 복사] 버튼으로만 제공 — tooltip에도 표시 금지.
 *
 * 예) "\\\\server\\share\\프로젝트\\2026\\보고서.pdf"
 *   → "프로젝트 / 보고서.pdf"  (중간 경로 생략 — 폴더명 민감도 고려)
 *
 * @param {string} uncPath  전체 UNC 경로
 * @returns {string}  축약 경로 레이블
 */
function abbreviateUncPath(uncPath) {
  if (!uncPath) return "";
  // 구분자를 / 또는 \ 모두 처리
  const parts = uncPath.replace(/\\/g, "/").split("/").filter(Boolean);
  // UNC의 경우: ["", "", "server", "share", "폴더1", "폴더2", "파일명"]
  // filter(Boolean) 후: ["server", "share", "폴더1", ..., "파일명"]
  if (parts.length === 0) return uncPath;
  const filename = parts[parts.length - 1];
  if (parts.length <= 3) {
    // 서버\쉐어\파일명 수준이면 그냥 파일명
    return filename;
  }
  // 직계 상위 폴더 하나만 표시 (중간 경로 생략)
  const parentFolder = parts[parts.length - 2];
  return `${parentFolder} / ${filename}`;
}

/**
 * 클립보드에 텍스트를 복사한다.
 * Clipboard API 미지원 시 textarea execCommand fallback.
 * @returns {Promise<boolean>} 성공 여부
 */
async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 등 — fallback 시도
    }
  }
  // textarea fallback
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 스니펫 문자열을 하이라이트 JSX로 변환한다.
 *
 * 서버에서 반환한 snippet은 일반 텍스트이거나,
 * 보안 definer RPC가 <mark>…</mark>로 감싼 하이라이트를 포함할 수 있다.
 * dangerouslySetInnerHTML을 피하기 위해 수동 파싱을 사용한다.
 *
 * @param {string} snippet
 * @returns {React.ReactNode[]}
 */
function renderSnippet(snippet) {
  if (!snippet) return null;
  // <mark> 태그만 허용 (서버가 삽입하는 유일한 마크업).
  // 다른 HTML은 텍스트로 그대로 출력해 XSS 방지.
  const parts = snippet.split(/(<mark>[^<]*<\/mark>)/g);
  return parts.map((part, i) => {
    const m = part.match(/^<mark>([^<]*)<\/mark>$/);
    if (m) {
      return (
        <mark
          key={i}
          style={{ backgroundColor: "#fff3a0", borderRadius: 2, padding: "0 2px" }}
        >
          {m[1]}
        </mark>
      );
    }
    return part;  // 일반 텍스트
  });
}

// ---------------------------------------------------------------------------
// 서브 컴포넌트: 결과 카드 1개
// ---------------------------------------------------------------------------

function ResultCard({ result, index, onCopyPath, onNotice }) {
  const qb = qualityBadge(result.quality);
  const docLabel = DOC_TYPE_LABEL[result.doc_type?.toLowerCase()] || (result.doc_type?.toUpperCase() || "파일");

  // P0 #13: 카드에는 축약 경로만 표시. 전체 UNC는 복사 버튼으로만.
  const abbreviatedPath = abbreviateUncPath(result.unc_path);

  // 2순위: "왜 매칭됐는지" 배지 (서버 annotateMatches 결과). 색상만으로 의미 전달 금지 → 텍스트 라벨.
  const matchBadgeStyle = (m) => {
    const base = { borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 600, flexShrink: 0 };
    if (m === "요약") return { ...base, background: "#e8f2ff", color: "#1f3a5f" };
    if (m === "파일명") return { ...base, background: "#e3f4ee", color: "#0f7a52" };
    if (m === "경로") return { ...base, background: "#f3f0e8", color: "#8a6d3b" };
    return { ...base, background: "#eef0f7", color: "#4b5563" }; // 본문·의미
  };

  async function handleCopy() {
    const ok = await copyToClipboard(result.unc_path);
    if (ok) {
      // P0 #14: 복사 성공 문구 고정
      onNotice?.("경로를 복사했습니다.", "success");
    } else {
      // P0 #14: 복사 실패 문구 고정
      onNotice?.("복사하지 못했습니다. 다시 시도해 주세요.", "error");
    }
    onCopyPath?.(result.doc_id);
  }

  return (
    <article className="panel" style={{ marginBottom: 10, padding: "14px 16px" }}>
      {/* 상단: 파일명 + 배지 */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{
          background: "#e8f2ff",
          color: "#1f3a5f",
          borderRadius: 4,
          padding: "1px 7px",
          fontSize: 11.5,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {docLabel}
        </span>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "#142033", flex: 1, lineHeight: 1.4 }}>
          {result.filename}
        </h3>
        {/*
          P0 #12: 품질 배지 접근성
          - 텍스트 라벨 필수 (색상만으로 의미 전달 금지).
          - aria-label로 품질 의미를 스크린리더에 추가 설명.
          - WCAG AA 대비: 통합 시 CSS 4종(.badge.green/.amber/.orange/.muted) 필수.
        */}
        <span
          className={qb.cls}
          style={{ flexShrink: 0 }}
          aria-label={qb.ariaDesc}
        >
          {qb.label}
        </span>
      </div>

      {/* 2순위: 매칭 이유 배지 (요약/파일명/경로/본문·의미) + 매칭 검색어 */}
      {Array.isArray(result.matched_in) && result.matched_in.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          <span style={{ fontSize: 11, color: "#56657a" }}>매칭</span>
          {result.matched_in.map((m) => (
            <span key={m} style={matchBadgeStyle(m)} aria-label={`매칭 위치: ${m}`}>{m}</span>
          ))}
          {Array.isArray(result.matched_terms) && result.matched_terms.length > 0 && (
            <span style={{ fontSize: 11, color: "#56657a", wordBreak: "break-all" }}>
              · 검색어: {result.matched_terms.slice(0, 6).join(", ")}
            </span>
          )}
        </div>
      )}

      {/* 폴더 루트 */}
      {result.folder_root && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#56657a" }}>
          폴더: {result.folder_root}
        </p>
      )}

      {/*
        P0 #13: UNC 경로 축약 표시
        - 카드에는 "상위폴더 / 파일명" 축약 경로만 표시.
        - 전체 UNC는 [경로 복사] 버튼으로만 클립보드 제공.
        - title/tooltip 속성에 전체 경로 표시 금지.
      */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 8,
        background: "#f4f7fb",
        border: "1px solid #d9e3ee",
        borderRadius: 6,
        padding: "6px 10px",
      }}>
        <code style={{
          fontSize: 12,
          color: "#245f9a",
          flex: 1,
          wordBreak: "break-all",
          fontFamily: "Consolas, 'Courier New', monospace",
          lineHeight: 1.5,
        }}>
          {abbreviatedPath}
        </code>
        <a
          className="btn btn-primary"
          style={{ flexShrink: 0, padding: "3px 10px", fontSize: 12, textDecoration: "none", whiteSpace: "nowrap" }}
          href={`mgeo:open?p=${encodeURIComponent(result.unc_path)}`}
          title="기본 프로그램으로 파일 열기"
        >
          파일 열기
        </a>
        <a
          className="btn btn-ghost"
          style={{ flexShrink: 0, padding: "3px 10px", fontSize: 12, textDecoration: "none", whiteSpace: "nowrap" }}
          href={`mgeo:folder?p=${encodeURIComponent(result.unc_path)}`}
          title="탐색기에서 폴더 열기(파일 선택)"
        >
          폴더 열기
        </a>
        <button
          className="btn btn-ghost"
          style={{ flexShrink: 0, padding: "3px 8px", fontSize: 12 }}
          onClick={handleCopy}
          aria-label={`${result.filename} 경로 복사`}
          title="경로 복사"
        >
          <Copy size={13} />
        </button>
      </div>

      {/* 스니펫 — P0 #14: dangerouslySetInnerHTML 금지, renderSnippet()으로 XSS 방지 */}
      {result.snippet && (
        <p style={{
          margin: "8px 0 0",
          fontSize: 13,
          color: "#374151",
          lineHeight: 1.65,
          borderLeft: "3px solid #d9e3ee",
          paddingLeft: 10,
          maxHeight: 72,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
        }}>
          {renderSnippet(result.snippet)}
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// 서브 컴포넌트: 빈 결과 / 오류 / 로딩 상태
// ---------------------------------------------------------------------------

function EmptyState({ icon: Icon, heading, sub }) {
  return (
    <div className="empty-state panel" style={{ marginTop: 24 }}>
      {Icon && <Icon size={22} />}
      <h3>{heading}</h3>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 메인 컴포넌트: KBSearchView
// ---------------------------------------------------------------------------

/**
 * KBSearchView
 *
 * Props:
 *   onNotice(message, type)  — App.jsx showNotice와 동일 시그니처. toast 전용.
 *
 * 내부 상태:
 *   queryInput   : 입력창 값 (실시간)
 *   submitted    : 마지막으로 검색한 query (제출 시점 스냅샷)
 *   results      : KBSearchResult[]
 *   status       : 'idle' | 'loading' | 'done' | 'error' | 'killed'
 *   errorCode    : 서버 반환 에러 코드
 *
 * P0 #14: total 건수 미표시. pagination/더보기 제거 (fixed cap).
 */
export default function KBSearchView({ onNotice }) {
  const [queryInput, setQueryInput]   = useState("");
  const [submitted, setSubmitted]     = useState("");
  const [results, setResults]         = useState([]);
  const [status, setStatus]           = useState("idle");
  const [errorCode, setErrorCode]     = useState(null);
  const abortRef                      = useRef(null);
  const inputRef                      = useRef(null);

  // ── 검색 실행 ────────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q) => {
    const trimmed = (q || "").trim();
    if (!trimmed) return;

    // P0 #11: submit 전 maxLength 동일 검증 (서버와 일치)
    if (trimmed.length > MAX_QUERY_LENGTH) return;

    // 이전 요청 중단 (연속 입력 시 이전 응답 무시)
    if (abortRef.current) abortRef.current = false;
    const myToken = {};
    abortRef.current = myToken;

    setStatus("loading");
    setSubmitted(trimmed);
    setResults([]);
    setErrorCode(null);

    // P0 #14: fixed cap — pagination 없음. 한 번에 PAGE_LIMIT 행만 요청.
    const response = await kbSearch({ query: trimmed, limit: PAGE_LIMIT, offset: 0 });

    // 이 요청이 취소됐으면 무시
    if (abortRef.current !== myToken) return;

    if (response.ok) {
      setResults(response.results);
      setStatus("done");
    } else {
      setErrorCode(response.code);
      // kill switch (503)
      if (response.code === "service_unavailable" || response.status === 503) {
        setStatus("killed");
      } else {
        setStatus("error");
      }
    }
  }, []);

  // ── 폼 제출 ──────────────────────────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();
    doSearch(queryInput);
  }

  // ── 검색어 초기화 ────────────────────────────────────────────────────────
  function clearQuery() {
    setQueryInput("");
    setResults([]);
    setStatus("idle");
    setErrorCode(null);
    setSubmitted("");
    inputRef.current?.focus();
  }

  // ── 에러 메시지 (사용자용 — 존재 암시 금지, 금지어 제거) ─────────────────
  // P0 #14: 상태문구 매핑 고정.
  // 금지어: 민감·차단·권한없음·필터링·제외·일부결과·관리자문의
  // 진짜0건·민감차단·권한차단 → 서버가 0건 반환 → "검색 결과 없음"(isEmpty 분기 처리)
  function errorMessage(code) {
    switch (code) {
      case "rate_limit_exceeded":
        // P0 #14: rate limit
        return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
      case "query_too_long":
        return "검색어가 너무 깁니다. 200자 이내로 줄여주세요.";
      case "empty_query":
      case "broad_query":
        return "검색어를 좀 더 구체적으로 입력해주세요.";
      case "unauthorized":
        return "로그인 세션이 만료되었습니다. 다시 로그인해주세요.";
      case "query_timeout":
      case "network_error":
      default:
        // P0 #14: timeout·일반에러
        return "검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  const isKilled   = status === "killed";
  const isLoading  = status === "loading";
  const isDone     = status === "done";
  const isError    = status === "error";
  const hasResults = isDone && results.length > 0;
  const isEmpty    = isDone && results.length === 0;

  // P0 #11: 카운터 표시용
  const queryLen = queryInput.length;
  const isOverLimit = queryLen > MAX_QUERY_LENGTH;

  return (
    <div className="kb-search-view" style={{ width: "100%" }}>
      {/* ── 히어로 ── */}
      <ErpHero
        title="자료 검색"
        meta="Y 드라이브 지식문서 전문 검색 · FTS · 위치·스니펫 반환"
        tags={["자연어 검색", "UNC 경로", "품질 배지", isKilled ? { label: "점검 중", hot: true } : "운영 중"]}
        actions={null}
      />

      {/* ── 검색창 ── */}
      {/*
        P0 #11: maxLength=200 (서버 일치). 카운터 "123/200" 표시.
        P0 #14: 최소 검색어 2자 — minLength는 submit 시점에만 체크(UX: 타이핑 중 막지 않음).
      */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 20,
          padding: "14px 16px",
          background: "#fff",
          border: "1px solid #d9e3ee",
          borderRadius: 10,
          boxShadow: "0 1px 4px rgba(31,58,95,.06)",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={17} />
            <input
              ref={inputRef}
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="RadExPro SEG-Y 지오메트리 설정 방법…"
              disabled={isKilled}
              aria-label="자료 검색"
              autoFocus
              maxLength={MAX_QUERY_LENGTH}
            />
            {queryInput && (
              <button type="button" onClick={clearQuery} aria-label="검색어 지우기">
                <X size={15} />
              </button>
            )}
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={isKilled || isLoading || !queryInput.trim() || queryInput.trim().length < 2 || isOverLimit}
            style={{ flexShrink: 0 }}
          >
            {isLoading
              ? <><Loader2 size={15} className="spin" /> 검색 중…</>
              : <><Search size={15} /> 검색</>
            }
          </button>
        </div>

        {/* P0 #11: 글자 수 카운터 */}
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          fontSize: 11.5,
          color: isOverLimit ? "#dc2626" : "#9ca3af",
          paddingRight: 2,
        }}>
          <span aria-live="polite" aria-atomic="true">
            {queryLen}/{MAX_QUERY_LENGTH}
          </span>
        </div>
      </form>

      {/* ── kill switch 안내 ── */}
      {/* P0 #14: kill switch = "서비스 점검 중입니다." */}
      {isKilled && (
        <div
          className="panel"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderLeft: "4px solid #6b7280",
            background: "#f9fafb",
          }}
        >
          <AlertCircle size={17} style={{ color: "#6b7280", flexShrink: 0 }} />
          <div>
            <strong style={{ fontSize: 13.5, color: "#374151" }}>서비스 점검 중입니다.</strong>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#56657a" }}>
              잠시 후 다시 시도해 주세요.
            </p>
          </div>
        </div>
      )}

      {/* ── 로딩 스피너 ── */}
      {isLoading && (
        <div className="empty-state panel">
          <Loader2 size={18} className="spin" />
          <p>검색 중입니다…</p>
        </div>
      )}

      {/* ── 에러 상태 ── */}
      {/* P0 #14: timeout·일반에러 = "검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." */}
      {isError && (
        <div
          className="panel"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "14px 16px",
            borderLeft: "4px solid #f59e0b",
          }}
        >
          <AlertCircle size={17} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>
              {errorMessage(errorCode)}
            </p>
          </div>
        </div>
      )}

      {/*
        P0 #14: 결과 영역 — aria-live="polite" 로 스크린리더 지원.
        total 건수 미표시. pagination/더보기 제거 (fixed cap).
        상위 관련 결과 안내문구 표시.
      */}
      <div aria-live="polite" aria-atomic="false">
        {/* ── 결과 헤더 (건수 미표시) ── */}
        {hasResults && (
          <p style={{
            fontSize: 12,
            color: "#56657a",
            margin: "0 0 8px 2px",
          }}>
            상위 관련 결과를 표시합니다. 검색어를 구체적으로 입력하면 더 정확한 결과를 얻을 수 있습니다.
          </p>
        )}

        {/* ── 빈 결과 ── */}
        {/*
          P0 #14: 존재 암시 금지.
          진짜0건·민감차단·권한차단 모두 동일 "검색 결과 없음"으로만.
        */}
        {isEmpty && (
          <EmptyState
            icon={FileText}
            heading="검색 결과 없음"
            sub="검색어를 바꿔 다시 시도해 주세요."
          />
        )}

        {/* ── 결과 목록 ── */}
        {/*
          P0 #10: React key = composite `${doc_id}:${chunk_id ?? page ?? index}`
          서버가 result_id를 주면 result_id 우선. index 단독 금지.
        */}
        {hasResults && (
          <div className="kb-result-list">
            {results.map((r, index) => {
              // composite key: result_id 우선 → chunk_id → page → index 순
              const compositeKey = r.result_id
                ? r.result_id
                : `${r.doc_id}:${r.chunk_id ?? r.page ?? index}`;
              return (
                <ResultCard
                  key={compositeKey}
                  result={r}
                  index={index}
                  onCopyPath={() => {}}
                  onNotice={onNotice}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── 초기 상태 안내 ── */}
      {status === "idle" && (
        <div className="empty-state panel" style={{ marginTop: 24 }}>
          <Search size={22} />
          <h3>자료를 검색해보세요</h3>
          <p>
            RadExPro SEG-Y 설정, 보고서 양식, Sparker 처리 방법 등<br />
            Y 드라이브 지식문서에서 바로 찾을 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}
