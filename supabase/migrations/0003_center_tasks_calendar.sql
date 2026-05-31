-- ============================================================
-- CenterDesk 완료→구글캘린더 연동 — center_tasks 컬럼 추가 (additive)
-- 작성: Claude code / 설계: Codex(포테토뭉) GO
-- 완료 처리 시 사용자 명시 동의(opt-in)로 MGEO 캘린더에 종일 이벤트 생성하고 그 id를 저장(중복 방지).
-- 헌법: 자동 생성/수정/삭제 금지 — 앱에서 명시 동의 시에만 호출.
-- ============================================================

alter table public.center_tasks add column if not exists google_calendar_event_id text;
alter table public.center_tasks add column if not exists calendar_created_at timestamptz;
