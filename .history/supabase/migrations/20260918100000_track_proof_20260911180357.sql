-- ============================================================================
-- 0046. THE DELIVERY PHOTO ON THE PUBLIC TRACKING PAGE
--
-- ----------------------------------------------------------------------------
-- THIS DELIBERATELY WIDENS A PAYLOAD THAT SAYS "DO NOT WIDEN ME"
--
-- `app/track/[code]/page.tsx` has carried this since it was written:
--
--     "returns a deliberately narrow payload: no phone number, no street
--      address, no rider identity. Do not widen that RPC to 'make the page
--      nicer' -- anyone with a code can call it."
--
-- That warning is still correct, and the owner was shown it before this change
-- was made. Recording the decision here so the next reader finds a choice
-- rather than a contradiction.
--
-- WHAT THE OWNER WAS TOLD, and accepted:
--
--   `orders.code` is 'MGE-' || YYMMDD || lpad(nextval('order_seq'), 6, '0')
--   (init.sql:238) -- a GLOBAL MONOTONIC SEQUENCE. Codes are therefore
--   enumerable: from one known code the whole corpus is a few thousand
--   guesses, and `track_order` is granted to `anon` with no second factor and
--   no rate limit.
--
--   So a delivery photo here is public in practice, not merely unlisted. It
--   can show a customer's door, their house number, and sometimes the customer.
--   Everything else on the page -- shop, township, timings -- is already
--   exposed the same way; the photo is a step up in kind, not just in degree.
--
-- The alternatives offered were: a last-4-digits-of-phone check before
-- revealing it, unguessable codes, or keeping it behind a login. The owner
-- chose open. If that is ever revisited, the gate goes here, in this function.
--
-- ----------------------------------------------------------------------------
-- WHAT IS AND IS NOT ADDED
--
-- ONE FIELD, and only on a delivered parcel. `proof_photo_path` is an object
-- path in a PRIVATE bucket, not a URL -- it is useless on its own. The tracking
-- page signs it server-side and sends only the signed link to the browser, so
-- the path itself never leaves the server and `anon` gains NO storage access.
-- That matters: a storage policy for `anon` would have let anyone read any
-- proof by guessing a path, which is strictly worse than this.
--
-- NOTHING ELSE MOVES. No phone, no street address, no rider identity, no COD
-- figure. The warning above still governs every other field.
--
-- `case when status = 'delivered'` rather than returning it unconditionally: a
-- parcel that failed may still carry a proof photo from an earlier attempt, and
-- a failed delivery's photograph is not something a tracking page should serve.
-- ============================================================================

create or replace function public.track_order(p_code text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'code',        o.code,
    'status',      o.status,
    'shop_name',   sh.name,
    'dropoff_area', da.name,
    'is_cod',      (o.payment_method = 'cod'),
    'created_at',  o.created_at,
    'picked_up_at',o.picked_up_at,
    'delivered_at',o.delivered_at,
    -- 0046. Delivered parcels only. An object path, not a URL: the page signs
    -- it server-side and the browser never sees this value.
    'proof_photo_path',
      case when o.status = 'delivered' then o.proof_photo_path else null end,
    'timeline',    coalesce((
      select jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at)
                       order by e.created_at)
        from public.order_status_events e where e.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.shops sh on sh.id = o.shop_id
  left join public.service_areas da on da.id = o.dropoff_area_id
  where upper(o.code) = upper(trim(p_code))
$$;

comment on function public.track_order is
  'Public parcel tracking, granted to anon. The payload is deliberately narrow '
  '-- no phone, no street address, no rider identity, no COD figure -- because '
  'order codes come from a global sequence and are therefore enumerable. '
  '0046 added proof_photo_path on DELIVERED parcels only, as an explicit '
  'owner decision recorded in that migration; it is an object path in a '
  'private bucket, signed server-side, so anon gains no storage access. Do not '
  'widen this further without the same deliberation.';

grant execute on function public.track_order(text) to anon, authenticated;
