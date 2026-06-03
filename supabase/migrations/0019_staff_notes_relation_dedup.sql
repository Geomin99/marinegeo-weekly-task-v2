-- 0019 업무 메모 ↔ 출처 연결(받은편지함/주간업무 등) 중복 전환 방지
-- 같은 원본(related_module+related_id)에서 같은 작성자→같은 대상 직원으로 활성 메모는 1개만.
-- (원본 1개에서 여러 직원에게 각각 메모는 허용하려고 employee_id 포함)
-- 수동 메모(related_id is null)는 제약 대상 아님.
create unique index if not exists staff_notes_unique_active_relation
on public.staff_notes (related_module, related_id, author_email, employee_id)
where deleted_at is null and related_id is not null;
