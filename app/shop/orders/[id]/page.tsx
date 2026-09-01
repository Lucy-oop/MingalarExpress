import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ExternalLink, Phone } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/orders/status-badge'
import { StatusTimeline } from '@/components/orders/status-timeline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { formatDateTimeYangon, formatDistanceKm, formatMmk, formatMyanmarPhone } from '@/lib/utils'

export const metadata: Metadata = { title: 'Order' }

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
  const supabase = await createClient()

  // RLS returns nothing for another shop's order, which surfaces as a 404 --
  // deliberately indistinguishable from a non-existent id, so the endpoint is
  // not an existence oracle for other shops' order codes.
  const { data: order } = await supabase
    .from('orders')
    .select('*, service_areas:dropoff_area_id (name)')
    .eq('id', id)
    .maybeSingle()

  if (!order) notFound()

  const { data: events } = await supabase
    .from('order_status_events')
    .select('to_status, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true })

  const timeline = (events ?? []).map((e) => ({ status: e.to_status, at: e.created_at }))
  const area = (order.service_areas as { name: string } | null)?.name ?? null

  return (
    <div className="space-y-5">
      {created ? (
        <Alert tone="success" title="Order created">
          Dispatch has been notified and will assign the nearest rider.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold">{order.code}</h1>
          <p className="text-sm text-muted-foreground">
            Created {formatDateTimeYangon(order.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={order.status} />
          <Link
            href={`/track/${order.code}`}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Customer tracking link <ExternalLink className="size-3.5" />
          </Link>
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
              {area ? <p className="text-muted-foreground">{area} ward</p> : null}
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
                <p className="text-muted-foreground">{order.parcel_weight_g} g</p>
              ) : null}
            </Detail>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Money</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Payment" value={order.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid'} />
              {order.payment_method === 'cod' ? (
                <Row label="Rider collects" value={formatMmk(order.cod_amount)} strong />
              ) : null}
              <Row label="Delivery fee" value={formatMmk(order.delivery_fee)} />
              <Row
                label="Fee paid by"
                value={order.fee_payer === 'customer' ? 'Customer' : 'Shop'}
              />
              <Row label="Distance" value={formatDistanceKm(order.route_distance_km)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusTimeline current={order.status} events={timeline} />
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
