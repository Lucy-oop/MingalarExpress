'use client'

import Link from 'next/link'
import { CircleCheckBig, CornerUpLeft, PackageX, Store, TriangleAlert } from 'lucide-react'
import type { NotificationGroup, NotificationKind } from '@/lib/orders/notifications'
import { useLocale, useT } from '@/components/shared/i18n-provider'
import { localeNumber, type MessageKey } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { cn, formatDateTimeYangon } from '@/lib/utils'

/**
 * One line of a shop's feed, shared by the page and the header drawer.
 *
 * EXTRACTED SO THERE IS ONE OF IT. The drawer shows the same news the page
 * does -- the kind's colour and icon, the parcel codes, a shared reason, and
 * the "needs you" link on the two kinds that have a decision attached. Written
 * twice they would drift, and the half that drifted would be the drawer, which
 * is the half a shop actually looks at.
 *
 * `compact` is the only difference. In a drawer the codes and the reason are
 * detail a shop reads on the page; the panel keeps what a glance needs.
 */

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

/** The two kinds a shop has a decision to make about. */
export function needsDecision(kind: NotificationKind): boolean {
  return kind === 'delivery_failed' || kind === 'not_collected'
}

export function NotificationRow({
  group,
  isNew,
  compact = false,
  onNavigate,
}: {
  group: NotificationGroup
  isNew: boolean
  compact?: boolean
  /** Lets the drawer close itself when a row is followed. */
  onNavigate?: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const Icon = ICON[group.kind]
  const n = group.rows.length
  const decisionHref =
    n === 1 ? `/shop/orders/${group.rows[0]!.orderId}` : '/shop/orders?needs=1'

  return (
    <li
      className={cn(
        'flex items-start gap-3 border bg-card p-3',
        compact ? 'rounded-none border-x-0 border-t-0' : 'rounded-lg',
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
            {n === 1 ? t('sn.parcelOne') : t('sn.parcels').replace('{n}', localeNumber(locale, n))}
          </span>
          {isNew ? <Badge tone="red">{t('sn.new').replace('{n}', '')}</Badge> : null}
        </p>

        {/* The codes, so a shop can match this against their own record without
            opening anything. Capped, because an armful of thirty would push the
            timestamp off a phone screen. */}
        {compact ? null : (
          <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">
            {group.rows
              .slice(0, 6)
              .map((r) => r.code)
              .join(' · ')}
            {n > 6 ? ` · +${localeNumber(locale, n - 6)}` : ''}
          </p>
        )}

        {group.reason && !compact ? (
          <p className="mt-1 text-sm">
            <span className="text-muted-foreground">{t('sn.reason')}: </span>
            {group.reason}
          </p>
        ) : null}

        <p className="mt-1 text-xs text-muted-foreground">{formatDateTimeYangon(group.at)}</p>

        {/* A failed delivery is the one kind with something to do about it, and
            the decision already has a home. Kept even when compact: it is the
            only actionable thing in the whole feed. */}
        {needsDecision(group.kind) ? (
          <Link
            href={decisionHref}
            onClick={onNavigate}
            className="mt-1 inline-block min-h-11 text-sm font-medium text-primary hover:underline"
          >
            {t('sn.needsYou')}
          </Link>
        ) : null}
      </div>
    </li>
  )
}
