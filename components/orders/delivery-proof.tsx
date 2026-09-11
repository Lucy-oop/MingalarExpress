'use client'

import * as React from 'react'
import { Camera, ImageOff, X } from 'lucide-react'
import { Overlay } from '@/components/ui/overlay'
import { useT } from '@/components/shared/i18n-provider'

/**
 * The photo the rider took at the door, on the customer's tracking page.
 *
 * IT SITS INSIDE THE DELIVERED STEP, not under the card, because the question
 * it answers is "what happened at that checkpoint" — and a photo floating below
 * a timeline reads as decoration rather than as evidence attached to a moment.
 *
 * WHAT THIS IS ALLOWED TO RECEIVE. A SIGNED, SHORT-LIVED URL and nothing else.
 * `delivery-proofs` is a private bucket whose only read policy is
 * `to authenticated`, so an anonymous visitor can never fetch an object itself;
 * the tracking page signs one specific object server-side, after `track_order`
 * has already matched the code, and passes the link down. The object PATH never
 * reaches the browser. Do not "simplify" this by handing the path to the client
 * and signing there — there is no session to sign with, and the fix somebody
 * would reach for next is a storage policy for `anon`, which would expose every
 * proof in the bucket to a guessed path.
 *
 * THE FALLBACK IS A REAL STATE, not an absence. A delivered parcel with no
 * photo is ordinary — proof is enforced by `orders_delivered_needs_proof` at
 * the point of delivery, but older rows predate it and a KBZPay receipt is
 * stored separately. Rendering nothing would leave a gap in the timeline that
 * looks like a layout bug; saying so keeps the step intact.
 */
export function DeliveryProof({ url }: { url: string | null }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  if (!url) {
    return (
      <p className="mt-2 flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
        <ImageOff className="size-3.5 shrink-0" aria-hidden="true" />
        {t('track.proofNone')}
      </p>
    )
  }

  return (
    <>
      <div className="mt-2">
        <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          <Camera className="size-3.5" aria-hidden="true" />
          {t('track.proof')}
        </p>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${t('track.proof')} — ${t('track.proofEnlarge')}`}
          className="group relative block w-full max-w-56 overflow-hidden rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed,
              five-minute storage URL on a private bucket. next/image would need
              the Supabase host allow-listed and would proxy every doorway photo
              through the app server for no benefit. */}
          <img
            src={url}
            alt={t('track.proof')}
            className="aspect-[4/3] w-full object-cover transition-transform group-active:scale-[0.98]"
          />
          {/*
            The overlay is the affordance. A bare thumbnail on a phone reads as
            an illustration; the icon and the line under it are what say the
            picture is the point and that there is more of it.
          */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-[11px] font-medium text-white">
            <Camera className="size-3.5 shrink-0" aria-hidden="true" />
            {t('track.proofEnlarge')}
          </span>
        </button>
      </div>

      {open ? (
        <Overlay
          open
          onClose={() => setOpen(false)}
          side="center"
          title={t('track.proof')}
          className="max-w-3xl"
        >
          {/* Escape, the backdrop and the panel's own dismiss all come from
              Overlay; this adds the explicit X the brief asked for, over the
              image where a thumb already is. */}
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img
              src={url}
              alt={t('track.proof')}
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('track.proofClose')}
              className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </Overlay>
      ) : null}
    </>
  )
}
