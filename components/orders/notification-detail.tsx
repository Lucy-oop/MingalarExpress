'use client'

import * as React from 'react'
import { Overlay } from '@/components/ui/overlay'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/orders/status-badge'
import { openDeliveryNotification } from '@/lib/orders/notification-actions'
import type { ShopDeliveryDetail } from '@/lib/orders/queries'
import type { NotificationGroup } from '@/lib/orders/notifications'
import { useT } from '@/components/shared/i18n-provider'
import { cn, formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'
import type { OrderStatus } from '@/types/domain'

/**
 * What a shop sees when it taps a line of its own feed.
 *
 * TWO SHAPES BEHIND ONE ENTRY POINT, because the feed has two kinds of news
 * and they answer different questions:
 *
 *   a delivery  -> ONE parcel, in full: who took it, what was collected, and
 *                  the photo the rider took at the door
 *   a pickup    -> the BATCH: everything that left the counter in that handover
 *
 * THE BATCH NEEDS NO FETCH. `groupEvents` keys on the exact transaction
 * timestamp, so the group already holds every row of the handover — code,
 * customer, destination and current status came down with the feed. Fetching
 * again would be a round trip to redisplay what is already in memory.
 *
 * The delivery does need one: the phone, the fee split and above all the
 * signed proof URL are not in the feed and should not be, since the feed is
 * 120 rows of header chrome.
 */
export function NotificationDetail({
  group,
  onClose,
}: {
  group: NotificationGroup | null
  onClose: () => void
}) {
  const t = useT()
  const [detail, setDetail] = React.useState<ShopDeliveryDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [zoom, setZoom] = React.useState(false)

  const isDelivery = group?.kind === 'delivered'
  const orderId = isDelivery && group.rows.length === 1 ? group.rows[0]!.orderId : null

  React.useEffect(() => {
    if (!orderId) {
      setDetail(null)
      return
    }
    let live = true
    setLoading(true)
    setDetail(null)
    void openDeliveryNotification(orderId)
      .then((d) => {
        if (live) setDetail(d)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    // Cancelled on unmount so a slow fetch cannot write into a closed modal.
    return () => {
      live = false
    }
  }, [orderId])

  // Reset the zoom whenever the modal changes parcel, so it never opens zoomed.
  React.useEffect(() => setZoom(false), [group?.key])

  if (!group) return null

  return (
    <>
      <Overlay
        open
        onClose={onClose}
        side="center"
        title={isDelivery ? t('sn.deliveryTitle') : t('sn.batchTitle')}
        description={formatDateTimeYangon(group.at)}
      >
        {isDelivery && orderId ? (
          loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('sn.loading')}</p>
          ) : detail ? (
            <DeliveryBody detail={detail} onZoom={() => setZoom(true)} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('sn.notFound')}</p>
          )
        ) : (
          <BatchBody group={group} />
        )}
      </Overlay>

      {/*
        A SECOND OVERLAY RATHER THAN A BIGGER IMAGE IN THE FIRST. The proof is
        the one thing a shop opens this for when a customer disputes a delivery,
        and reading a doorway photo on a phone means filling the screen with it.
        Nesting it keeps the detail underneath, so dismissing the photo returns
        to the parcel rather than to the feed.
      */}
      {zoom && detail?.proofUrl ? (
        <Overlay
          open
          onClose={() => setZoom(false)}
          side="center"
          title={`${t('sn.proof')} · ${detail.code}`}
          className="max-w-3xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed,
              short-lived storage URL on a private bucket; next/image would need
              the host allow-listed and would proxy every doorway photo. */}
          <img
            src={detail.proofUrl}
            alt={t('sn.proof')}
            className="max-h-[70vh] w-full rounded-lg object-contain"
          />
        </Overlay>
      ) : null}
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium">{children}</dd>
    </div>
  )
}

function DeliveryBody({
  detail,
  onZoom,
}: {
  detail: ShopDeliveryDetail
  onZoom: () => void
}) {
  const t = useT()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm font-semibold">{detail.code}</span>
        <StatusBadge status={detail.status} />
      </div>

      <dl>
        <Row label={t('sn.recipient')}>
          {detail.customerName}
          {detail.township ? (
            <span className="text-muted-foreground"> · {detail.township}</span>
          ) : null}
        </Row>
        <Row label={t('book.phone')}>
          {/* Tappable: the commonest reason a shop opens this is to ring the
              customer about the delivery it is looking at. */}
          <a href={`tel:${detail.customerPhone}`} className="text-primary underline">
            {formatMyanmarPhone(detail.customerPhone)}
          </a>
        </Row>
        <Row label={t('sn.destination')}>
          <span className="break-words">{detail.dropoffAddress}</span>
        </Row>
        {detail.deliveredAt ? (
          <Row label={t('sd.delivered')}>{formatDateTimeYangon(detail.deliveredAt)}</Row>
        ) : null}
        <Row label={t('sn.collectedAmount')}>
          <span className="tabular-nums">
            {detail.paymentMethod === 'cod' ? formatMmk(detail.codAmount) : t('money.prepaid')}
          </span>
          {detail.collectedVia ? (
            <Badge tone="neutral" className="ml-2">
              {detail.collectedVia === 'kpay' ? 'KBZPay' : t('pay.cash')}
            </Badge>
          ) : null}
        </Row>
        <Row label={t('sn.deliveryFeeLabel')}>
          <span className="tabular-nums">{formatMmk(detail.deliveryFee)}</span>
        </Row>
      </dl>

      <div>
        <p className="text-sm font-medium">{t('sn.proof')}</p>
        {detail.proofUrl ? (
          <>
            <button
              type="button"
              onClick={onZoom}
              className="mt-2 block w-full overflow-hidden rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
              <img
                src={detail.proofUrl}
                alt={t('sn.proof')}
                className="max-h-64 w-full object-cover"
              />
            </button>
            <p className="mt-1 text-xs text-muted-foreground">{t('sn.enlarge')}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t('sn.noProof')}</p>
        )}
      </div>
    </div>
  )
}

function BatchBody({ group }: { group: NotificationGroup }) {
  const t = useT()
  return (
    <div className="space-y-3">
      {group.actorName ? (
        <p className="text-sm text-muted-foreground">
          {t('sn.by').replace('{name}', group.actorName)}
        </p>
      ) : null}

      <ul className="divide-y">
        {group.rows.map((r) => (
          <li key={r.orderId} className="flex items-start justify-between gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{r.customerName || '—'}</span>
              <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                {r.code}
              </span>
              {r.dropoffAddress ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {r.dropoffAddress}
                  {r.township ? ` · ${r.township}` : ''}
                </span>
              ) : null}
            </span>
            {/* Where it is NOW, which is the point of looking at a batch from
                three hours ago rather than at the moment it was collected. */}
            {r.status ? (
              <span className="shrink-0">
                <StatusBadge status={r.status as OrderStatus} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
