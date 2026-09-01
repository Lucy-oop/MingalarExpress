-- ============================================================================
--  MINGALAR EXPRESS  ·  0004 — STORAGE (delivery proof photos)
--
--  Private bucket. Delivery proofs contain customer doors, faces and addresses;
--  they are never publicly readable. Clients get short-lived signed URLs.
--
--  Path convention (enforced by the policies below):
--      delivery-proofs/<order_id>/<uuid>.webp
--  storage.foldername(name)[1] is therefore the order id.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-proofs', 'delivery-proofs', false,
  5242880,                                            -- 5 MB hard cap
  array['image/jpeg','image/webp','image/png']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Avatars: small, private, one folder per user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- delivery-proofs
-- ----------------------------------------------------------------------------

-- The assigned rider may upload, but only while the order is actually live.
-- A delivered order is closed: no more photos.
create policy proofs_insert_rider on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'delivery-proofs'
    and array_length(storage.foldername(name), 1) >= 1
    and exists (
      select 1 from public.orders o
       where o.id = (storage.foldername(name))[1]::uuid
         and o.rider_id = auth.uid()
         and o.status in ('assigned','picked_up')
    )
  );

-- Readable by: the rider who delivered it, the shop that sent it, dispatch/admin.
create policy proofs_read_parties on storage.objects
  for select to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and array_length(storage.foldername(name), 1) >= 1
    and exists (
      select 1 from public.orders o
       where o.id = (storage.foldername(name))[1]::uuid
         and (o.rider_id = auth.uid()
              or public.owns_shop(o.shop_id)
              or public.is_dispatch())
    )
  );

-- Proof photos are evidence in COD disputes. Only Super Admin may delete, and
-- there is deliberately no UPDATE policy (no silent overwrite of a proof).
create policy proofs_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'delivery-proofs' and public.is_admin());


-- ----------------------------------------------------------------------------
-- avatars  — own folder only
-- ----------------------------------------------------------------------------

create policy avatars_rw_self on storage.objects
  for all to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_read_dispatch on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and public.is_dispatch());
