import { Skeleton, SkeletonLine } from '@/components/ui/skeleton'

/**
 * The office's loading state, shaped like the run board because that is what
 * `/admin` is and what most navigations land on.
 *
 * IT SITS INSIDE THE LAYOUT. `app/admin/layout.tsx` renders the header, the
 * notice bell and the nav; this replaces only `{children}`. So a navigation
 * within the panel keeps the chrome and the current tab highlight, and only the
 * work area blinks — which is both faster and less alarming than a full-page
 * flash.
 *
 * AND IT IS WHAT MAKES PREFETCH WORK. Every route under /admin is
 * `force-dynamic`. Next will not prefetch a dynamic route's content, but it
 * WILL prefetch its loading boundary — so before this file existed, `<Link>`
 * prefetch had nothing to fetch here and every click started cold. This is the
 * thing that turns a two-second freeze into an immediate response.
 *
 * Two columns at lg, mirroring route-board's grid, so the skeleton does not
 * reflow into a different shape the instant real content lands.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      {/* The page header: title, service date, refresh. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <SkeletonLine w="w-56" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        {/* Runs, grouped by route. */}
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2 rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2">
                <Skeleton className="size-3 rounded-full" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="ml-auto h-6 w-20" />
              </div>
              <SkeletonLine w="w-2/3" />
              <div className="flex gap-1.5">
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </div>

        {/* The parcel pool. */}
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <Skeleton className="h-8 w-full" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2 rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <Skeleton className="size-4" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="ml-auto h-3 w-16" />
              </div>
              <SkeletonLine w="w-4/5" className="h-3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
