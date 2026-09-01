# Mingalar Express — database

Phase 1: schema, guards, dispatch RPCs, RLS, storage policies.

## Layout

| Path | What |
|---|---|
| `migrations/…090100_init.sql` | 8 enums, 11 tables, constraints, indexes, grants |
| `migrations/…090200_triggers_rpc.sql` | role helpers, privilege guards, order state machine, COD ledger trigger, 5 dispatch RPCs + public tracking RPC |
| `migrations/…090300_rls.sql` | RLS policies for all 11 tables + immutability revokes |
| `migrations/…090400_storage.sql` | `delivery-proofs` and `avatars` buckets + policies |
| `seed.sql` | 4 role accounts, 8 Thingangyun wards, 1 shop, 3 riders, 2 pending orders |
| `tests/rls_smoke.sql` | 30 checks — the Phase 1 exit criteria |
| `tests/lifecycle_edge.sql` | 7 checks — unassign, prepaid, retry, stale ping, saturation |
| `tests/storage_policies.sql` | 9 checks — proof upload/read/delete scoping |
| `tests/00_local_shim.sql` | **local only** — stands up `storage.*` and the GoTrue columns the bare DB image lacks |
| `tests/reset_and_verify.sh` | reset → migrate → seed → run all three suites |

## Against a real Supabase project

```bash
supabase link --project-ref <ref>
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql        # dev/staging only
```

`tests/00_local_shim.sql` is **not** a migration. Never run it against a real project — Supabase's own `auth` and `storage` services own those objects.

## Local verification without the Supabase CLI

```bash
docker run -d --name mge-verify -e POSTGRES_PASSWORD=verify \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 55432:5432 \
  ghcr.io/supabase/postgres:17.6.1.158

docker exec -i mge-verify psql -U supabase_admin -d postgres < supabase/tests/00_local_shim.sql
docker exec mge-verify psql -U supabase_admin -d postgres -c \
  "alter table storage.buckets owner to postgres; alter table storage.objects owner to postgres;"

bash supabase/tests/reset_and_verify.sh
```

Expect `ALL PHASE 1 CHECKS PASSED`, `ALL EDGE CHECKS PASSED`, `ALL STORAGE CHECKS PASSED`.

## Seeded accounts — password `mingalar123`

| Email | Role |
|---|---|
| `admin@mingalar.test` | super_admin |
| `dispatch@mingalar.test` | dispatcher |
| `shop@mingalar.test` | shop_owner |
| `rider1@…` / `rider2@…` / `rider3@…` | rider (0.33 km / 1.6 km / 4.2 km from the seeded shop) |

## Before production

- **`VERIFY-CENTROID`** — every ward centroid in `seed.sql` is an unverified placeholder. Replace with surveyed points or real OSM boundary polygons.
- The `in_service_area()` bbox is a typo guard, not the township boundary. Widening it needs a migration (CHECK constraints cannot read tables); the tunable copy lives in `app_settings.bbox_*`.
- `tg_on_auth_user_created` trusts `raw_app_meta_data.role`. That is service-role-only and safe — but never move it to `raw_user_meta_data`, which clients can write.
- Add a Custom Access Token auth hook stamping `role` into `app_metadata` so middleware stops doing a DB round-trip per request.
