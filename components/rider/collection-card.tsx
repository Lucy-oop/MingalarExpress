'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Coins, MapPinned, Phone, Store, Truck } from 'lucide-react'
import type { CollectionGroup } from '@/lib/rider/collection'
import { advanceOrders } from '@/lib/rider/actions'
import { enqueue } from '@/lib/rider/offline-queue'
import { explainRiderError } from '@/lib/rider/errors'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { cn, formatMmk } from '@/lib/utils'
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
export function CollectionCard({ group }: { group: CollectionGroup }) {
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

      {cash > 0 ? (
        <p className="flex items-center gap-1.5 text-sm">
          <Coins className="size-4 shrink-0 text-brand-gold" aria-hidden="true" />
          <span className="text-muted-foreground">{t('collection.cashAfter')}</span>
          <span className="font-bold tabular-nums">{formatMmk(cash)}</span>
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
