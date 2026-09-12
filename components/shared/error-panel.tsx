'use client'

import * as React from 'react'
import { RotateCw, TriangleAlert } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'
import { ContactSupport } from '@/components/shared/contact-support'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

/**
 * What a shell shows when the screen underneath it fails.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. Until now there was no `error.tsx` anywhere in the app, so
 * an unhandled render error fell through to Next's built-in page: in
 * production a bare "Application error: a client-side exception has occurred",
 * with no branding, no explanation, no way back and no phone number. On the
 * rider app that is somebody standing in the street holding a parcel.
 *
 * THE COPY DOES ONE JOB BEYOND APOLOGISING. Everyone who sees this screen is
 * carrying either parcels or cash, so the body says the thing they actually
 * want to know: nothing was lost. A render error cannot have eaten a delivery
 * — every write in this app goes through a server action and a transaction —
 * but a broken screen does not look that way to the person holding the bag.
 *
 * ---------------------------------------------------------------------------
 * `retry`, NOT `reset`. Next names this prop `retry` and its docs are explicit
 * that `reset` is the rarer one: retry re-fetches and re-renders the segment,
 * while reset only clears the boundary and re-renders the same children, which
 * for a server-render failure just fails again. The callers pass Next's own
 * `retry` straight through.
 *
 * THE PHONE IS FETCHED HERE, on the client, because an error boundary is a
 * Client Component and cannot await `getPublicSettings()`. `public_settings()`
 * is a definer RPC granted to `anon` for exactly this class of caller (0024).
 * It fails soft: no number simply means the "More ways to reach us" link is
 * the whole affordance, which is the same thing `ContactSupport` already does
 * on a login page.
 */
export function ErrorPanel({
  error,
  retry,
  title,
  body,
  retryLabel,
  persistsLabel,
  callLabel,
  moreLabel,
  referenceLabel,
}: {
  error: Error & { digest?: string }
  retry: () => void
  title: string
  body: string
  retryLabel: string
  persistsLabel: string
  callLabel: string
  moreLabel: string
  referenceLabel: string
}) {
  const [phone, setPhone] = React.useState<string | null>(null)
  const [retrying, startRetry] = React.useTransition()

  /*
    Logged so the digest in the server logs has something to be matched
    against from the browser side. Next's docs recommend it, and in production
    `error.message` is a generic string — the digest is the only real handle.
  */
  React.useEffect(() => {
    console.error('[error boundary]', error.digest ?? '(no digest)', error)
  }, [error])

  React.useEffect(() => {
    let live = true
    void (async () => {
      try {
        const { data } = await createClient().rpc('public_settings')
        const row = data as { support_phone?: string | null } | null
        if (live) setPhone(row?.support_phone ?? null)
      } catch {
        // The number is a courtesy; the /contact link below is the fallback.
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-10 text-center">
      <BrandMark tagline={false} size="sm" />

      <div className="flex size-14 items-center justify-center rounded-full bg-amber-100">
        <TriangleAlert className="size-7 text-amber-700" aria-hidden="true" />
      </div>

      {/*
        `role="alert"` rather than a bare heading: this replaces the content a
        screen-reader user was already on, with no navigation to announce it.
      */}
      <div role="alert">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
      </div>

      {/* Full width and touch-sized: on the rider app this is the only control
          on the screen, and it is pressed one-handed. */}
      <Button
        size="touch"
        block
        onClick={() => startRetry(() => retry())}
        disabled={retrying}
        className="text-base font-semibold"
      >
        <RotateCw className={retrying ? 'animate-spin' : undefined} />
        {retryLabel}
      </Button>

      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-muted-foreground">{persistsLabel}</p>
        <ContactSupport phone={phone} label={callLabel} moreLabel={moreLabel} />
      </div>

      {/*
        The digest, quietly. It is meaningless to the reader and it is the only
        thing that lets the office find this exact failure in the server logs,
        so it is present and small rather than absent or shouted.
      */}
      {error.digest ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          {referenceLabel}: {error.digest}
        </p>
      ) : null}
    </div>
  )
}
