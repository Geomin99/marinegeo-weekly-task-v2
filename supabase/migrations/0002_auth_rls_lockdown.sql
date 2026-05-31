-- ============================================================
-- ERP 로그인 2단계 — RLS 잠금 (anon 차단, authenticated만 접근)
-- 작성: Claude code (토심이) / 설계: Codex(포테토뭉) 절충안 GO
-- 전제: Supabase Auth 도입(ID/PIN UX → email+password). 직원 3명 계정 사전 생성.
-- ⚠️ 적용 전 토뭉이님 GO 필요 (프로덕션 DB). 적용 시 비로그인(anon) 접근 즉시 차단됨.
--    → 반드시 (1) Auth 활성화 (2) 3명 계정 생성 (3) 앱 배포가 함께 가야 운영 단절 없음.
--
-- 원칙(포테토뭉): 3인 공용 데이터 → "authenticated면 전체 허용" 으로 충분.
--   행소유자 분리·역할 RLS는 후속 단계.
-- ============================================================

-- 공통: 기존 anon 개방 정책 제거 → authenticated 전용 정책으로 교체
-- (각 테이블 RLS 는 이미 enable 되어 있음)

-- 1) journal_entries (주간업무)
alter table public.journal_entries enable row level security;
drop policy if exists "Everyone can insert entries" on public.journal_entries;
drop policy if exists "Everyone can update entries" on public.journal_entries;
drop policy if exists "Everyone can delete entries" on public.journal_entries;
drop policy if exists "Everyone can read entries"   on public.journal_entries;
drop policy if exists "journal authenticated all"   on public.journal_entries;
create policy "journal authenticated all" on public.journal_entries
  for all to authenticated using (true) with check (true);

-- 2) leave_requests (휴가·출장)
alter table public.leave_requests enable row level security;
drop policy if exists "anon all leave_requests" on public.leave_requests;
drop policy if exists "leave_requests authenticated all" on public.leave_requests;
create policy "leave_requests authenticated all" on public.leave_requests
  for all to authenticated using (true) with check (true);

-- 3) leave_types
alter table public.leave_types enable row level security;
drop policy if exists "anon all leave_types" on public.leave_types;
drop policy if exists "leave_types authenticated all" on public.leave_types;
create policy "leave_types authenticated all" on public.leave_types
  for all to authenticated using (true) with check (true);

-- 4) annual_leave_balances
alter table public.annual_leave_balances enable row level security;
drop policy if exists "anon all annual_leave_balances" on public.annual_leave_balances;
drop policy if exists "annual_leave_balances authenticated all" on public.annual_leave_balances;
create policy "annual_leave_balances authenticated all" on public.annual_leave_balances
  for all to authenticated using (true) with check (true);

-- 5) center_tasks — 기존 anon 정책 제거 후 authenticated 로 재생성 (소프트삭제 규칙 유지)
drop policy if exists "center_tasks select active" on public.center_tasks;
drop policy if exists "center_tasks insert"        on public.center_tasks;
drop policy if exists "center_tasks update"        on public.center_tasks;

create policy "center_tasks select active" on public.center_tasks
  for select to authenticated using (deleted_at is null);
create policy "center_tasks insert" on public.center_tasks
  for insert to authenticated with check (true);
create policy "center_tasks update" on public.center_tasks
  for update to authenticated using (deleted_at is null) with check (true);
-- DELETE 정책 미부여 → 물리삭제 차단 유지

-- ※ 적용 후 확인: anon publishable 키만으로 위 테이블 select 가 0행/권한오류 인지 테스트.
