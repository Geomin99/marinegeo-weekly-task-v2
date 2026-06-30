-- 근무일(토·일·company_calendar 휴무 제외) 기준 연차차감·부재일 산출 (v1).
-- 이미 운영 DB에 적용됨(version 20260630093909). repo 재현성 복원용 — 원본 적용 SQL과 동일.
-- ※ 후속 마이그레이션(20260630201000)에서 is_per_day 분기·VOLATILE로 개정됨.
create or replace function public.calculate_leave_amounts(
  p_leave_type_id bigint, p_start date, p_end date
) returns table(annual_consumed real, total_absence_days real)
language plpgsql stable as $$
declare
  v_consumes text;
  v_per_day  real;
  v_abs_per  real;
  v_workdays int;
  v_caldays  int;
begin
  select consumes_annual, annual_consumption, absence_days
    into v_consumes, v_per_day, v_abs_per
  from public.leave_types where id = p_leave_type_id;

  if not found then
    annual_consumed := 0; total_absence_days := 0; return next; return;
  end if;

  -- 근무일 = start~end 중 토·일·회사휴무 제외
  select count(*) into v_workdays
  from generate_series(p_start, coalesce(p_end, p_start), interval '1 day') g(d)
  where extract(dow from g.d) not in (0,6)
    and not exists (
      select 1 from public.company_calendar c
      where c.cal_date = g.d::date and c.is_holiday
    );

  v_caldays := (coalesce(p_end, p_start) - p_start) + 1;

  -- 반차(0.5단가)는 하루 0.5 고정(다일 오입력 방지)
  if v_consumes = 'O' and v_per_day = 0.5 then
    annual_consumed := 0.5; total_absence_days := 0.5; return next; return;
  end if;

  if v_consumes = 'O' then
    annual_consumed   := coalesce(v_per_day, 0) * v_workdays;
    total_absence_days := v_workdays;
  else
    annual_consumed   := 0;
    total_absence_days := coalesce(v_abs_per, 0) * v_caldays;  -- Phase B 의미정리 전까지 보존
  end if;
  return next;
end;
$$;
