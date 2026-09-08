'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Coins, MapPinned, Phone, StickyNote, Store, Truck } from 'lucide-react'
import type { CollectionGroup } from '@/lib/rider/collection'
import { advanceOrders, saveCollectionNote } from '@/lib/rider/actions'
import { enqueue } from '@/lib/rider/offline-queue'
import { explainRiderError } from '@/lib/rider/errors'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatMmk } from '@/lib/utils'
import { quoteTripPay } from '@/lib/pricing'
import { localeNumber } from '@/lib/i18n'

/**
 * One visit to a shop, not ten parcels that happen to share an address.
 *
 * THE PROBLEM. A shop books ten parcels and the dispatcher loads all ten onto
 * one collection run. The rider's feed was ten separate rows, each showing an
 * address, sorted by distance and interleaved with every other shop's parcels —
 * and recording what was physically one armful off one counter meant opening
 * ten job pages and pressing a button on each. Twenty-odd taps, on a phone with
 * two bars, while the shopkeeper waits.
 *
 * TICKED BY DEFAULT, because the shop handing over everything it booked is the
 * normal case and should cost one tap. A shop that is one parcel short costs one
 * untick, and the parcel left behind stays `assigned` and stays on this card —
 * which is what makes the short case safe rather than silent.
 *
 * ONE TRANSACTION ONLINE, N ENTRIES OFFLINE. `advance_orders` moves the whole
 * armful or none of it, so there is no half-collected state for the rider to
 * discover later. With no signal each parcel is queued on its own instead: the
 * atomicity is worth less than the guarantee that one parcel which has moved on
 * cannot discard the other nine.
 */
export function CollectionCard({
  group,
  pickupRate,
}: {
  group: CollectionGroup
  /** `app_settings.route_pickup_rate` — see the note on the figure below. */
  pickupRate: number
}) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [, startTransition] = useTransition()

  const ids = group.jobs.map((j) => j.id)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(ids))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const [why, setWhy] = useState('')

  /*
    A parcel can leave this group under the rider's hands — another run takes
    it, or the office cancels it — and the board refreshes on any order change.
    Prune rather than send an id that is no longer here, which `advance_orders`
    would reject for the whole armful.
  */
  useEffect(() => {
    setTicked((prev) => {
      const next = new Set([...prev].filter((id) => ids.includes(id)))
      return next.size === prev.size ? prev : next
    })
    // `ids` is derived from props each render, so compare by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')])

  const chosen = group.jobs.filter((j) => ticked.has(j.id))
  const cash = chosen.reduce(
    (sum, j) => sum + (j.paymentMethod === 'cod' ? j.codAmount : 0),
    0,
  )
  const n = (v: number) => localeNumber(locale, v)

  async function collect() {
    if (chosen.length === 0) {
      setError(t('collection.nothingTicked'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await advanceOrders({ orderIds: chosen.map((j) => j.id), to: 'picked_up' })
      if (result.ok) {
        setDone(true)
        startTransition(() => router.refresh())
        return
      }
      const explained = explainRiderError(`${result.message} ${result.kind}`)
      if (explained.kind === 'network') {
        // One entry per parcel. See the note above.
        for (const job of chosen) {
          await enqueue({ kind: 'picked_up', orderId: job.id, orderCode: job.code })
        }
        setQueued(true)
        setDone(true)
        setError(null)
        startTransition(() => router.refresh())
        return
      }
      setError(explained.message)
    } catch {
      for (const job of chosen) {
        await enqueue({ kind: 'picked_up', orderId: job.id, orderCode: job.code })
      }
      setQueued(true)
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  /*
    REPORTING IS NOT UNTICKING. Unticking says "not on this armful" and leaves
    the parcel for later on the same run. Reporting says "the shop did not have
    it", which goes onto that parcel as `assigned -> failed` with a reason --
    the UNCOLLECTED attempt 0018 counts against max_collection_attempts, so a
    shop that is short every morning stops being invisible.
  */
  const missing = group.jobs.filter((j) => !ticked.has(j.id))

  /**
   * Saved against every parcel in the group, so the office sees it wherever it
   * opens the collection from. Failure is reported and stopped rather than
   * queued: a lost note costs a sentence, where a lost checkpoint costs a
   * parcel's state — which is why only the latter has an offline queue.
   */
  async function saveNote() {
    const body = note.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      const result = await saveCollectionNote({ orderIds: ids, body })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setNote('')
      setNoting(false)
      startTransition(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }

  async function report() {
    if (missing.length === 0 || !why.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await advanceOrders({
        orderIds: missing.map((j) => j.id),
        to: 'failed',
        reason: why.trim(),
      })
      if (result.ok) {
        setReporting(false)
        setWhy('')
        startTransition(() => router.refresh())
        return
      }
      const explained = explainRiderError(`${result.message} ${result.kind}`)
      if (explained.kind === 'network') {
        for (const job of missing) {
          await enqueue({
            kind: 'failed',
            orderId: job.id,
            orderCode: job.code,
            reason: why.trim(),
          })
        }
        setQueued(true)
        setReporting(false)
        setWhy('')
        startTransition(() => router.refresh())
        return
      }
      setError(explained.message)
    } catch {
      for (const job of missing) {
        await enqueue({ kind: 'failed', orderId: job.id, orderCode: job.code, reason: why.trim() })
      }
      setQueued(true)
      setReporting(false)
      setWhy('')
    } finally {
      setBusy(false)
    }
  }

  const shopPhone = group.jobs.find((j) => j.customerPhone)?.customerPhone ?? null

  return (
    <section className="space-y-3 rounded-xl border-2 border-brand-gold bg-card p-4">
      <div className="flex items-start gap-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-gold/20">
          <Store className="size-5 text-charcoal" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('collection.title')}
          </p>
          <p className="truncate text-lg font-bold">{group.shopName ?? group.address}</p>
          {group.shopName ? (
            <p className="truncate text-sm text-muted-foreground">{group.address}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-md bg-brand-gold px-2 py-1 text-xs font-bold text-charcoal">
          {group.jobs.length === 1
            ? t('collection.countOne')
            : t('collection.count').replace('{n}', n(group.jobs.length))}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {shopPhone ? (
          <a href={`tel:${shopPhone}`} className={buttonVariants({ variant: 'outline', size: 'touch' })}>
            <Phone />
            {t('collection.callShop')}
          </a>
        ) : null}
        {/*
          The SHOP's point, never the customer's. `planCollections` hands back
          `point: null` when the feed could not supply one, and the link is
          absent rather than wrong — a rider sent to the customer for a
          collection is the bug this card was written to end.
        */}
        {group.point ? (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${group.point.lat},${group.point.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'outline', size: 'touch' }), !shopPhone && 'col-span-2')}
          >
            <MapPinned />
            {t('action.navigate')}
          </a>
        ) : null}
      </div>

      <ul className="divide-y rounded-lg border">
        {group.jobs.map((job) => {
          const on = ticked.has(job.id)
          return (
            <li key={job.id}>
              <label className="flex cursor-pointer items-center gap-3 p-3 active:bg-muted/50">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || done}
                  onChange={() =>
                    setTicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(job.id)) next.delete(job.id)
                      else next.add(job.id)
                      return next
                    })
                  }
                  className="size-6 shrink-0 accent-brand-red"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm font-semibold">{job.code}</span>
                  {/*
                    WHERE THIS PARCEL IS GOING, not where the rider is. The code
                    is what they match against what the shop hands over; the ward
                    is the sanity check that they were handed the right one.

                    `destinationArea`, not `dropoffArea` — the latter is nulled
                    on a pickup leg because it names the rider's stop, which is
                    this shop. No customer phone: since collect-before-deliver
                    the rider collecting usually does not deliver it, so the
                    number is not theirs to use and would treble the row height
                    on a ten-parcel checklist.
                  */}
                  {job.destinationArea ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {job.destinationArea}
                    </span>
                  ) : null}
                  {job.isFragile ? (
                    <span className="text-xs font-medium text-amber-700">{t('parcel.fragile')}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {job.paymentMethod === 'cod' ? formatMmk(job.codAmount) : t('money.prepaid')}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">{t('collection.tickHint')}</p>

      {/*
        A NOTE ABOUT THE VISIT, distinct from reporting a missing parcel.

        The report flow below handles "the shop was short": it files an
        uncollected attempt against the specific parcel and counts toward the
        shop's ceiling, which is what makes a chronically-short shop visible.
        This is for everything a status change cannot carry — "shutter closed
        early", "new staff", "shop says the rest come tomorrow".

        Collapsed until asked for: most collections have nothing to say, and an
        open textarea above the Picked button invites a rider to think it is
        required.
      */}
      {noting ? (
        <div className="space-y-2 rounded-lg border p-3">
          <label className="block text-sm font-medium" htmlFor={`note-${group.key}`}>
            {t('collection.noteTitle')}
          </label>
          <Textarea
            id={`note-${group.key}`}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('collection.notePlaceholder')}
            disabled={busy}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button size="touch" variant="outline" onClick={() => setNoting(false)} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button size="touch" onClick={() => void saveNote()} disabled={busy || !note.trim()}>
              {busy ? t('action.saving') : t('collection.noteSave')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="touch"
          block
          onClick={() => setNoting(true)}
          disabled={busy || done}
        >
          <StickyNote />
          {t('collection.noteAdd')}
        </Button>
      )}

      {/* Only once something is actually unticked. Offering it unprompted would
          invite a rider to report a shop for a parcel they simply had not
          reached yet. */}
      {missing.length > 0 && !done ? (
        reporting ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">
              {t('collection.report')} · {n(missing.length)}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {missing.map((j) => j.code).join(' · ')}
            </p>
            <Textarea
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              rows={2}
              placeholder={t('collection.reportWhy')}
              className="text-base"
            />
            <p className="text-xs text-muted-foreground">{t('collection.reportHint')}</p>
            {/* Stacked and full width, in order of consequence — the same fix
                the delivery fail panel needed. */}
            <div className="space-y-2">
              <Button
                size="touch"
                block
                variant="destructive"
                className="font-bold"
                disabled={busy || !why.trim()}
                onClick={() => void report()}
              >
                {busy ? t('action.saving') : t('collection.reportSend')}
              </Button>
              <Button size="touch" block variant="ghost" disabled={busy} onClick={() => setReporting(false)}>
                {t('action.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {t('collection.short').replace('{n}', n(missing.length))}
            </span>
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('collection.report')}
            </button>
          </div>
        )
      ) : null}

      {cash > 0 ? (
        <p className="flex items-center gap-1.5 text-sm">
          <Coins className="size-4 shrink-0 text-brand-gold" aria-hidden="true" />
          <span className="text-muted-foreground">{t('collection.cashAfter')}</span>
          <span className="font-bold tabular-nums">{formatMmk(cash)}</span>
        </p>
      ) : null}

      {/*
        WHAT THIS STOP ADDS, and deliberately not "what you earn". quote_trip_pay
        picks its tier by DELIVERY count, so a collection-only run of ten
        pickups pays base 15,000 + 5,000 -- and the 15,000 belongs to the whole
        run and cannot be split between shops. The pickup component is the only
        figure this one card can honestly claim.

        Through quoteTripPay rather than `n * rate` in a component: it is the
        declared twin of the SQL function, and passing no tiers is what makes
        basePay zero and the intent explicit.
      */}
      {chosen.length > 0 ? (
        <p className="flex items-baseline justify-between gap-2 border-t pt-2 text-sm">
          <span className="text-muted-foreground">
            {t('collection.adds')}{' '}
            <span className="whitespace-nowrap text-xs">
              ({formatMmk(pickupRate)} × {n(chosen.length)})
            </span>
          </span>
          <span className="font-bold tabular-nums text-emerald-700">
            {formatMmk(
              quoteTripPay(0, chosen.length, [], {
                parcelRate: 0,
                pickupRate,
              }).pickupPay,
            )}
          </span>
        </p>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}
      {queued ? <Alert tone="info">{t('offline.saved')}</Alert> : null}

      <Button
        size="touch"
        block
        className="bg-emerald-600 text-lg font-bold hover:bg-emerald-700"
        disabled={busy || done || chosen.length === 0}
        onClick={() => void collect()}
      >
        <Truck />
        {busy
          ? t('action.saving')
          : done
            ? t('action.saved')
            : t('collection.collectTicked').replace('{n}', n(chosen.length))}
      </Button>
    </section>
  )
}
