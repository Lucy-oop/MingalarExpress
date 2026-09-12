'use client'

import { ErrorPanel } from '@/components/shared/error-panel'
import { useT } from '@/components/shared/i18n-provider'

/**
 * The rider shell's error boundary.
 *
 * BILINGUAL, and it can be: `error.tsx` for a segment renders INSIDE that
 * segment's layout — Next wraps the page, `loading.tsx` and nested layouts, but
 * not the layout beside it — so `app/rider/layout.tsx`'s I18nProvider sits
 * above this and `useT()` works.
 *
 * THE COROLLARY IS THE LIMIT OF THIS FILE: it does NOT catch a failure in
 * `app/rider/layout.tsx` itself, which is where the auth guard and the
 * shell's own queries live. Those bubble past this to `app/global-error.tsx` —
 * which is why that file exists, and why it repeats this copy rather than
 * importing it.
 */
export default function RiderError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const t = useT()
  return (
    <ErrorPanel
      error={error}
      retry={retry}
      title={t('err.title')}
      body={t('err.body')}
      retryLabel={t('err.retry')}
      persistsLabel={t('err.persists')}
      callLabel={t('contact.call')}
      moreLabel={t('contact.help')}
      referenceLabel={t('err.reference')}
    />
  )
}
