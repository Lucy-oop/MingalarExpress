import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Bike, ExternalLink, Phone } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { getShopOrderDetail } from '@/lib/orders/queries'
import { StatusBadge } from '@/components/orders/status-badge'
import { StatusTimeline } from '@/components/orders/status-timeline'
import { CancelOrderButton } from '@/components/orders/cancel-order-button'
import { FailedOrderPanel } from '@/components/orders/failed-order-panel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { formatDateTimeYangon, formatDistanceKm, formatMmk, formatMyanmarPhone } from '@/lib/utils'

export const metadata: Metadata = { title: 'Order' }

/** The proof link is signed and short-lived, so this page must not be cached. */
export const dynamic = 'force-dynamic'

export default async function ShopOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string }>
}) {
  await requireShop()
  const { id } = await params
  const { created } = await searchParams

  // RLS returns nothing for another shop's order, which surfaces as a 404 --
  // deliberately indistinguishable from a non-existent id, so the endpoint is
  // not an existence oracle for other shops' order codes.
  const detail = await getShopOrderDetail(id)
  if (!detail) notFound()

  const { order, areaName, route, events, rider, proofUrl, attempts, maxAttempts, awaitingDecision } =
    detail

  return (
    <div className="space-y-5">
      {created ? (
        <Alert tone="success" title="Order created">
          Dispatch can see it now. It stays open until a rider is assigned.
        </Alert>
      ) : null}

      {/*
        A failure is not just a status to report — it is a decision the shop has
        to make. Until 0011 it was retried silently and forever, so the shop was
        never told and never asked. `attempts > 0` rather than
        `status = 'failed'` because close_trip may already have auto-retried it
        back to `pending`, and that is exactly the moment a shop might want to
        say "stop, bring it back".
      */}
      {attempts > 0 && order.status !== 'delivered' && order.status !== 'cancelled' ? (
        <FailedOrderPanel
          orderId={order.id}
          orderCode={order.code}
          failReason={order.fail_reason}
          attempts={attempts}
          maxAttempts={maxAttempts}
          awaitingDecision={awaitingDecision}
          resolution={order.resolution}
          status={order.status}
          receivedBy={order.proof_receiver}
        />
      ) : null}

      {order.status === 'cancelled' ? (
        <Alert tone="info" title="Order cancelled">
          {order.cancel_reason ?? 'No reason was recorded.'}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold">{order.code}</h1>
          <p className="text-sm text-muted-foreground">
            Created {formatDateTimeYangon(order.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.status} />
          <Link
            href={`/track/${order.code}`}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Customer tracking link <ExternalLink className="size-3.5" />
          </Link>
          {/* RLS permits `pending -> cancelled` for the owning shop, and the
              action has existed since Phase 2 with nothing calling it. */}
          {order.status === 'pending' ? (
            <CancelOrderButton orderId={order.id} orderCode={order.code} />
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Delivery details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Detail label="Customer">
              <p className="font-medium">{order.customer_name}</p>
              <a
                href={`tel:${order.customer_phone}`}
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <Phone className="size-3.5" />
                {formatMyanmarPhone(order.customer_phone)}
              </a>
              {order.customer_phone_alt ? (
                <p className="text-muted-foreground">
                  Alt: {formatMyanmarPhone(order.customer_phone_alt)}
                </p>
              ) : null}
            </Detail>

            <Detail label="Deliver to">
              <p>{order.dropoff_address}</p>
              {areaName ? <p className="text-muted-foreground">{areaName}</p> : null}
              {order.dropoff_note ? (
                <p className="text-muted-foreground">Note: {order.dropoff_note}</p>
              ) : null}
            </Detail>

            <Detail label="Pick up from">
              <p>{order.pickup_address}</p>
              {order.pickup_note ? (
                <p className="text-muted-foreground">Note: {order.pickup_note}</p>
              ) : null}
            </Detail>

            <Detail label="Parcel">
              <p>
                {order.parcel_desc}
                {order.is_fragile ? (
                  <Badge tone="amber" className="ml-2">
                    Fragile
                  </Badge>
                ) : null}
              </p>
              {order.parcel_weight_g ? (
                <p className="text-muted-foreground">
                  {order.parcel_weight_g} g
                </p>
              ) : null}
            </Detail>

            {/* Proof of delivery. The photo has always been captured by the rider
                and readable by the sending shop; nothing rendered it until now,
                which left a shop with no answer to "it never arrived". */}
            {order.status === 'delivered' ? (
              <Detail label="Proof of delivery">
                {order.proof_receiver ? (
                  <p>
                    Received by <span className="font-medium">{order.proof_receiver}</span>
                  </p>
                ) : null}
                {proofUrl ? (
                  <a
                    href={proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block w-fit overflow-hidden rounded-lg border"
                  >
                    {/*
                      A plain img, not next/image. The source is a private,
                      short-lived signed URL on a host that changes with the
                      environment: it cannot be optimised or cached, so the
                      component would add a remotePatterns entry and a loader
                      hop for no benefit.
                    */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proofUrl}
                      alt={`Delivery photo for ${order.code}`}
                      width={320}
                      className="h-auto w-full max-w-xs object-cover"
                    />
                  </a>
                ) : (
                  <p className="text-muted-foreground">
                    The photo could not be loaded. Ask the office if you need it.
                  </p>
                )}
              </Detail>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Money</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row
                label="Payment"
                value={order.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid'}
              />
              {order.payment_method === 'cod' ? (
                <Row
                  label="Rider collects"
                  value={formatMmk(order.cod_amount)}
                  strong
                />
              ) : null}
              <Row label="Delivery fee" value={formatMmk(order.delivery_fee)} />
              {route ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">Route</span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: route.colour }}
                      aria-hidden="true"
                    />
                    {route.name}
                  </span>
                </div>
              ) : null}
              <Row
                label="Fee paid by"
                value={order.fee_payer === 'customer' ? 'Customer' : 'Shop'}
              />
              <Row
                label="Distance"
                value={formatDistanceKm(order.route_distance_km)}
              />
            </CardContent>
          </Card>

          {/* Who has it. A shop could always read orders.rider_id but never the
              name behind it — profiles is not shop-readable. */}
          {rider ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Rider</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <Bike className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {rider.fullName}
                </p>
                {rider.vehiclePlate ? (
                  <p className="text-muted-foreground">{rider.vehiclePlate}</p>
                ) : null}
                <p className="pt-1 text-xs text-muted-foreground">
                  To reach the rider, contact the office rather than calling directly.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusTimeline
                current={order.status}
                events={events}
                reason={order.fail_reason ?? order.cancel_reason ?? null}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  )
}
