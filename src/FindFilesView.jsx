// =============================================================================
// FindFilesView.jsx — 파일 위치 찾기(find-UX) 탭 (draft)
// 작성: Claude code (토심이) / 2026-06-22 / 4자 결론 D 하이브리드
//
// 흐름: ① 필터(연도/종류/크기, 이름 없음) → 클라우드 카탈로그 후보 토큰·집계
//       ② 후보 범위에서 이름검색(resolver_service, LAN, Supabase JWT)
//       ③ 결과 클릭 → 실경로 표시 + 파일/폴더 열기(mgeo://)
// ⚠️ resolver(LAN)는 인프라 구성 후 동작. 미설정 시 ①까지만(집계 브라우즈).
// =============================================================================
import { useState } from "react";
import { catalogFilter, resolverSearch, resolverResolve, RESOLVER_URL } from "./findFilesApi";

const FORMATS = ["SEGY", "DOC", "NAV", "GIS", "IMG", "ARCHIVE", "OTHER"];
const SIZES = ["<1K", "<1M", "<100M", "<1G", ">=1G"];
const YEARS = ["2021", "2022", "2023", "2024", "2025", "2026"];
const SCOPE_CAP = 5000; // 이름검색 가능 후보 상한(resolver viewer cap 정렬)

function chip(active) {
  return {
    padding: "3px 10px", borderRadius: 14, fontSize: 12, cursor: "pointer", marginRight: 6, marginBottom: 6,
    border: "1px solid " + (active ? "#245f9a" : "#d9e3ee"),
    background: active ? "#245f9a" : "#fff", color: active ? "#fff" : "#56657a",
  };
}

export default function FindFilesView() {
  const [years, setYears] = useState([]);
  const [formats, setFormats] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [filter, setFilter] = useState(null); // {total, tokens, facets}
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState(null);
  const [paths, setPaths] = useState({}); // token -> realpath
  const [notice, setNotice] = useState("");

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function applyFilter() {
    setLoading(true); setNotice(""); setMatches(null); setPaths({});
    const r = await catalogFilter({
      years: years.length ? years : null,
      formats: formats.length ? formats : null,
      sizes: sizes.length ? sizes : null,
      limit: SCOPE_CAP,
    });
    setLoading(false);
    if (!r.ok) { setNotice("필터 조회 실패: " + (r.detail || r.code)); setFilter(null); return; }
    setFilter(r);
  }

  async function runSearch() {
    if (!filter?.tokens?.length) return;
    if (!q.trim()) { setNotice("검색어를 입력해주세요."); return; }
    if (filter.total > SCOPE_CAP) { setNotice(`후보가 너무 많습니다(${filter.total}). 필터를 더 좁혀주세요.`); return; }
    setLoading(true); setNotice("");
    const r = await resolverSearch({ tokens: filter.tokens, q: q.trim() });
    setLoading(false);
    if (!r.ok) {
      setMatches([]);
      setNotice(r.code === "resolver_unconfigured" || r.code === "resolver_unreachable"
        ? "이름 검색은 사내망에서만 가능합니다(파일 위치 서비스 미연결). 관리자에게 문의하세요."
        : "검색 실패: " + (r.detail || r.code));
      return;
    }
    setMatches(r.matches);
  }

  async function showPath(token) {
    const r = await resolverResolve({ tokens: [token] });
    if (!r.ok) { setNotice("위치 확인 불가."); return; }
    setPaths((p) => ({ ...p, [token]: r.results[token] || "(경로 없음)" }));
  }

  const canName = filter && filter.total <= SCOPE_CAP && RESOLVER_URL;

  return (
    <div style={{ width: "100%", padding: "8px 4px" }}>
      <h2 style={{ fontSize: 18, color: "#142033", marginBottom: 4 }}>파일 위치 찾기</h2>
      <p style={{ fontSize: 12.5, color: "#56657a", marginTop: 0 }}>
        연도·종류·크기로 좁힌 뒤 이름으로 찾습니다. 발주처 경로는 사내망에서만 표시되며 모든 조회는 기록됩니다.
      </p>

      {/* 필터 */}
      <div style={{ background: "#f4f7fb", border: "1px solid #d9e3ee", borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1f3a5f", marginBottom: 4 }}>연도</div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {YEARS.map((y) => <span key={y} style={chip(years.includes(y))} onClick={() => toggle(years, setYears, y)}>{y}</span>)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1f3a5f", margin: "8px 0 4px" }}>종류</div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {FORMATS.map((f) => <span key={f} style={chip(formats.includes(f))} onClick={() => toggle(formats, setFormats, f)}>{f}</span>)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1f3a5f", margin: "8px 0 4px" }}>크기</div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {SIZES.map((s) => <span key={s} style={chip(sizes.includes(s))} onClick={() => toggle(sizes, setSizes, s)}>{s}</span>)}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={applyFilter} disabled={loading}>
          {loading ? "조회 중…" : "필터 적용"}
        </button>
      </div>

      {/* 필터 결과·집계 */}
      {filter && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, color: "#142033" }}>
            후보 <b>{filter.total.toLocaleString()}</b>건
            {filter.total > SCOPE_CAP && <span style={{ color: "#8a6d3b" }}> · 이름검색하려면 {SCOPE_CAP.toLocaleString()}건 이하로 좁혀주세요</span>}
          </div>
          {filter.facets?.format_class && (
            <div style={{ fontSize: 12, color: "#56657a", marginTop: 4 }}>
              종류별: {Object.entries(filter.facets.format_class).map(([k, v]) => `${k} ${v}`).join(" · ")}
            </div>
          )}
        </div>
      )}

      {/* 이름 검색 */}
      {canName && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={100}
            placeholder="파일명/경로 일부 (예: handong, line01)"
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            style={{ flex: 1, padding: "8px 10px", border: "1px solid #d9e3ee", borderRadius: 6, fontSize: 13 }} />
          <button className="btn btn-primary" onClick={runSearch} disabled={loading}>이름 검색</button>
        </div>
      )}
      {filter && !RESOLVER_URL && (
        <div style={{ fontSize: 12.5, color: "#8a6d3b", marginBottom: 10 }}>
          ※ 이름 검색·실경로 표시는 사내망 파일 위치 서비스 연결 후 가능합니다(현재 집계 브라우즈만).
        </div>
      )}

      {notice && <div style={{ fontSize: 13, color: "#a33", marginBottom: 10 }}>{notice}</div>}

      {/* 검색 결과 */}
      {matches && matches.map((m) => (
        <div key={m.locator_token} className="panel" style={{ marginBottom: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#142033" }}>{m.display_name}</div>
          {paths[m.locator_token] ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, background: "#f4f7fb", border: "1px solid #d9e3ee", borderRadius: 6, padding: "6px 10px" }}>
              <code style={{ flex: 1, fontSize: 12, color: "#245f9a", wordBreak: "break-all" }}>{paths[m.locator_token]}</code>
              <a className="btn btn-primary" style={{ padding: "3px 10px", fontSize: 12, textDecoration: "none" }}
                href={`mgeo:open?p=${encodeURIComponent(paths[m.locator_token])}`}>파일 열기</a>
              <a className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 12, textDecoration: "none" }}
                href={`mgeo:folder?p=${encodeURIComponent(paths[m.locator_token])}`}>폴더 열기</a>
            </div>
          ) : (
            <button className="btn btn-ghost" style={{ marginTop: 6, padding: "3px 10px", fontSize: 12 }}
              onClick={() => showPath(m.locator_token)}>위치 보기</button>
          )}
        </div>
      ))}
      {matches && matches.length === 0 && !notice && (
        <div style={{ fontSize: 13, color: "#56657a" }}>일치하는 파일이 없습니다.</div>
      )}
    </div>
  );
}
