-- 0004: LeaveGUI ↔ MGEO 캘린더 동기화 상태 추적
-- 목적: 수정 건(휴가↔출장·날짜·목적지·상태 변경)이 캘린더에 재반영되지 않던 버그 근본 수정.
--       signature 기반 dirty detection 으로 신규/수정/취소를 한 흐름에서 처리.
-- 설계: 포테토뭉(Codex) 정식 리뷰 A' 권고. 비파괴 additive nullable 컬럼.

alter table public.leave_requests
  add column if not exists calendar_synced_at      timestamptz,
  add column if not exists calendar_sync_signature text,
  add column if not exists calendar_sync_error     text;

comment on column public.leave_requests.calendar_sync_signature is
  '마지막으로 구글 캘린더에 성공 반영한 시점의 동기화 대상 필드 signature. 현재 signature와 다르면 dirty(재PATCH 대상).';
