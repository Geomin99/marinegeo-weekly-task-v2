-- 0006: app_config — 서버 전용 설정/시크릿 보관 (Edge Function이 service_role로만 접근)
-- 용도: 일일 리마인드 Edge Function의 공유 시크릿. anon/authenticated 전면 차단(정책 없음 = service_role만).

create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
-- 정책을 두지 않음 → service_role(Edge Function)만 접근, 클라이언트(anon/authenticated)는 전면 차단

insert into public.app_config (key, value)
  values ('reminder_shared_secret', gen_random_uuid()::text)
  on conflict (key) do nothing;

comment on table public.app_config is '서버 전용 설정·시크릿. RLS 정책 없음 = service_role 전용. 클라이언트 접근 금지.';
