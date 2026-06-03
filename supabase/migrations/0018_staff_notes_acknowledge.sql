-- 0018 업무 메모 읽음확인: 직원이 본인에게 공개된 메모를 '확인' 처리
alter table public.staff_notes add column if not exists acknowledged_at timestamptz;
create index if not exists idx_staff_notes_ack on public.staff_notes (employee_id, acknowledged_at) where deleted_at is null;

create or replace function public.staff_note_acknowledge(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update public.staff_notes
     set acknowledged_at = now(), updated_at = now()
   where id = p_id and deleted_at is null and acknowledged_at is null
     and visibility in ('employee','team')
     and lower(employee_id) = lower(auth.jwt() ->> 'email');
end $$;
revoke all on function public.staff_note_acknowledge(uuid) from public, anon;
grant execute on function public.staff_note_acknowledge(uuid) to authenticated;
