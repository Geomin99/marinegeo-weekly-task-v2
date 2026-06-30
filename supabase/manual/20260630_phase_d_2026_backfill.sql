-- ============================================================================
-- Phase D: 기존 행 보정 (2026년만) — 수동 실행 전용. 자동배포(migrations)에 넣지 말 것.
-- 전제: Phase B(20260630201000)·Phase C(20260630201100) 적용 후 실행.
-- 결정(2026-06-30 토뭉이님): 보정 범위 = 2026만(2025 동결). 토뭉이님 승인 후 STEP별 수동 실행.
-- 각 STEP을 따로 실행하고 결과를 확인한 뒤 다음 STEP으로 진행한다.
-- ============================================================================

-- ─── STEP 0. 사전 점검 (쓰기 없음) ──────────────────────────────────────────
-- 0a. 트리거/함수 v2 적용 여부 확인 — 둘 다 존재해야 보정값이 현행 규칙으로 산출됨.
select
  (select count(*) from pg_trigger where tgname='trg_set_leave_request_amounts') as trigger_exists,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='leave_types' and column_name='is_per_day') as is_per_day_col;
-- 0b. 연말/연초를 걸치는 활성 행(2026 범위 판정이 애매한 행) 점검 — 있으면 정책 확인 후 진행.
select id, author, leave_type_name, start_date, end_date
  from public.leave_requests
 where status not in ('rejected','cancelled')
   and end_date is not null
   and extract(year from start_date) <> extract(year from end_date)
 order by start_date;

-- ─── STEP 1. DRY-RUN: 2026년 보정 대상 diff (쓰기 없음) ───────────────────────
-- 현재 저장값 vs 함수 v2 재계산값이 다른 2026년 활성 행을 나열.
select lr.id, lr.author, lr.leave_type_name,
       lr.start_date, lr.end_date,
       lr.annual_consumed     as old_annual,  (calc).annual_consumed     as new_annual,
       lr.total_absence_days  as old_absence, (calc).total_absence_days  as new_absence
  from public.leave_requests lr
  cross join lateral public.calculate_leave_amounts(lr.leave_type_id, lr.start_date, lr.end_date) as calc
 where lr.status not in ('rejected','cancelled')
   and lr.leave_type_id is not null
   and extract(year from lr.start_date) = 2026
   and ( lr.annual_consumed    is distinct from (calc).annual_consumed
      or lr.total_absence_days is distinct from (calc).total_absence_days )
 order by lr.start_date;

-- ─── STEP 1b. 영향 요약(직원별 연차 차감 증감) — 쓰기 없음 ─────────────────────
select lr.author,
       round(sum((calc).annual_consumed - lr.annual_consumed)::numeric, 2) as annual_consumed_change
  from public.leave_requests lr
  cross join lateral public.calculate_leave_amounts(lr.leave_type_id, lr.start_date, lr.end_date) as calc
 where lr.status not in ('rejected','cancelled')
   and lr.leave_type_id is not null
   and extract(year from lr.start_date) = 2026
 group by lr.author
having round(sum((calc).annual_consumed - lr.annual_consumed)::numeric, 2) <> 0;

-- ─── STEP 2. 백업 (STEP 1 검토·토뭉이님 승인 후 실행) ─────────────────────────
-- 2a. 백업 테이블이 이미 있으면 STOP하고 확인(이전 실행 잔재 위에 덮어쓰지 않도록).
--     to_regclass가 NULL이 아니면 기존 백업 존재 → 이름의 날짜·시각 suffix를 바꾸거나 의도적으로 drop 후 진행.
select to_regclass('public.leave_requests_backup_phase_d_20260630') as existing_backup;
-- 2b. 백업 생성(스냅샷). 위 2a가 NULL일 때만 실행. 재실행이면 suffix(예: _재실행시각)를 바꿔 새로 만든다.
create table public.leave_requests_backup_phase_d_20260630 as
select lr.* from public.leave_requests lr
 where lr.status not in ('rejected','cancelled')
   and extract(year from lr.start_date) = 2026;
-- 2c. 백업 row count 기록(보정·롤백 기준).
select count(*) as backup_rows from public.leave_requests_backup_phase_d_20260630;

-- ─── STEP 3. 보정 UPDATE (멱등; STEP 2 백업 후 실행) ─────────────────────────
-- 함수 v2 재계산값과 다른 행만 갱신. 재실행해도 추가 변화 없음.
update public.leave_requests lr
   set annual_consumed    = sub.new_annual,
       total_absence_days = sub.new_absence,
       updated_at         = now()
  from (
    select x.id,
           (c).annual_consumed     as new_annual,
           (c).total_absence_days  as new_absence
      from public.leave_requests x
      cross join lateral public.calculate_leave_amounts(x.leave_type_id, x.start_date, x.end_date) as c
     where x.status not in ('rejected','cancelled')
       and x.leave_type_id is not null
       and extract(year from x.start_date) = 2026
  ) sub
 where lr.id = sub.id
   and ( lr.annual_consumed    is distinct from sub.new_annual
      or lr.total_absence_days is distinct from sub.new_absence );

-- ─── STEP 4. 검증 (STEP 3 후) ───────────────────────────────────────────────
-- 4a. 잔여 diff가 0이어야 함(보정 완료 확인)
select count(*) as remaining_diff
  from public.leave_requests lr
  cross join lateral public.calculate_leave_amounts(lr.leave_type_id, lr.start_date, lr.end_date) as calc
 where lr.status not in ('rejected','cancelled')
   and lr.leave_type_id is not null
   and extract(year from lr.start_date) = 2026
   and ( lr.annual_consumed    is distinct from (calc).annual_consumed
      or lr.total_absence_days is distinct from (calc).total_absence_days );
-- 4b. 직원별 2026 연차 사용 합계(보정 후)
select author, round(sum(annual_consumed)::numeric,2) as used_2026
  from public.leave_requests
 where status not in ('rejected','cancelled') and extract(year from start_date)=2026
 group by author order by author;

-- 참고: compensatory_grant(보상휴가 누적)는 "출장 기간 내 휴일 수" 기준으로 별도 산정되며,
--       본 보정(total_absence_days=근무일)과 독립적이라 재계산 불필요. 변동 시 별도 검토.

-- ─── 롤백 (필요 시) ─────────────────────────────────────────────────────────
-- 백업 시점 값으로 완전 원복(updated_at 포함). 주의: 트리거가 status/날짜/유형 컬럼 변경에 발동하므로
-- annual_consumed·total_absence_days만 갱신하는 이 UPDATE는 트리거를 재발동시키지 않는다.
-- update public.leave_requests lr
--    set annual_consumed = b.annual_consumed,
--        total_absence_days = b.total_absence_days,
--        updated_at = b.updated_at
--   from public.leave_requests_backup_phase_d_20260630 b
--  where lr.id = b.id;
