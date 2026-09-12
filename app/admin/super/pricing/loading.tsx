import { Skeleton, SkeletonLine } from '@/components/ui/skeleton'

/**
 * The rate card, while it loads.
 *
 * Same reason as `app/admin/audit/loading.tsx`: the shell's skeleton is the run
 * board, and this page is a settings form over a zone table. It was flashing
 * run cards at somebody about to edit prices.
 *
 * Shaped as the form is: a couple of grouped field rows, then the zone table
 * that carries the actual fees.
 */
export default function PricingLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <SkeletonLine w="w-72" />
      </div>

      {/* Grouped settings fields, two across as the form renders them. */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <Skeleton className="h-4 w-36" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <SkeletonLine w="w-24" className="h-3" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* The zone table. */}
      <div className="rounded-lg border">
        <div className="flex gap-4 border-b bg-muted/40 px-3 py-2">
          {['w-24', 'w-20', 'w-20', 'w-16'].map((w) => (
            <SkeletonLine key={w} w={w} className="h-3" />
          ))}
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 border-b px-3 py-2.5 last:border-b-0">
            {['w-24', 'w-20', 'w-20', 'w-16'].map((w) => (
              <SkeletonLine key={w} w={w} className="h-3.5" />
            ))}
          </div>
        ))}
      </div>

      <Skeleton className="h-11 w-32 rounded-md" />
    </div>
  )
}
