-- ============================================================================
--  MINGALAR EXPRESS  ·  0035 — WHEN DID THIS PERSON LAST LOOK
--
--  The office header is getting a notice feed, and a feed needs to know what is
--  NEW to the person reading it. One nullable timestamp per profile is the whole
--  mechanism.
--
--  ---------------------------------------------------------------------------
--  WHY NOT A NOTIFICATIONS TABLE
--
--  Because there is nothing to store. The notice "San Pya Mini Mart registered"
--  is not a fact in its own right -- it is `shops.created_at`, already recorded,
--  already RLS'd for the office by `shops_read_dispatch`. A table of notices
--  would be a second copy of that, kept in step by a trigger, able to drift, and
--  able to say a shop registered after the shop row was gone.
--
--  0016 is the cautionary tale: `notification_outbox` was a real queue with a
--  worker and retry semantics, and it was deleted six days later because the
--  operation did not want it. A queue earns its keep when something must be
--  DELIVERED -- an SMS, a push. Nothing here is delivered. It is read.
--
--  What genuinely cannot be derived is "have I seen it", because that is about
--  the reader and not the shop. So that is the only thing stored.
--
--  ---------------------------------------------------------------------------
--  WHY ON profiles
--
--  `profiles_update_self` already lets a user write their own row, and
--  `setLocale` has been using that path since the language switcher shipped.
--  `tg_profiles_guard` guards exactly two columns -- role and is_active -- so a
--  new one needs no exemption and cannot be used to escalate anything.
--
--  Per USER, not per browser. localStorage would have avoided this migration and
--  would also have given one dispatcher three different unread counts on the
--  office desktop, their phone and the laptop at the hub.
--
--  NULL means "has never opened the feed", which the count treats as "everything
--  is new" rather than "nothing is". A dispatcher's first shift should show them
--  the backlog, not an empty bell.
--
--  Forward-only. Adding a nullable column rewrites nothing.
-- ============================================================================

alter table public.profiles
  add column if not exists notices_seen_at timestamptz;

comment on column public.profiles.notices_seen_at is
  'When this person last opened the office notice feed. NULL means never, and '
  'the unseen count reads that as "everything is new". Written by the reader '
  'themselves through profiles_update_self -- it is a fact about them, not '
  'about any shop, which is why it is the only part of a notice that is stored '
  'rather than derived.';
