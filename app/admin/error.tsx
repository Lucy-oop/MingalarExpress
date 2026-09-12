'use client'

import { ErrorPanel } from '@/components/shared/error-panel'

/**
 * The office panel's error boundary.
 *
 * ENGLISH ONLY, deliberately, and unlike the shop and rider boundaries beside
 * it. `app/admin/layout.tsx` mounts no I18nProvider — the panel is
 * English-only whatever the locale cookie says, which is the same reason the
 * shop and rider shells carry `lang` and the admin one does not. Calling
 * `useT()` here would throw inside an error boundary, which is the worst place
 * in the app to throw.
 *
 * Like its siblings, this does NOT catch a failure in `app/admin/layout.tsx`
 * itself; those reach `app/global-error.tsx`.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <ErrorPanel
      error={error}
      retry={retry}
      title="Something went wrong"
      body="This screen could not load. No parcel, run or settlement was changed."
      retryLabel="Try again"
      persistsLabel="If it keeps happening, check the server logs for the reference below."
      callLabel="Call the office"
      moreLabel="More ways to reach us"
      referenceLabel="Reference"
    />
  )
}
