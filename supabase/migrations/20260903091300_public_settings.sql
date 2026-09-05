-- ============================================================================
--  MINGALAR EXPRESS  ·  0024 — PUBLIC SETTINGS
--
--  Nine places in the app tell somebody to contact the office. Not one of them
--  says how:
--
--    "Your account has no shop yet. Ask the Mingalar Express office…"
--    "Contact your dispatcher."  "Contact the office."
--
--  The first is what EVERY shop sees the moment they finish signing up, and
--  there is no phone number anywhere in the product.
--
--  `app_settings.support_phone` has existed since 0001 and is already editable
--  at Super Admin -> Pricing. It has simply never been rendered to a user.
--
--  WHY A FUNCTION AND NOT A GRANT. The people who most need the number are the
--  ones who cannot sign in, so it has to reach the login and register pages --
--  and `settings_read_all` grants SELECT to `authenticated` only. Widening that
--  to anon would expose the whole row: pricing, commission percentages, the
--  bounding box, the KPay account name. This returns two fields and nothing
--  else, which makes "what is public" a decision recorded in one place rather
--  than a property of a grant somebody has to reason about.
--
--  Same door `track_order` uses, and for the same reason: "anon has no table
--  grants, so this definer function is its only door in."
--
--  Forward-only.
-- ============================================================================

set check_function_bodies = off;

create or replace function public.public_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- `app_settings` is a single-row table keyed by a boolean `id`.
  select jsonb_build_object(
    'brand_name',    s.brand_name,
    'support_phone', s.support_phone
  )
  from public.app_settings s
  where s.id
$$;

comment on function public.public_settings is
  'Brand name and support phone, for signed-out pages. Deliberately narrow: '
  'app_settings also holds pricing, commission and the KPay account, none of '
  'which anon may see. Widen this function, never the table grant.';

-- The whole point is the signed-out case; `authenticated` gets it too so the
-- shop panel reads the number the same way rather than through the table.
grant execute on function public.public_settings() to anon, authenticated;
