import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PackageCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BrandMark } from '@/components/shared/brand-mark'
import { StatusBadge } from '@/components/orders/status-badge'
import { StatusTimeline } from '@/components/orders/status-timeline'
import { DeliveryProof } from '@/components/orders/delivery-proof'
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
 *
 * ---------------------------------------------------------------------------
 * ONE THING WAS ADDED TO THAT PAYLOAD ON PURPOSE (0046): THE DELIVERY PHOTO
 *
 * The warning above still stands for every other field. This one exception is
 * an owner decision, taken with the tradeoff stated, and it is recorded here so
 * the next reader finds a choice rather than a contradiction:
 *
 *   `orders.code` is a GLOBAL MONOTONIC SEQUENCE (init.sql:238), so codes are
 *   enumerable -- from one known code the corpus is a few thousand guesses --
 *   and `track_order` is granted to `anon` with no second factor and no rate
 *   limit. A photo here is public in practice, not merely unlisted, and a
 *   doorstep photo can identify a home in a way a township cannot.
 *
 *   Offered and declined: a last-4-of-phone check before revealing it,
 *   unguessable codes, keeping it behind a login. If it is ever revisited, the
 *   gate belongs in `track_order`, not here.
 *
 * THE SIGNING IS THE PART TO NOT TOUCH. `delivery-proofs` is private and its
 * only read policy is `to authenticated` (0004), so an anonymous visitor cannot
 * fetch an object at all. The RPC returns an object PATH, this server component
 * signs that one object with the service role for five minutes, and only the
 * signed link is sent to the browser. The path never leaves the server.
 *
 * Do NOT replace this with a storage policy for `anon`. That is the change
 * somebody will reach for, and it would expose every proof in the bucket to a
 * guessed path -- strictly worse than the decision actually made.
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

  /*
    Signed here, once, only for a delivered parcel that actually has one. Five
    minutes is `PROOF_URL_TTL_SECONDS` elsewhere in the app and is plenty for a
    page that renders immediately; a longer link is a link that outlives the
    visit and can be pasted anywhere.

    Failing soft on purpose: a bucket hiccup must show the parcel's progress
    with "no photo recorded" rather than 500 a page whose whole job is to
    reassure somebody their parcel is coming.
  */
  const proofUrl = order.proof_photo_path
    ? await signTrackingProof(order.proof_photo_path)
    : null

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
            deliveredSlot={<DeliveryProof url={proofUrl} />}
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

/**
 * Sign ONE proof object for an anonymous visitor.
 *
 * The service role is used because there is no session to sign with -- the same
 * reasoning `phoneTaken` is written on in lib/auth/actions.ts, and the same
 * shape: a narrow, single-purpose read that RLS cannot scope because there is
 * no caller to scope it to. Authorisation happened upstream, when `track_order`
 * matched the code; this signs the one path that came back and nothing else.
 */
async function signTrackingProof(path: string): Promise<string | null> {
  try {
    const { data } = await createAdminClient()
      .storage.from('delivery-proofs')
      .createSignedUrl(path, 300)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}
