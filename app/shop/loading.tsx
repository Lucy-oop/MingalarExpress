import { Skeleton, SkeletonLine } from '@/components/ui/skeleton'

/**
 * The shop panel's loading state.
 *
 * /shop/dashboard was the slowest route in the app — TEN sequential round
 * trips and twenty HTTP requests on a cold load, because a shop owner's
 * `app_metadata.role` is deliberately left absent (so suspension takes effect
 * on the next request) and the middleware therefore reads `profiles` every
 * time, on top of the layout's policy-gate read and two notice queries.
 *
 * The per-request auth memo removed most of the duplication. This covers the
 * rest: the merchant sees the shape of their dashboard immediately instead of
 * the previous page sitting there.
 *
 * Four tiles then a list, which is both the dashboard and — closely enough —
 * the orders table, so a nav between them does not change shape twice.
 */
export default function ShopLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <SkeletonLine w="w-64" />
      </div>

      {/*
        THE SAME SHAPE THE PAGE RENDERS, which it was not: this drew four equal
        tiles while the dashboard drew five, so the layout jumped the moment the
        data arrived — the one thing a skeleton exists to prevent. It is now the
        money card over a 2x2 of counts, matching app/shop/dashboard/page.tsx.
      */}
      <div className="space-y-3">
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2 rounded-lg border bg-card p-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-3">
        <Skeleton className="h-4 w-32" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 border-t py-2.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
