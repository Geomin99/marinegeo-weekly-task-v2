-- Phase B: leave_types 의미 정리(단가형 vs 고정 총 인정일수) + calculate_leave_amounts v2
-- 결정(2026-06-30 토뭉이님): 출장=실근무일 기준 / 경조사·건강검진·졸업식=고정 총 인정일수 / 휴가=근무일×1.
-- additive(컬럼 추가·기본값 false). 적용 시 기존 행 즉시 재계산 아님(트리거/보정 별도).

-- 1) is_per_day: true = 부재일을 근무일수에 비례(휴가·예비군·출장), false = 고정 총 인정일수(경조사·건강검진 등)
alter table public.leave_types
  add column if not exists is_per_day boolean not null default false;

comment on column public.leave_types.is_per_day is
  'true=부재일이 근무일수에 비례(휴가/예비군/출장), false=신청기간 무관 고정 총 인정일수(경조사/건강검진/졸업식 등)';

-- 근무일 비례 유형: 휴가(1)·예비군(6)·출장(11)
update public.leave_types set is_per_day = true  where id in (1, 6, 11);
update public.leave_types set is_per_day = false where id not in (1, 6, 11);

-- 2) 산출 함수 v2: 곱셈버그(× 달력일수) 제거 + is_per_day 분기 + 보상휴가 음수 가드 + VOLATILE
create or replace function public.calculate_leave_amounts(
  p_leave_type_id bigint, p_start date, p_end date
) returns table(annual_consumed real, total_absence_days real)
language plpgsql volatile as $$
declare
  v_consumes   text;
  v_per_day    real;
  v_abs_per    real;
  v_is_per_day boolean;
  v_workdays   int;
begin
  select consumes_annual, annual_consumption, absence_days, is_per_day
    into v_consumes, v_per_day, v_abs_per, v_is_per_day
  from public.leave_types where id = p_leave_type_id;

  if not found then
    annual_consumed := 0; total_absence_days := 0; return next; return;
  end if;

  -- 근무일 = start~end 중 토·일·회사휴무(company_calendar.is_holiday) 제외
  select count(*) into v_workdays
  from generate_series(p_start, coalesce(p_end, p_start), interval '1 day') g(d)
  where extract(dow from g.d) not in (0, 6)
    and not exists (
      select 1 from public.company_calendar c
      where c.cal_date = g.d::date and c.is_holiday
    );

  -- 반차(0.5단가): 하루 0.5 고정(다일 오입력 방지)
  if v_consumes = 'O' and v_per_day = 0.5 then
    annual_consumed := 0.5; total_absence_days := 0.5; return next; return;
  end if;

  -- 보상휴가(id15, annual_consumption=-1) 등 음수 단가 = 레거시(사용 0건).
  -- 트리거 배선 시 음수 차감(잔여 증가) 오염 방지 가드. (보상휴가 누적은 annual_leave_balances.compensatory_grant로 별도 관리)
  if v_consumes = 'O' and coalesce(v_per_day, 0) < 0 then
    annual_consumed := 0; total_absence_days := 0; return next; return;
  end if;

  if v_consumes = 'O' then
    -- 연차 단가형(휴가): 근무일수 × 단가 차감, 부재일 = 근무일수
    annual_consumed    := coalesce(v_per_day, 0) * v_workdays;
    total_absence_days := v_workdays;
  else
    -- 연차 미차감(X)
    annual_consumed := 0;
    if coalesce(v_is_per_day, false) then
      -- 출장·예비군: 부재일 = 근무일수 × 단가(통상 1)
      total_absence_days := coalesce(v_abs_per, 0) * v_workdays;
    else
      -- 경조사·건강검진·졸업식: 신청기간 무관 고정 총 인정일수
      total_absence_days := coalesce(v_abs_per, 0);
    end if;
  end if;
  return next;
end;
$$;
