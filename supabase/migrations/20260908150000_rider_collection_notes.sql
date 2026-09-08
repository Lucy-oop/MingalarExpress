-- ============================================================================
--  MINGALAR EXPRESS  ·  0038 — A RIDER MAY LEAVE A NOTE ON A PARCEL
--
--  The collection card can already report a MISSING parcel: untick it, give a
--  reason, and `advance_orders` files it as an uncollected attempt that counts
--  against `max_collection_attempts`. That is the flow that makes a
--  chronically-short shop visible, and nothing here replaces it.
--
--  What a rider had no way to say is everything else. "Shutter closed early."
--  "New staff, did not know about us." "Shop says the rest come tomorrow."
--  Those are facts the office wants and no status transition carries.
--
--  ---------------------------------------------------------------------------
--  NO SCHEMA CHANGE, WHICH SURPRISED ME
--
--  `order_notes` is documented as a dispatch-only contact log -- "what the
--  office was told, by whom, over which channel" -- so I expected a rider note
--  to need a new table or a widened one. It does not. The shape already admits
--  it:
--
--      kind         check (kind in ('note','contact','decision'))
--      channel      nullable, and its CHECK permits null
--      party        nullable
--      author_role  user_role -- records WHO wrote it
--
--  So a rider's note is `kind = 'note'`, `channel = null`, `party = null`,
--  `author_role = 'rider'`. One policy is the whole change.
--
--  NOT A NEW `kind`. I first wrote `kind = 'collection'` and the CHECK refused
--  it, which was the right answer: `'note'` already means "a plain note, not a
--  contact log entry or a shop's decision", and `author_role` already says a
--  rider wrote it. A fourth kind would encode in two places what one column
--  already carries, and every reader of this table would have to learn it.
--
--  ---------------------------------------------------------------------------
--  INSERT ONLY. READING STAYS THE OFFICE'S.
--
--  `order_notes_read_dispatch` is not widened, deliberately. The log holds what
--  the office told a customer -- what was promised, what was refused, what a
--  shop was warned about -- and a rider carrying the parcel has no business in
--  it. Write-only access is unusual and correct here: the rider is a source,
--  not an audience.
--
--  The predicate mirrors `orders_read_rider`: `rider_id = auth.uid()`, so a
--  rider may annotate a parcel THEY ARE CARRYING and nothing else. `author_id =
--  auth.uid()` is kept from the dispatch policy so a note cannot be attributed
--  to somebody else.
--
--  Forward-only. Adding a policy grants; it revokes nothing.
-- ============================================================================

/*
  `order_notes` already has `grant select, insert ... to authenticated` and the
  sequence grant from 0017, so privileges need no change -- RLS is what was
  refusing the rider, and RLS is what this adds to.
*/
drop policy if exists order_notes_write_rider on public.order_notes;

create policy order_notes_write_rider on public.order_notes
  for insert to authenticated
  with check (
    public.is_rider()
    and author_id = auth.uid()
    /*
      THE PARCEL MUST BE THEIRS, and `exists` rather than a join because a
      policy is evaluated per row. `orders` is readable by this rider for
      exactly the same predicate (`orders_read_rider`), so the subquery adds no
      visibility they did not already have.
    */
    and exists (
      select 1 from public.orders o
       where o.id = order_id
         and o.rider_id = auth.uid()
    )
  );

comment on table public.order_notes is
  'Append-only note log against a parcel. The office records what it told whom '
  'over which channel; a RIDER may add kind = ''collection'' notes on a parcel '
  'they are carrying (0038) and cannot read the log back -- it holds what the '
  'office promised a customer, which is not a rider''s business.';
