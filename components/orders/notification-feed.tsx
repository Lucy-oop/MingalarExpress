'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CircleCheckBig,
  CornerUpLeft,
  PackageCheck,
  PackageX,
  Store,
  TriangleAlert,
} from 'lucide-react'
import type { NotificationGroup, NotificationKind } from '@/lib/orders/notifications'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { localeNumber, type MessageKey } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { cn, formatDateTimeYangon } from '@/lib/utils'

/**
 * The shop's feed, and the only reason this is a client component: the
 * read marker.
 *
 * WHY localStorage AND NOT A TABLE. What is unread is a per-person convenience,
 * not a fact about the business — getting it wrong costs a bold row, not money.
 * A durable marker would need a table, a write path and a migration for that.
 * The same trade was already made and documented for the pickup chime in
 * `shop-parcel-alert.tsx`, and this reuses its shape.
 *
 * ADVANCED ON VIEW, ONCE. Advancing it on every render would lose the news for
 * a shop that opened the page and looked away; never advancing it would leave
 * everything bold forever. Reading it before the effect writes it is what lets
 * the first paint still show what was missed.
 *
 * The cost is honest and worth stating: it is per-device. Read on the phone,
 * still bold on the laptop.
 */
const seenKey = (userId: string) => `mge:shop:seenEvents:${userId}`

const LABEL: Record<NotificationKind, MessageKey> = {
  collected: 'sn.collected',
  not_collected: 'sn.notCollected',
  delivery_failed: 'sn.deliveryFailed',
  returned: 'sn.returned',
  delivered: 'sn.delivered',
}

const ICON: Record<NotificationKind, typeof Store> = {
  collected: Store,
  not_collected: PackageX,
  delivery_failed: TriangleAlert,
  returned: CornerUpLeft,
  delivered: CircleCheckBig,
}

/** Tone carries the meaning at a glance; the label carries it exactly. */
const TONE: Record<NotificationKind, string> = {
  collected: 'bg-brand-gold/20 text-charcoal',
  not_collected: 'bg-destructive/10 text-destructive',
  delivery_failed: 'bg-amber-100 text-amber-800',
  returned: 'bg-blue-100 text-blue-800',
  delivered: 'bg-emerald-100 text-emerald-800',
}

export function NotificationFeed({
  groups,
  userId,
}: {
  groups: NotificationGroup[]
  userId: string
}) {
  const t = useT()
  const locale = useLocale()

  /*
    Read on the first client render, BEFORE the effect below moves it, so the
    first paint still marks what happened since the last visit. `null` until
    then, which renders nothing bold rather than flashing everything bold.
  */
  const [seen, setSeen] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let mark: string | null = null
    try {
      mark = window.localStorage.getItem(seenKey(userId))
    } catch {
      // Private mode, or storage disabled. Nothing is marked new; the feed
      // itself still works, which is the part that matters.
    }
    setSeen(mark)

    const newest = groups[0]?.at
    if (!newest) return
    try {
      window.localStorage.setItem(seenKey(userId), newest)
    } catch {
      /* as above */
    }
    // Deliberately keyed on the newest event only: re-running on every render
    // of the same feed would be a pointless write, and depending on `groups`
    // by identity would do exactly that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, groups[0]?.at])

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-10 text-center">
        <PackageCheck className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t('sn.empty')}</p>
        <p className="text-sm text-muted-foreground">{t('sn.emptyHint')}</p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {groups.map((group) => {
        const Icon = ICON[group.kind]
        const isNew = seen !== undefined && seen !== null && Date.parse(group.at) > Date.parse(seen)
        const n = group.rows.length

        return (
          <li
            key={group.key}
            className={cn(
              'flex items-start gap-3 rounded-lg border bg-card p-3',
              isNew && 'border-primary/40 bg-primary/[0.03]',
            )}
          >
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full',
                TONE[group.kind],
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(LABEL[group.kind])}</span>
                <span className="text-sm text-muted-foreground">
                  {n === 1
                    ? t('sn.parcelOne')
                    : t('sn.parcels').replace('{n}', localeNumber(locale, n))}
                </span>
                {isNew ? <Badge tone="red">{t('sn.new').replace('{n}', '')}</Badge> : null}
              </p>

              {/* The codes, so a shop can match this against their own record
                  without opening anything. Capped, because an armful of thirty
                  would push the timestamp off a phone screen. */}
              <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">
                {group.rows
                  .slice(0, 6)
                  .map((r) => r.code)
                  .join(' · ')}
                {n > 6 ? ` · +${localeNumber(locale, n - 6)}` : ''}
              </p>

              {group.reason ? (
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground">{t('sn.reason')}: </span>
                  {group.reason}
                </p>
              ) : null}

              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateTimeYangon(group.at)}
              </p>

              {/* A failed delivery is the one kind with something to do about
                  it, and the decision already has a home. */}
              {group.kind === 'delivery_failed' || group.kind === 'not_collected' ? (
                <Link
                  href={n === 1 ? `/shop/orders/${group.rows[0]!.orderId}` : '/shop/orders?needs=1'}
                  className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {t('sn.needsYou')}
                </Link>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
