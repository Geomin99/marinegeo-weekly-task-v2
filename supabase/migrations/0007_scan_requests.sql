-- 0007: scan_requests — '메일 분석' 버튼 요청큐 (앱 버튼 → 회사 PC watcher 처리)
-- 설계: 포테토뭉(Codex) 정식 리뷰 A안.
-- RLS: 본인(owner)만 insert/select. update/delete는 정책 없음 → service_role(worker)만.

do $$ begin
  create type scan_request_status as enum ('pending','running','done','failed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type scan_request_scope as enum ('center','inbox','both');
exception when duplicate_object then null; end $$;

create table if not exists public.scan_requests (
  id                        uuid primary key default gen_random_uuid(),
  owner                     uuid not null,
  scope                     scan_request_scope  not null default 'both',
  status                    scan_request_status not null default 'pending',
  requested_by              uuid not null,
  requested_at              timestamptz not null default now(),
  started_at                timestamptz,
  finished_at               timestamptz,
  center_created_count      int default 0,
  inbox_draft_created_count int default 0,
  skipped_count             int default 0,
  error_message             text,
  worker_id                 text,
  request_key               text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- owner별 pending/running 은 하나만(연타·중복 방지)
create unique index if not exists scan_requests_one_active_per_owner
  on public.scan_requests(owner) where status in ('pending','running');
create index if not exists scan_requests_status_idx
  on public.scan_requests(status, requested_at);

alter table public.scan_requests enable row level security;
drop policy if exists scan_req_select_own on public.scan_requests;
drop policy if exists scan_req_insert_own on public.scan_requests;
create policy scan_req_select_own on public.scan_requests
  for select to authenticated using (owner = auth.uid());
create policy scan_req_insert_own on public.scan_requests
  for insert to authenticated with check (owner = auth.uid() and requested_by = auth.uid());
-- update/delete 정책 없음 → worker(service_role)만 상태 전이

-- kill-switch (worker 가 매 루프 확인)
insert into public.app_config (key, value) values ('mail_scan_enabled', 'true')
  on conflict (key) do nothing;

comment on table public.scan_requests is '메일 분석 버튼 요청큐. owner=요청자, worker(회사 PC)가 service_role로 처리. owner별 활성 1개.';
