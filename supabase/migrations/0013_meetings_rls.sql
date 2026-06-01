-- 0013 회의록 RLS — visibility 4종 (leave 0010/0011 패턴 거울)
-- 재귀 회피용 SECURITY DEFINER 헬퍼 (current_emp_role/name은 0010)

create or replace function public.is_meeting_participant(p uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meeting_participants mp
    where mp.meeting_id = p and lower(mp.email) = lower(auth.jwt() ->> 'email')
  );
$$;

create or replace function public.can_see_meeting(p uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meetings m where m.id = p and m.deleted_at is null and (
      public.current_emp_role() = 'owner'
      or m.visibility = 'all'
      or (m.visibility = 'owner_only' and lower(auth.jwt() ->> 'email') = 'geomin99@gmail.com')
      or (m.visibility = 'admin' and public.current_emp_role() = 'owner')
      or (m.visibility = 'participants' and (
            m.created_by_email = lower(auth.jwt() ->> 'email')
            or public.is_meeting_participant(m.id)
         ))
    )
  );
$$;

create or replace function public.can_edit_meeting(p uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meetings m where m.id = p and (
      public.current_emp_role() = 'owner'
      or m.created_by_email = lower(auth.jwt() ->> 'email')
    )
  );
$$;

revoke all on function public.is_meeting_participant(uuid) from public;
revoke all on function public.can_see_meeting(uuid) from public;
revoke all on function public.can_edit_meeting(uuid) from public;
grant execute on function public.is_meeting_participant(uuid) to authenticated;
grant execute on function public.can_see_meeting(uuid) to authenticated;
grant execute on function public.can_edit_meeting(uuid) to authenticated;

alter table public.meetings enable row level security;
create policy meetings_select on public.meetings for select to authenticated using (
  deleted_at is null and (
    public.current_emp_role() = 'owner'
    or visibility = 'all'
    or (visibility = 'owner_only' and lower(auth.jwt() ->> 'email') = 'geomin99@gmail.com')
    or (visibility = 'admin' and public.current_emp_role() = 'owner')
    or (visibility = 'participants' and (
          created_by_email = lower(auth.jwt() ->> 'email')
          or public.is_meeting_participant(id)
       ))
  )
);
create policy meetings_insert on public.meetings for insert to authenticated
  with check ( created_by_email = lower(auth.jwt() ->> 'email') );
create policy meetings_update on public.meetings for update to authenticated
  using ( public.current_emp_role() = 'owner' or created_by_email = lower(auth.jwt() ->> 'email') )
  with check ( true );
create policy meetings_delete on public.meetings for delete to authenticated
  using ( public.current_emp_role() = 'owner' or created_by_email = lower(auth.jwt() ->> 'email') );

alter table public.meeting_participants enable row level security;
create policy mparticipants_select on public.meeting_participants for select to authenticated using ( public.can_see_meeting(meeting_id) );
create policy mparticipants_write on public.meeting_participants for all to authenticated
  using ( public.can_edit_meeting(meeting_id) ) with check ( public.can_edit_meeting(meeting_id) );

alter table public.meeting_files enable row level security;
create policy mfiles_select on public.meeting_files for select to authenticated using ( public.can_see_meeting(meeting_id) );
create policy mfiles_write on public.meeting_files for all to authenticated
  using ( public.can_edit_meeting(meeting_id) ) with check ( public.can_edit_meeting(meeting_id) );

alter table public.meeting_action_items enable row level security;
create policy maction_select on public.meeting_action_items for select to authenticated using ( public.can_see_meeting(meeting_id) );
create policy maction_write on public.meeting_action_items for all to authenticated
  using ( public.can_edit_meeting(meeting_id) ) with check ( public.can_edit_meeting(meeting_id) );
