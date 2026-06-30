# 마이그레이션 재현성 — backfill 정책 (2026-06-30)

작성: Claude code(토심이). 검토 근거 = 4자 상의(포테토뭉·코더·헤르메스, 2026-06-30).

## 현황(실측)
- 운영 DB(`supabase_migrations.schema_migrations`) 적용 이력 = **56건**. **전 건 `statements`(원본 적용 SQL) 보존** → 언제든 정확 복원 가능(스키마 역추출이 아니라 원본 SQL 복원이므로 RLS/owner/grant 부정확 위험 없음).
- repo `supabase/migrations/` = 초기 순번 파일(`0001`~`0020`) + leave/달력 timestamp 파일(`20260630093809`·`093909`·`114047`·`114139`·`114221`·`120638`).
- **repo 미반영(누락) ≈ 32건** — 운영엔 적용됐으나 repo에 `.sql` 없음:
  - 초기 3건: `add_event_time_columns_and_general_types`(20260528), `02_compensatory_leave`(20260529), `03_compensatory_grant_column`(20260529)
  - `create_journal_drafts`(20260618)
  - `kb_*` 22건(20260620~20260622): kb_0021_tables ~ kb_catalog_filter (KB/자료검색)
  - `wiki_cards_mirror_v1`(20260625) + `match_reviewed_cards_v1~v4`(20260625~27) + `sync_load_and_switch_v1`(20260627)
- 원인: 최근 변경이 MCP `apply_migration`/대시보드로 운영에 직접 적용되며 repo 파일화가 빠짐. → "라이브 DB = 마이그레이션 SSoT" 상태.

## 정책(권장)
1. **앞으로 모든 스키마 변경은 repo 파일 먼저(timestamp 네이밍) → 적용**. 순번(`0021_`) 신규 금지(DB의 timestamp version과 순서 충돌). 기존 `0001`~`0020` 순번은 보존.
2. **누락 32건은 별도 backfill Phase에서 일괄 복원**(아래 방법). 이번 작업에 끼워 즉흥 실행하지 않음(검증 비용·범위 큼) — 4자 합의("신규 우선 + 누락은 별도 Phase").
3. backfill 실행 시 = `statements`에서 원본 SQL 추출 → `{version}_{name}.sql`로 저장. 적용 순서/idempotency는 이미 운영 반영분이라 `supabase migration list`로 applied 확인만(재적용 불필요).

## 복원 방법(실행 가능 형태)
운영 DB에서 누락분 원본 SQL 추출(예: 단건):
```sql
select version, name, array_to_string(statements, E'\n') as sql
  from supabase_migrations.schema_migrations
 where version = '20260620200605';   -- 예: kb_0021_tables
```
전체 누락 목록:
```sql
select version, name from supabase_migrations.schema_migrations order by version;
```
각 결과를 `supabase/migrations/{version}_{name}.sql`로 저장하면 repo↔DB 재현성 회복.
**주의**: `statements`는 원본 적용 SQL 전문이라 그대로 신뢰. 단 파일에 운영 비밀(키 등)이 들어간 마이그레이션이 있으면 마스킹 후 커밋(예: app_config_secret 계열은 값 제외).

## 위험·트레이드오프
- 미복원 유지 시: 새 환경/staging `supabase db reset`로 운영 동일 스키마 재현 불가(라이브 DB 의존).
- 일괄 복원 시: 32개 파일 추가(대량), `app_config_secret`류 비밀 노출 주의.
- 현재 운영 영향: **없음**(이력·기능은 라이브 DB에 정상 존재). 재현성/감사 편의의 문제.

## 상태
- 2026-06-30: 정책 정리 + leave/달력 6건 repo 반영 완료. **누락 32건 일괄 복원 = 토뭉이님 승인 후 별도 Phase**(토큰·검증 비용 + 비밀 마스킹 점검 필요).
