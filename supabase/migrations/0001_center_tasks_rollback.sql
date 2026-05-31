-- ============================================================
-- CenterDesk 1단계 롤백 — center_tasks 전체 제거
-- 작성: Claude code (토심이)
-- 주의: center_tasks 데이터가 모두 삭제됩니다. apply 전 상태로 복귀용.
-- ============================================================

drop trigger if exists center_tasks_set_updated_at on public.center_tasks;
drop function if exists public.center_tasks_set_updated_at();
drop table if exists public.center_tasks cascade;
