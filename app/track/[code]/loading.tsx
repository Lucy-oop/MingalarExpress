import { Skeleton, SkeletonLine } from '@/components/ui/skeleton'
import { BrandMark } from '@/components/shared/brand-mark'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

/**
 * The public tracking page, while it loads.
 *
 * THE ONE SCREEN A STRANGER JUDGES US BY. Everything else with a skeleton is
 * behind a login; this is the link a customer opens from an SMS, on mobile
 * data, often as their first contact with Mingalar Express — and it is
 * `force-dynamic`, so until now there was nothing between the tap and the
 * server round trip but a white page.
 *
 * THE WORDMARK IS REAL, NOT A GREY BOX. It is CSS text that costs nothing to
 * render and needs no data, so drawing a placeholder over it would be slower
 * AND emptier than the truth. It also means the brand is on screen in the
 * first frame, which is the whole argument for this file.
 *
 * Shaped to `page.tsx`: the parcel card, the four-step timeline, and the
 * delivered line. The timeline is the part that must match — its nodes are a
 * fixed 24px circle joined by a 1px rail, so a mismatched stand-in would
 * visibly jump when the real one lands.
 *
 * `animate-pulse` only, like every other skeleton here: a shimmer sweep costs a
 * compositing layer per frame, and this page's readers are on the worst
 * connections and the cheapest phones of anyone who uses the product.
 */
export default function TrackLoading() {
  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8"
      role="status"
      aria-label="Loading"
    >
      <BrandMark />

      {/* The parcel card: code + status badge, then four label/value rows. */}
      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <SkeletonLine w="w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {['w-16', 'w-24', 'w-20', 'w-16'].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <SkeletonLine w={w} className="h-3" />
              <SkeletonLine w="w-28" className="h-3" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Progress. Four checkpoints, each a 24px node on a rail. */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <ol className="space-y-0">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  {i < 3 ? <span className="my-0.5 w-px flex-1 bg-border" /> : null}
                </div>
                <div className="pb-4">
                  <SkeletonLine w="w-28" />
                  <SkeletonLine w="w-36" className="mt-1 h-3" />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* The "Delivered <time>" line, which only a delivered parcel shows. Kept
          as a single centred bar so the footer below does not jump upward when
          the real page turns out not to render it. */}
      <Skeleton className="mx-auto h-4 w-48" />

      <p className="text-center text-xs text-muted-foreground">
        Mingalar Express · Greater Yangon
      </p>
    </main>
  )
}
