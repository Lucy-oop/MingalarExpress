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
  onOpen,
}: {
  group: NotificationGroup
  isNew: boolean
  compact?: boolean
  /** Lets the drawer close itself when a row is followed. */
  onNavigate?: () => void
  /** Opens the detail modal. Absent where there is nothing to open into. */
  onOpen?: (group: NotificationGroup) => void
}) {
  const t = useT()
  const locale = useLocale()
  const Icon = ICON[group.kind]
  const n = group.rows.length
  const decisionHref =
    n === 1 ? `/shop/orders/${group.rows[0]!.orderId}` : '/shop/orders?needs=1'

  /*
    WHAT THE HEADLINE SAYS, and why it is built here rather than in the
    dictionary.

    "Delivered" and "8 parcels" told a shop that something happened to
    something. A shop with forty parcels out recognises a delivery by WHO it
    went to and a collection by WHO took it, and both facts were already on the
    row — the customer since this feed shipped, the rider since 0045 — just
    never said.

    Only where it does not lie. A delivery group is one parcel except in the
    rare case of two delivered in the same transaction, so the name goes on the
    singular and the count carries the rest. The rider's name only appears when
    every row in the group agrees on it; `groupEvents` nulls it otherwise.
  */
  const subject =
    group.kind === 'delivered' && n === 1
      ? [group.rows[0]!.customerName, group.rows[0]!.township].filter(Boolean).join(' · ')
      : null
  const openable = group.kind === 'delivered' ? n === 1 : group.kind === 'collected'

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
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">
            {t(LABEL[group.kind])}
            {subject ? <>: {subject}</> : null}
          </span>
          {subject ? null : (
            <span className="text-sm text-muted-foreground">
              {n === 1
                ? t('sn.parcelOne')
                : t('sn.parcels').replace('{n}', localeNumber(locale, n))}
            </span>
          )}
          {/* Who collected them. Only on the kinds a rider causes, and only
              when the whole group agrees. */}
          {group.actorName && group.kind === 'collected' ? (
            <span className="text-sm text-muted-foreground">
              {t('sn.by').replace('{name}', group.actorName)}
            </span>
          ) : null}
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
        ) : openable && onOpen ? (
          /*
            A BUTTON, NOT A LINK, and not the whole row either.

            Not a link because nothing navigates: the modal fetches through a
            server action and the feed stays where it is, which is the point —
            a shop checking four deliveries should not lose its place in the
            list four times.

            Not the whole row because `needsDecision` rows already carry a link
            inside them, and a row that is itself a control cannot hold another
            one without nesting interactive elements. Same rule JobCard is
            written on.
          */
          <button
            type="button"
            onClick={() => onOpen(group)}
            className="mt-1 inline-block min-h-11 text-sm font-medium text-primary hover:underline"
          >
            {t('sn.viewDetail')}
          </button>
        ) : null}
      </div>
    </li>
  )
}
