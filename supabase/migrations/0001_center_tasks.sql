-- ============================================================
-- CenterDesk 1단계 — center_tasks (해양벤처센터 행정 업무판)
-- 작성: Claude code (토심이) / 검증: Codex(포테토뭉) 조건부 GO
-- 적용 전 토뭉이님 GO 필요 (Supabase apply + Vercel 배포 게이트)
--
-- 설계 원칙 (포테토뭉 합의):
--  - 앱에 Supabase Auth 없음 → 기존 anon 구조 유지, center_tasks 단독 authenticated 잠금 X
--  - 메타데이터만 저장. 파일은 W:\2. 해양벤처진흥센터 에 유지(앱은 폴더경로만)
--  - 저장 금지: 파일명/메일본문 전문/명부 내용/주민번호/계좌/연락처 목록
--  - 최소 하드닝: 물리삭제 금지(soft delete), 조회는 deleted_at IS NULL, 주민번호 DB CHECK
-- ============================================================

create table if not exists public.center_tasks (
  id            bigint generated always as identity primary key,

  -- 핵심 메타
  title         text not null,                 -- 메일 제목 / 업무명 (파일명·본문 전문 금지)
  sender        text,                          -- 보낸 사람/기관 (도메인 또는 기관명 권장)
  category      text not null default '제출업무'
                check (category in ('공공요금','제출업무','지원사업','교육·시설','입주·계약')),
  status        text not null default '신규'
                check (status in ('신규','확인필요','자료준비','승인대기','제출완료','보관')),
  priority      text not null default '보통'
                check (priority in ('높음','보통','낮음')),

  -- 일정
  received_date date,                          -- 수신일
  due_date      date,                          -- 마감일 (nullable)
  fiscal_year   integer,                       -- 회계연도 (예: 2026)
  is_recurring  boolean not null default false,-- 연단위 반복 업무 여부

  -- 처리/연결
  assignee      text,                          -- 담당자
  w_path        text,                          -- W:\2. 해양벤처진흥센터\... 폴더 경로 (폴더까지만)
  gmail_message_id text,                       -- Gmail 메시지 id (URL은 표시 시 조립, 중복방지 키)
  source        text not null default 'manual' -- 생성 출처: 수동 입력 / 메일 인제스천
                check (source in ('manual','email')),
  submitted     boolean not null default false,-- 외부 제출/회신 완료 여부
  submitted_at  timestamptz,
  completed_at  timestamptz,
  note          text,                          -- 메모 (개인정보 입력 금지)

  -- 감사
  created_at    timestamptz not null default now(),
  created_by    text,
  updated_at    timestamptz not null default now(),
  updated_by    text,
  deleted_at    timestamptz,                   -- soft delete

  -- 개인정보 1차 DB 차단: 주민등록번호 패턴 (고정밀, 오탐 최소)
  constraint center_tasks_no_rrn check (
        coalesce(title,    '') !~ '[0-9]{6}-?[0-9]{7}'
    and coalesce(note,     '') !~ '[0-9]{6}-?[0-9]{7}'
    and coalesce(w_path,   '') !~ '[0-9]{6}-?[0-9]{7}'
    and coalesce(sender,   '') !~ '[0-9]{6}-?[0-9]{7}'
    and coalesce(assignee, '') !~ '[0-9]{6}-?[0-9]{7}'
  ),

  -- w_path 는 폴더 경로까지만: 파일명(확장자) 저장 금지
  constraint center_tasks_wpath_folder_only check (
    w_path is null
    or w_path !~* '\.(pdf|xlsx?|hwpx?|docx?|pptx?|zip|jpe?g|png|csv|txt|seg?y)$'
  )
);

comment on table public.center_tasks is 'CenterDesk: 해양벤처센터 행정 업무 메타데이터. 파일 실물은 W:\2. 해양벤처진흥센터. 개인정보 저장 금지.';

-- 인덱스 (활성 행 기준)
create index if not exists center_tasks_status_idx on public.center_tasks (status)   where deleted_at is null;
create index if not exists center_tasks_due_idx    on public.center_tasks (due_date) where deleted_at is null;

-- 메일 인제스천 중복방지: gmail_message_id 부분 UNIQUE (재실행 시 중복 insert 차단)
create unique index if not exists center_tasks_gmail_uq
  on public.center_tasks (gmail_message_id) where gmail_message_id is not null;

-- updated_at 자동 갱신 트리거 (center_tasks 전용 함수명으로 충돌 방지)
create or replace function public.center_tasks_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists center_tasks_set_updated_at on public.center_tasks;
create trigger center_tasks_set_updated_at
  before update on public.center_tasks
  for each row execute function public.center_tasks_set_updated_at();

-- ── RLS: 기존 앱과 동일하게 anon 운용, 단 물리삭제 금지 + 삭제행 비노출 ──
alter table public.center_tasks enable row level security;

-- 조회: 삭제되지 않은 행만 (anon/authenticated)
drop policy if exists "center_tasks select active" on public.center_tasks;
create policy "center_tasks select active" on public.center_tasks
  for select to anon, authenticated
  using (deleted_at is null);

-- 삽입
drop policy if exists "center_tasks insert" on public.center_tasks;
create policy "center_tasks insert" on public.center_tasks
  for insert to anon, authenticated
  with check (true);

-- 수정 (활성 행만 대상 → 삭제된 행 편집·되살리기 차단. soft delete = deleted_at 설정도 update 경로)
drop policy if exists "center_tasks update" on public.center_tasks;
create policy "center_tasks update" on public.center_tasks
  for update to anon, authenticated
  using (deleted_at is null) with check (true);

-- DELETE 정책은 의도적으로 부여하지 않음 → 물리삭제 차단 (soft delete만 허용)
-- ※ 복구(deleted_at → null)는 anon에 미허용. 필요 시 service_role/콘솔 또는 별도 복구 정책으로 처리.
