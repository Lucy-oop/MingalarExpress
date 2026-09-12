import { Skeleton, SkeletonLine } from '@/components/ui/skeleton'

/**
 * Shop settings, while it loads.
 *
 * WHY THIS ROUTE GETS ITS OWN. `app/shop/loading.tsx` is drawn like the
 * dashboard — a full-width money card over a 2x2 of counts — and it applies to
 * every route beneath it, so opening Settings flashed a COD figure and four
 * tiles before rendering a column of forms. On the screen where a shop edits
 * its own address and pickup point, a phantom money card is a strange thing to
 * show.
 *
 * The real page is a stack of cards, each a heading, a line of description and
 * some fields, so that is what this is: three of them, at descending weight.
 */
export default function SettingsLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-44" />

      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3 rounded-lg border bg-card p-5">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <SkeletonLine w="w-64" className="h-3" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-md" />
            {i === 0 ? <Skeleton className="h-10 w-full rounded-md" /> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
