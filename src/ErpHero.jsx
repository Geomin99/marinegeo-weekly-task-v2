// Project Desk v003 스타일 공용 히어로 (navy→teal 그라데이션)
export function ErpHero({ title, meta, tags = [], actions = null }) {
  return (
    <div className="erp-hero">
      <p className="erp-eyebrow">MARINE &amp; GEO · OPERATIONS</p>
      <h1>{title}</h1>
      {meta && <p className="erp-hero-meta">{meta}</p>}
      {tags.length > 0 && (
        <div className="erp-hero-tags">
          {tags.map((t, i) => <span key={i} className={t.hot ? "hot" : ""}>{t.label ?? t}</span>)}
        </div>
      )}
      {actions && <div className="erp-hero-actions">{actions}</div>}
    </div>
  );
}
