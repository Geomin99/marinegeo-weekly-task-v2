-- 0017 직원 메모(관리 메모) — owner 관리 + 직원은 본인 공개(employee/team) 메모 읽기전용
create table if not exists public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,          -- 대상 직원 = email
  employee_name text,
  author_email text not null,
  author_name text,
  memo_type text default '일반',
  title text,
  content text not null,
  related_module text,                -- weekly_task/marine_center/vacation/call_log/meeting
  related_id text,
  priority text default '보통',
  status text default 'open',         -- open/in_progress/done/archived
  follow_up_date date,
  visibility text default 'private',  -- private/employee/team/admin
  resolved_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_staff_notes_followup on public.staff_notes (deleted_at, status, follow_up_date);
create index if not exists idx_staff_notes_priority on public.staff_notes (priority, status, deleted_at);
create index if not exists idx_staff_notes_employee on public.staff_notes (employee_id, deleted_at, created_at desc);
create index if not exists idx_staff_notes_related on public.staff_notes (related_module, related_id);

alter table public.staff_notes enable row level security;
create policy staff_notes_select on public.staff_notes for select to authenticated using (
  deleted_at is null and (
    public.current_emp_role() = 'owner'
    or (visibility in ('employee','team') and lower(employee_id) = lower(auth.jwt() ->> 'email'))
  )
);
create policy staff_notes_insert on public.staff_notes for insert to authenticated
  with check ( public.current_emp_role() = 'owner' and lower(author_email) = lower(auth.jwt() ->> 'email') );
create policy staff_notes_update on public.staff_notes for update to authenticated
  using ( public.current_emp_role() = 'owner' ) with check ( public.current_emp_role() = 'owner' );

create or replace function public.staff_note_soft_delete(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if public.current_emp_role() <> 'owner' then raise exception 'not allowed'; end if;
  update public.staff_notes set deleted_at = now(), updated_at = now() where id = p_id and deleted_at is null;
end $$;
revoke all on function public.staff_note_soft_delete(uuid) from public, anon;
grant execute on function public.staff_note_soft_delete(uuid) to authenticated;
