-- 0011 신청 목록 완전 차단 — leave_requests RLS + 달력 공개 뷰
-- 신청 목록/상세는 owner/본인만(RLS). 월 달력은 calendar_events_public(전원, 개인정보 컬럼 제외)로 공유.

-- leave_requests: 열람/수정/삭제는 owner/본인만, 생성은 authenticated
drop policy if exists "leave_requests authenticated all" on public.leave_requests;
create policy "lr_select_scoped" on public.leave_requests
  for select to authenticated
  using ( public.current_emp_role() = 'owner' or author = public.current_emp_name() );
create policy "lr_insert_auth" on public.leave_requests
  for insert to authenticated with check (true);
create policy "lr_update_scoped" on public.leave_requests
  for update to authenticated
  using ( public.current_emp_role() = 'owner' or author = public.current_emp_name() )
  with check (true);
create policy "lr_delete_scoped" on public.leave_requests
  for delete to authenticated
  using ( public.current_emp_role() = 'owner' or author = public.current_emp_name() );

-- 달력 공개 뷰: 개인정보 컬럼(memo·trip_purpose·companions·approver) 제외, 취소·반려 제외
-- security_invoker=false → 뷰 소유자 권한으로 RLS 우회(전원 달력 공유), 노출 컬럼 최소화로 통제
create or replace view public.calendar_events_public
with (security_invoker = false) as
  select id, author, leave_type_name, destination,
         start_date, end_date, is_all_day, start_time, status,
         google_calendar_event_id
  from public.leave_requests
  where status not in ('cancelled','rejected');

revoke all on public.calendar_events_public from anon;
grant select on public.calendar_events_public to authenticated;
