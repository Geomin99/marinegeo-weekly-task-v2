-- 0008: 업무 통화 로그 (geomin99 전용) — 테이블 + RLS + 비공개 Storage
-- 설계: 포테토뭉(Codex) 정식 리뷰. 전사=로컬 whisper, 요약=토심이(반자동). 외부전송 기본 금지.
-- 권한: owner_user_id=auth.uid() AND jwt email=geomin99 (RLS). 프론트 메뉴 숨김은 UX일 뿐.

do $$ begin
  create type voice_call_status as enum
    ('uploaded','pending','processing','transcribed','summarized','completed','failed');
exception when duplicate_object then null; end $$;

create table if not exists public.voice_call_logs (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null,
  created_by          text,
  -- 기본 정보
  call_date           timestamptz,
  title               text,
  organization_name   text,
  contact_person      text,
  phone_number        text,
  -- 업무 연결
  related_project_id   uuid,
  related_project_name text,
  related_category     text,
  counterparty_id      uuid,
  center_id            uuid,
  participants         jsonb,
  -- 파일(원본은 비공개 Storage)
  storage_path        text,
  original_filename   text,
  mime_type           text,
  size_bytes          bigint,
  duration_seconds    real,
  sha256              text,
  -- 처리 상태
  status              voice_call_status not null default 'uploaded',
  processing_started_at timestamptz,
  processed_at        timestamptz,
  error_code          text,
  error_message       text,
  retry_count         int default 0,
  worker_id           text,
  -- 전사
  transcript_text     text,
  transcript_segments jsonb,
  language            text,
  stt_engine          text,
  stt_model           text,
  -- 요약/추출 (AI 초안 vs 확정 구분)
  summary_text        text,
  summary_json        jsonb,
  extraction_model    text,
  key_points          jsonb,
  decisions           jsonb,
  requests            jsonb,
  action_items        jsonb,
  due_dates           jsonb,
  follow_up_required  boolean default false,
  is_confirmed        boolean default false,
  -- 보안/감사/보존
  sensitivity         text default 'internal',
  tags                jsonb,
  external_processing_used boolean default false,
  external_provider   text,
  retention_until     date,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists voice_call_logs_owner_idx
  on public.voice_call_logs (owner_user_id, status, call_date desc);

alter table public.voice_call_logs enable row level security;
drop policy if exists voice_owner_all on public.voice_call_logs;
create policy voice_owner_all on public.voice_call_logs
  for all to authenticated
  using (owner_user_id = auth.uid() and (auth.jwt() ->> 'email') = 'geomin99@gmail.com')
  with check (owner_user_id = auth.uid() and (auth.jwt() ->> 'email') = 'geomin99@gmail.com');

comment on table public.voice_call_logs is
  '업무 통화 로그(geomin99 전용). 원본 음성=비공개 Storage voice-calls. 전사=로컬 whisper, 요약=반자동. RLS owner+email.';

-- ── 비공개 Storage 버킷 + geomin99 전용 정책 ──
insert into storage.buckets (id, name, public)
  values ('voice-calls', 'voice-calls', false)
  on conflict (id) do nothing;

drop policy if exists "voice obj select own" on storage.objects;
drop policy if exists "voice obj insert own" on storage.objects;
drop policy if exists "voice obj delete own" on storage.objects;
create policy "voice obj select own" on storage.objects for select to authenticated
  using (bucket_id = 'voice-calls' and owner = auth.uid() and (auth.jwt() ->> 'email') = 'geomin99@gmail.com');
create policy "voice obj insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice-calls' and owner = auth.uid() and (auth.jwt() ->> 'email') = 'geomin99@gmail.com');
create policy "voice obj delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'voice-calls' and owner = auth.uid() and (auth.jwt() ->> 'email') = 'geomin99@gmail.com');
