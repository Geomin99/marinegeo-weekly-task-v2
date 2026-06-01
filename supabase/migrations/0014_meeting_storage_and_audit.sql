-- 0014 회의록 Storage(비공개 버킷·경로 RLS) + 감사 로그 (voice 0009 거울)
insert into storage.buckets (id, name, public) values ('meeting-files','meeting-files', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('meeting-audio','meeting-audio', false) on conflict (id) do nothing;

-- 경로 규약: {meeting_id}/{file_id}/{filename} → foldername[1] = meeting_id
do $$ begin
  create policy meeting_files_select on storage.objects for select to authenticated
    using ( bucket_id = 'meeting-files' and public.can_see_meeting( ((storage.foldername(name))[1])::uuid ) );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy meeting_files_write on storage.objects for insert to authenticated
    with check ( bucket_id = 'meeting-files' and public.can_edit_meeting( ((storage.foldername(name))[1])::uuid ) );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy meeting_files_delete on storage.objects for delete to authenticated
    using ( bucket_id = 'meeting-files' and public.can_edit_meeting( ((storage.foldername(name))[1])::uuid ) );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy meeting_audio_select on storage.objects for select to authenticated
    using ( bucket_id = 'meeting-audio' and public.can_see_meeting( ((storage.foldername(name))[1])::uuid ) );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy meeting_audio_write on storage.objects for insert to authenticated
    with check ( bucket_id = 'meeting-audio' and public.can_edit_meeting( ((storage.foldername(name))[1])::uuid ) );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy meeting_audio_delete on storage.objects for delete to authenticated
    using ( bucket_id = 'meeting-audio' and public.can_edit_meeting( ((storage.foldername(name))[1])::uuid ) );
exception when duplicate_object then null; end $$;

create table if not exists public.meeting_audit_log (
  id bigint generated always as identity primary key,
  meeting_id uuid,
  actor_email text,
  action text,
  diff jsonb,
  at timestamptz default now()
);
alter table public.meeting_audit_log enable row level security;
create policy maudit_select on public.meeting_audit_log for select to authenticated
  using ( public.current_emp_role() = 'owner' );

create or replace function public.meeting_audit_trg() returns trigger
  language plpgsql security definer set search_path = public as $$
declare actor text := lower(coalesce(auth.jwt() ->> 'email','system'));
begin
  if (tg_op = 'DELETE') then
    insert into public.meeting_audit_log(meeting_id, actor_email, action, diff)
      values (old.id, actor, 'delete', jsonb_build_object('title', old.title, 'status', old.status));
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.meeting_audit_log(meeting_id, actor_email, action, diff)
      values (new.id, actor, 'update',
        jsonb_strip_nulls(jsonb_build_object(
          'status', case when new.status is distinct from old.status then jsonb_build_array(old.status, new.status) else null end,
          'visibility', case when new.visibility is distinct from old.visibility then jsonb_build_array(old.visibility, new.visibility) else null end,
          'deleted_at', case when new.deleted_at is distinct from old.deleted_at then to_jsonb(new.deleted_at) else null end
        )));
    return new;
  else
    insert into public.meeting_audit_log(meeting_id, actor_email, action, diff)
      values (new.id, actor, 'insert', jsonb_build_object('title', new.title, 'visibility', new.visibility));
    return new;
  end if;
end $$;

drop trigger if exists trg_meeting_audit on public.meetings;
create trigger trg_meeting_audit after insert or update or delete on public.meetings
  for each row execute function public.meeting_audit_trg();
