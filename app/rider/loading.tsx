import { Skeleton, SkeletonLine } from '@/components/ui/skeleton'

/**
 * The rider's loading state.
 *
 * THIS ONE MATTERS MOST OF THE THREE. A rider taps a job on a phone, on a
 * bike mount, on two bars of signal — the surface least able to absorb a
 * silent two-second wait, and the one where a second tap on an unresponsive
 * card is most likely. Until this file existed there was no loading boundary
 * anywhere in the app, so the old screen simply sat there.
 *
 * Shaped like the dashboard: the online toggle, then the two ways. It renders
 * inside `app/rider/layout.tsx`, so the header, the queue banner and the tab
 * bar stay put and only the feed blinks.
 *
 * No spinner. A skeleton in the shape of the thing coming tells a rider WHERE
 * to look next; a spinner tells them only to wait.
 */
export default function RiderLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {/* The 72px online toggle — the tallest thing on the screen, so its
          absence is what makes the page look broken if it is left out. */}
      <Skeleton className="h-18 w-full rounded-xl" />

      <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>

      <Skeleton className="h-3 w-36" />

      {/* The next-stop card, at its real weight. */}
      <div className="space-y-2 rounded-xl border-2 p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-full" />
        <SkeletonLine w="w-1/2" />
        <Skeleton className="h-11 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
        </div>
      </div>

      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <SkeletonLine w="w-3/4" className="h-3" />
            <SkeletonLine w="w-1/2" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  )
}
