-- 0016 보안 어드바이저 하드닝: SECURITY DEFINER 함수의 anon 실행 차단 (앱은 authenticated 전용)
revoke execute on function public.current_emp_role() from anon;
revoke execute on function public.current_emp_name() from anon;
revoke execute on function public.can_see_meeting(uuid) from anon;
revoke execute on function public.can_edit_meeting(uuid) from anon;
revoke execute on function public.is_meeting_participant(uuid) from anon;
revoke execute on function public.center_task_soft_delete(bigint) from anon;
revoke execute on function public.meeting_soft_delete(uuid) from anon;

-- 트리거 함수는 RPC로 직접 호출될 필요 없음 → 전 롤에서 EXECUTE 회수(트리거 동작엔 영향 없음)
revoke execute on function public.meeting_audit_trg() from public, anon, authenticated;
revoke execute on function public.center_tasks_set_updated_at() from public, anon, authenticated;
