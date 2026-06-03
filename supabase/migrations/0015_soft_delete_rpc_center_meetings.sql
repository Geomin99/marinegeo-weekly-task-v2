-- 0015 soft-delete RLS 충돌 수정 (center_tasks·meetings)
-- 증상: 'update set deleted_at' → ERROR 42501 new row violates row-level security policy
-- 원인: SELECT 정책이 deleted_at IS NULL 요구 → UPDATE 후 새(삭제) 행이 SELECT 통과 못 함
-- 해결: SELECT 정책은 그대로(목록=활성만), soft-delete만 SECURITY DEFINER 함수로 우회
-- 비고: voice_call_logs는 SELECT가 owner만(=geomin99)이고 deleted_at 제한 없어 영향 없음

create or replace function public.center_task_soft_delete(p_id bigint) returns void
  language sql security definer set search_path = public as $$
  update public.center_tasks set deleted_at = now() where id = p_id and deleted_at is null;
$$;
revoke all on function public.center_task_soft_delete(bigint) from public;
grant execute on function public.center_task_soft_delete(bigint) to authenticated;

create or replace function public.meeting_soft_delete(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_meeting(p_id) then
    raise exception 'not allowed to delete this meeting';
  end if;
  update public.meetings set deleted_at = now() where id = p_id and deleted_at is null;
end $$;
revoke all on function public.meeting_soft_delete(uuid) from public;
grant execute on function public.meeting_soft_delete(uuid) to authenticated;
