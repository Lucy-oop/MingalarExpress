import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Bike, ExternalLink, Phone, Store } from 'lucide-react'
import { requireDispatch } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { getShopOrderDetail } from '@/lib/orders/queries'
import { StatusBadge } from '@/components/orders/status-badge'
import { StatusTimeline } from '@/components/orders/status-timeline'
import { FailedOrderPanel } from '@/components/orders/failed-order-panel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'

export const metadata: Metadata = { title: 'Order · Admin' }

/** The proof link is signed and short-lived, so this must never be cached. */
export const dynamic = 'force-dynamic'

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireDispatch()
  const { id } = await params

  // The same query the shop's page uses. It needs no admin variant because
  // `orders_all_dispatch`, `proofs_read_parties` and `order_rider_card` all
  // name dispatch alongside the owning shop — the policies were written for
  // both readers from the start.
  const detail = await getShopOrderDetail(id)
  if (!detail) notFound()

  const { order, areaName, route, events, rider, proofUrl, attempts, maxAttempts, awaitingDecision } =
    detail

  const supabase = await createClient()
  const { data: shop } = await supabase
    .from('shops')
    .select('id, name, phone, pickup_address')
    .eq('id', order.shop_id)
    .maybeSingle()

  return (
    <div className="space-y-5">
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All orders
      </Link>

      {/* Dispatch can resolve on the shop's behalf — the office usually hears
          about a failure by telephone, and telling the caller to go and click it
          themselves is not a support answer. */}
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
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Store className="size-3.5" />
            {shop?.name ?? 'Unknown shop'}
            <span>· created {formatDateTimeYangon(order.created_at)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.status} />
          <Link
            href={`/track/${order.code}`}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Customer view <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Parcel</CardTitle>
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

            <Detail label="Shop / pickup">
              <p>{shop?.pickup_address ?? order.pickup_address}</p>
              {shop?.phone ? (
                <a href={`tel:${shop.phone}`} className="text-primary hover:underline">
                  {formatMyanmarPhone(shop.phone)}
                </a>
              ) : null}
            </Detail>

            <Detail label="Contents">
              <p>
                {order.parcel_desc}
                {order.is_fragile ? (
                  <Badge tone="amber" className="ml-2">
                    Fragile
                  </Badge>
                ) : null}
              </p>
            </Detail>

            {order.status === 'delivered' || order.status === 'returned' ? (
              <Detail label={order.status === 'returned' ? 'Returned' : 'Proof of delivery'}>
                {order.proof_receiver ? (
                  <p>
                    Signed for by <span className="font-medium">{order.proof_receiver}</span>
                  </p>
                ) : null}
                {proofUrl ? (
                  <a
                    href={proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block w-fit overflow-hidden rounded-lg border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proofUrl}
                      alt={`Proof for ${order.code}`}
                      width={320}
                      className="h-auto w-full max-w-xs object-cover"
                    />
                  </a>
                ) : (
                  <p className="text-muted-foreground">No photo on file.</p>
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
                <Row label="Rider collects" value={formatMmk(order.cod_amount)} strong />
              ) : null}
              <Row label="Delivery fee" value={formatMmk(order.delivery_fee)} />
              <Row label="Fee paid by" value={order.fee_payer === 'customer' ? 'Customer' : 'Shop'} />
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
              <Row label="COD state" value={order.cod_status} />
            </CardContent>
          </Card>

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
              <p className="mt-3 text-xs text-muted-foreground">
                {attempts > 0
                  ? `${attempts} failed attempt${attempts === 1 ? '' : 's'} of ${maxAttempts} allowed automatically.`
                  : 'No failed attempts.'}
              </p>
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
