import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PackageCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { BrandMark } from '@/components/shared/brand-mark'
import { StatusBadge } from '@/components/orders/status-badge'
import { StatusTimeline } from '@/components/orders/status-timeline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDateTimeYangon } from '@/lib/utils'
import { ORDER_STATUS_LABEL_MM, type TrackedOrder } from '@/types/domain'

/**
 * Public checkpoint tracking. No authentication.
 *
 * The `anon` role has NO table grants (migration 0001), so this page cannot read
 * `orders` even if someone changed the query. Its only door in is the
 * SECURITY DEFINER RPC `track_order`, which returns a deliberately narrow
 * payload: no phone number, no street address, no rider identity. Do not widen
 * that RPC to "make the page nicer" -- anyone with a code can call it.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>
}): Promise<Metadata> {
  const { code } = await params
  return { title: `Track ${decodeURIComponent(code).toUpperCase()}` }
}

export default async function TrackPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('track_order', {
    p_code: decodeURIComponent(code),
  })

  // The RPC returns SQL NULL for an unknown code, which arrives as null here.
  if (error || !data) notFound()

  const order = data as unknown as TrackedOrder

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8">
      <BrandMark />

      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="font-mono text-base">{order.code}</CardTitle>
            <StatusBadge status={order.status} />
          </div>
          <p lang="my" className="text-sm text-muted-foreground">
            {ORDER_STATUS_LABEL_MM[order.status]}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">From</span>
            <span className="font-medium">{order.shop_name}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Delivering to</span>
            <span className="font-medium">{order.dropoff_area ?? 'Yangon'}</span>
          </div>
          {order.is_cod ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Payment</span>
              <Badge tone="gold">Cash on delivery</Badge>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Ordered</span>
            <span className="tabular-nums">{formatDateTimeYangon(order.created_at)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progress</CardTitle>
        </CardHeader>
        <CardContent>
          {/* `audience="customer"` matters: the shop-facing copy talks about
              "your shop" and counts attempts, neither of which belongs on a
              page a customer opens from a tracking link. */}
          <StatusTimeline
            current={order.status}
            events={order.timeline ?? []}
            audience="customer"
          />
        </CardContent>
      </Card>

      {order.status === 'delivered' ? (
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-emerald-700">
          <PackageCheck className="size-4" />
          Delivered {formatDateTimeYangon(order.delivered_at)}
        </p>
      ) : null}

      <p className="text-center text-xs text-muted-foreground">
        Mingalar Express · Greater Yangon
      </p>
    </main>
  )
}
