-- 0010 캘린더 개인정보 가시성 — 계정-직원 매핑 + 연차 현황 RLS
-- 대표(owner)=전체 / 직원(employee)=본인 author / 공용메일(shared)=숨김
-- 달력 그리드용 leave_requests는 전원 공유 유지(여기서 변경하지 않음)

-- 1) 계정-직원 매핑 (email -> 이름/역할)
create table if not exists public.employee_accounts (
  email text primary key,
  employee_name text not null,
  role text not null check (role in ('owner','employee','shared'))
);
insert into public.employee_accounts (email, employee_name, role) values
  ('geomin99@gmail.com','여은민','owner'),
  ('chanse7979@gmail.com','김찬수','employee'),
  ('pyoring94@gmail.com','최승표','employee'),
  ('marinegeo99@gmail.com','마린엔지오','shared')
on conflict (email) do update set employee_name = excluded.employee_name, role = excluded.role;

alter table public.employee_accounts enable row level security;
-- 직접 접근 정책 없음 → 아래 SECURITY DEFINER 함수로만 조회

-- 2) 현재 로그인 사용자의 역할/이름 (definer로 매핑 테이블 RLS 우회)
create or replace function public.current_emp_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.employee_accounts where email = (auth.jwt() ->> 'email') limit 1;
$$;
create or replace function public.current_emp_name() returns text
  language sql stable security definer set search_path = public as $$
  select employee_name from public.employee_accounts where email = (auth.jwt() ->> 'email') limit 1;
$$;
revoke all on function public.current_emp_role() from public;
revoke all on function public.current_emp_name() from public;
grant execute on function public.current_emp_role() to authenticated;
grant execute on function public.current_emp_name() to authenticated;

-- 3) annual_leave_balances: SELECT만 본인/대표로 제한 (쓰기는 기존대로 유지)
drop policy if exists "annual_leave_balances authenticated all" on public.annual_leave_balances;
create policy "alb_select_scoped" on public.annual_leave_balances
  for select to authenticated
  using ( public.current_emp_role() = 'owner' or author = public.current_emp_name() );
create policy "alb_insert_auth" on public.annual_leave_balances
  for insert to authenticated with check (true);
create policy "alb_update_auth" on public.annual_leave_balances
  for update to authenticated using (true) with check (true);
create policy "alb_delete_auth" on public.annual_leave_balances
  for delete to authenticated using (true);
