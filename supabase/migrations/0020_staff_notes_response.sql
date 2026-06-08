-- 0020 staff_notes 후속조치 답변 — 담당자 본인이 진행 상태·답변 갱신
-- 포테토뭉 권고(2026-06-08): 옵션 3 (상태 + 단일 응답).
-- 댓글 스레드는 2단계 확장으로 보류. 직원 일반 UPDATE 정책 추가 X → RPC만 제공.

-- 1) 응답 컬럼 추가
alter table public.staff_notes
  add column if not exists response_text text,
  add column if not exists response_at timestamptz,
  add column if not exists response_by text;

-- 2) 직원 응답 RPC — SECURITY DEFINER로 안전하게 컬럼 제한 갱신
--    허용: 본인(employee_id = auth.email()) + visibility ∈ {employee,team}
--    허용 status: open / in_progress / done
--    갱신 대상: status, response_text, response_at, response_by, resolved_at(done 시), updated_at
create or replace function public.staff_note_respond(
  p_id uuid,
  p_status text,
  p_response_text text
)
returns public.staff_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note public.staff_notes;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  if p_status not in ('open', 'in_progress', 'done') then
    raise exception 'invalid status: %', p_status;
  end if;

  update public.staff_notes
     set status = p_status,
         response_text = nullif(trim(p_response_text), ''),
         response_at = now(),
         response_by = v_email,
         resolved_at = case when p_status = 'done' then now() else resolved_at end,
         updated_at = now()
   where id = p_id
     and lower(employee_id) = v_email
     and deleted_at is null
     and visibility in ('employee', 'team')
   returning * into v_note;

  if not found then
    raise exception 'note not found or not permitted';
  end if;

  return v_note;
end;
$$;

revoke all on function public.staff_note_respond(uuid, text, text) from public, anon;
grant execute on function public.staff_note_respond(uuid, text, text) to authenticated;

comment on function public.staff_note_respond is
  '담당자(employee_id 본인)가 본인에게 공유된 메모(visibility employee/team)의 status·response_text를 갱신. 허용 status: open/in_progress/done. 0020 포테토뭉 권고.';
