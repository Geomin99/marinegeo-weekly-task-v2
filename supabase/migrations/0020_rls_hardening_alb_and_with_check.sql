-- 0020 RLS 하드닝 (감사 후속, 포테토뭉 검토 2026-06-06)
-- B) annual_leave_balances: 쓰기를 owner만으로 (직원이 서로 잔액 수정/삭제 방지). SELECT는 이미 owner/본인 범위라 유지.
-- C) scoped UPDATE 정책의 with_check를 using과 동일 술어로 좁힘 (author/created_by/owner 변경으로 범위 우회 차단).

-- ── B. annual_leave_balances ──
drop policy if exists alb_insert_auth on public.annual_leave_balances;
drop policy if exists alb_update_auth on public.annual_leave_balances;
drop policy if exists alb_delete_auth on public.annual_leave_balances;

create policy alb_insert_owner on public.annual_leave_balances
  for insert to authenticated
  with check (public.current_emp_role() = 'owner');
create policy alb_update_owner on public.annual_leave_balances
  for update to authenticated
  using (public.current_emp_role() = 'owner')
  with check (public.current_emp_role() = 'owner');
create policy alb_delete_owner on public.annual_leave_balances
  for delete to authenticated
  using (public.current_emp_role() = 'owner');

-- ── C. with_check 범위 일치 ──
-- leave_requests: 본인 신청 또는 owner만, UPDATE 후에도 author를 남의 것으로 못 바꿈
drop policy if exists lr_update_scoped on public.leave_requests;
create policy lr_update_scoped on public.leave_requests
  for update to authenticated
  using (public.current_emp_role() = 'owner' or author = public.current_emp_name())
  with check (public.current_emp_role() = 'owner' or author = public.current_emp_name());

-- meetings: 작성자 또는 owner만, created_by_email 변경 차단
drop policy if exists meetings_update on public.meetings;
create policy meetings_update on public.meetings
  for update to authenticated
  using (public.current_emp_role() = 'owner' or created_by_email = lower(auth.jwt() ->> 'email'))
  with check (public.current_emp_role() = 'owner' or created_by_email = lower(auth.jwt() ->> 'email'));

-- center_tasks: UPDATE 결과가 deleted_at 있는 행이 되지 않게 (soft delete는 SECURITY DEFINER RPC로만).
drop policy if exists "center_tasks update" on public.center_tasks;
create policy "center_tasks update" on public.center_tasks
  for update to authenticated
  using (deleted_at is null)
  with check (deleted_at is null);
