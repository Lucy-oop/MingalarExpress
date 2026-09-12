import { Skeleton, SkeletonLine } from '@/components/ui/skeleton'

/**
 * COD audit, while it loads.
 *
 * WHY THIS ROUTE GETS ITS OWN. `app/admin/loading.tsx` is drawn like the run
 * board — a two-column grid of run cards beside a parcel pool — because that is
 * what `/admin` is and what most navigations land on. It applies to every route
 * beneath it, so this page was flashing a run board and then rendering a tab
 * strip over a wide table. A skeleton that promises the wrong layout is worse
 * than none: the page visibly rearranges itself at the exact moment the reader
 * starts reading it.
 *
 * `CodExplorer` is a desk tool with a horizontally scrolling table, and that is
 * deliberate (see order-table's note on which tables were left alone), so this
 * stands in for the tab strip and the rows rather than pretending to be cards.
 */
export default function AuditLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <SkeletonLine w="w-80" />
      </div>

      {/* The explorer's tab strip. */}
      <div className="flex gap-2 border-b pb-2">
        {['w-24', 'w-28', 'w-20'].map((w) => (
          <Skeleton key={w} className={`h-8 ${w} rounded-md`} />
        ))}
      </div>

      <div className="rounded-lg border">
        {/* A header row, then rows. Fixed column widths so the stand-in lines
            up with the real table's left edge rather than drifting. */}
        <div className="flex gap-4 border-b bg-muted/40 px-3 py-2">
          {['w-28', 'w-20', 'w-24', 'w-16', 'w-20'].map((w) => (
            <SkeletonLine key={w} w={w} className="h-3" />
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4 border-b px-3 py-2.5 last:border-b-0">
            {['w-28', 'w-20', 'w-24', 'w-16', 'w-20'].map((w) => (
              <SkeletonLine key={w} w={w} className="h-3.5" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
