import { cn } from '@/lib/utils'

/**
 * A grey block that stands where content will be.
 *
 * WHY THIS ARRIVED WITH `loading.tsx` AND NOT BEFORE. There was no streaming
 * boundary anywhere in the app — no `loading.tsx`, no `<Suspense>`, in any of
 * the 39 route directories. So a navigation held the old page on screen, fully
 * interactive-looking, until the entire server render finished. Nothing
 * acknowledged the tap. On a run board that took two seconds, the honest
 * reading of the screen was "this app ignored me".
 *
 * A skeleton is not decoration here, it is the acknowledgement. It also buys
 * something concrete: Next can only prefetch a dynamic route's loading
 * boundary, so until one existed, `<Link>` prefetch had nothing to fetch for
 * any of these routes and every click paid the full round trip cold.
 *
 * DELIBERATELY DUMB. No shimmer sweep, no layered gradients: this renders on
 * the low-end Android the rider app is built for, where an animated gradient
 * across a full screen costs a compositing layer per frame. `animate-pulse` is
 * an opacity keyframe and nothing else.
 *
 * `aria-hidden`, because a screen reader should hear the real content when it
 * arrives, not a description of grey rectangles. The route's own
 * `role="status"` region (where one exists) carries the announcement.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} />
  )
}

/** A line of text-height skeleton. `w` is any Tailwind width class. */
export function SkeletonLine({ w = 'w-full', className }: { w?: string; className?: string }) {
  return <Skeleton className={cn('h-4', w, className)} />
}
