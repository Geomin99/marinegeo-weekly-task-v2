-- Phase C: leave_requests 원천 차감 트리거 + 권한 정리
-- 서버(DB)가 annual_consumed·total_absence_days의 권위. 클라이언트는 프리뷰.
-- 입력 경로(직원 신청 모달 / 일괄 import / 직접 SQL)와 무관하게 서버에서 일관 산출.

-- 1) 트리거 함수: 저장 직전 calculate_leave_amounts로 산출값 강제(NEW 직접 수정 → 재진입 없음)
create or replace function public.set_leave_request_amounts()
returns trigger
language plpgsql
volatile as $$
declare
  v record;
begin
  select * into v from public.calculate_leave_amounts(NEW.leave_type_id, NEW.start_date, NEW.end_date);
  NEW.annual_consumed    := coalesce(v.annual_consumed, 0);
  NEW.total_absence_days := coalesce(v.total_absence_days, 0);
  return NEW;
end;
$$;

-- 2) 트리거: leave_type_id/start_date/end_date/status 변경 시 재산출.
--    status 포함 이유 — rejected/cancelled 행을 active(pending/approved)로 복구할 때도 현행 규칙으로 재산출해
--    구(舊) 산식값이 부활하지 않도록 한다(포테토뭉 검증 조건2). 함수는 status를 보지 않으므로 산출값은 status와 무관.
drop trigger if exists trg_set_leave_request_amounts on public.leave_requests;
create trigger trg_set_leave_request_amounts
  before insert or update of leave_type_id, start_date, end_date, status
  on public.leave_requests
  for each row
  execute function public.set_leave_request_amounts();

-- 3) 권한 정리(4자 합의): 과도한 grant 회수. RLS와 별개의 이중 방어.
--    - company_calendar: 클라이언트는 read만. 쓰기는 service_role/postgres만.
revoke insert, update, delete, truncate on public.company_calendar from anon;
revoke insert, update, delete, truncate on public.company_calendar from authenticated;
--    - leave_requests: anon은 RLS 정책 자체가 없어 이미 차단됨(이중 방어). authenticated 쓰기는 RLS로 본인/대표만 — 유지.
revoke insert, update, delete, truncate on public.leave_requests from anon;
