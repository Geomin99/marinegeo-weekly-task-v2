-- 0009: voice-calls Storage 정책 수정 — owner=auth.uid() 조건은 업로드 시점에 막혀 실패하므로
--        경로 기반(첫 폴더 = owner uid)으로 교체. 여전히 geomin99 전용.
-- 경로 규칙: voice-calls/{owner_uid}/{log_id}/{filename}

drop policy if exists "voice obj select own" on storage.objects;
drop policy if exists "voice obj insert own" on storage.objects;
drop policy if exists "voice obj delete own" on storage.objects;

create policy "voice obj select own" on storage.objects for select to authenticated
  using (bucket_id = 'voice-calls'
         and (auth.jwt() ->> 'email') = 'geomin99@gmail.com'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "voice obj insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice-calls'
         and (auth.jwt() ->> 'email') = 'geomin99@gmail.com'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "voice obj delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'voice-calls'
         and (auth.jwt() ->> 'email') = 'geomin99@gmail.com'
         and (storage.foldername(name))[1] = auth.uid()::text);
