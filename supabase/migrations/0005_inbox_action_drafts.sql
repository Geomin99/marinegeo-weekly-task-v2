-- 0005: 받은편지함 업무 추출 초안 (A안) — 개인 전용 테이블 + RLS owner 강제
-- 설계: 포테토뭉(Codex) 정식 리뷰. center_tasks 재활용 반대 → 신규 테이블.
-- 원문 미저장(마스킹 필드만), owner_user_id = auth.uid() 만 접근, gmail_message_id unique(soft-delete 포함 dedupe).

create table if not exists public.inbox_action_drafts (
  id                  uuid primary key default gen_random_uuid(),
  gmail_message_id    text not null unique,
  gmail_thread_id     text,
  gmail_link          text,
  subject_masked      text,
  sender_name_masked  text,
  sender_email_domain text,
  received_at         timestamptz not null,
  category            text check (category in ('client_or_project','school_industry','center','admin_tax','personal_review','other')),
  status              text not null default 'needs_review' check (status in ('needs_review','draft','done','archived')),
  priority            text not null default 'normal'       check (priority in ('urgent','high','normal','low')),
  due_date            date,
  summary_masked      text,
  evidence_flags      jsonb not null default '{}'::jsonb,
  source              text not null default 'gmail_inbox',
  created_by          text not null,
  owner_user_id       uuid not null,
  deleted_at          timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 주민/사업자번호 패턴 차단(마스킹 보조 안전망)
alter table public.inbox_action_drafts
  add constraint inbox_action_drafts_no_rrn check (
    coalesce(subject_masked, '')     !~ '[0-9]{6}-?[0-9]{7}'
    and coalesce(summary_masked, '') !~ '[0-9]{6}-?[0-9]{7}'
    and coalesce(sender_name_masked, '') !~ '[0-9]{6}-?[0-9]{7}'
  );

create index if not exists inbox_action_drafts_owner_idx
  on public.inbox_action_drafts (owner_user_id, status, received_at desc);

-- RLS: 본인(owner) 행만 접근. service role(서버측 insert)은 RLS 우회.
alter table public.inbox_action_drafts enable row level security;
drop policy if exists inbox_action_drafts_owner_all on public.inbox_action_drafts;
create policy inbox_action_drafts_owner_all on public.inbox_action_drafts
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

comment on table public.inbox_action_drafts is
  '받은편지함 업무 추출 초안(A안). 개인 전용·RLS owner. 원문 미저장(마스킹 필드만). 보존 기본 90일(expires_at).';
