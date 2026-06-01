-- 0012 회의록 — 테이블·enum·인덱스 (voice_call_logs 0008 거울, AI 컬럼 동일 계약)
create extension if not exists pg_trgm;

do $$ begin
  create type meeting_status as enum ('draft','transcribing','summarized','reviewing','confirmed','follow_up','done');
exception when duplicate_object then null; end $$;
do $$ begin
  create type meeting_visibility as enum ('all','participants','admin','owner_only');
exception when duplicate_object then null; end $$;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid,
  created_by text,
  created_by_email text,
  meeting_date timestamptz,
  title text not null,
  meeting_type text,
  location text,
  meeting_method text,
  agenda jsonb,
  minutes_text text,
  status meeting_status not null default 'draft',
  visibility meeting_visibility not null default 'participants',
  input_method text check (input_method in ('manual','audio','paste')),
  related_project_id uuid,
  related_project_name text,
  related_organization text,
  related_category text,
  transcript_text text,
  transcript_segments jsonb,
  language text,
  stt_engine text,
  stt_model text,
  summary_text text,
  summary_json jsonb,
  extraction_model text,
  key_points jsonb,
  decisions jsonb,
  action_items jsonb,
  due_dates jsonb,
  follow_up_required boolean default false,
  is_confirmed boolean default false,
  processing_started_at timestamptz,
  processed_at timestamptz,
  error_code text,
  error_message text,
  retry_count int default 0,
  worker_id text,
  sensitivity text default 'internal',
  external_processing_used boolean default false,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  email text,
  display_name text,
  org_name text,
  role text,
  is_internal boolean default true,
  attended boolean default true,
  confirmed boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.meeting_files (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  kind text,
  storage_path text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  duration_seconds numeric,
  pasted_text text,
  uploaded_by text,
  created_at timestamptz default now()
);

create table if not exists public.meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  task text,
  assignee_email text,
  assignee_name text,
  due_date date,
  status text default 'open',
  source text default 'ai_draft',
  importance text,
  confirmed_by text,
  calendar_event_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_meetings_owner_status_date on public.meetings (owner_user_id, status, meeting_date desc);
create index if not exists idx_meetings_vis_date on public.meetings (visibility, meeting_date desc);
create index if not exists idx_meetings_created_email on public.meetings (created_by_email);
create index if not exists idx_mparticipants_meeting on public.meeting_participants (meeting_id);
create index if not exists idx_mparticipants_email on public.meeting_participants (meeting_id, lower(email));
create index if not exists idx_maction_assignee on public.meeting_action_items (assignee_email, status, due_date);
create index if not exists idx_meetings_trgm on public.meetings using gin ((coalesce(title,'') || ' ' || coalesce(summary_text,'') || ' ' || coalesce(transcript_text,'')) gin_trgm_ops);
