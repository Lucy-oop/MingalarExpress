'use client'

import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Eye, QrCode, ShieldOff, TriangleAlert } from 'lucide-react'
import {
  createRiderSetupLink,
  revokeRiderSetupLink,
  type RiderSetupResult,
} from '@/lib/admin/rider-setup'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

/**
 * The rider scans this off the screen and their phone is signed in.
 *
 * VISIBLE FOR SIXTY SECONDS, then covered. The code on this screen is a bearer
 * credential -- a photograph of it from across a busy office is a working rider
 * account. Sixty seconds is long enough to hold a phone up to a monitor and
 * short enough that an admin who walks away has not left an account on display.
 * Re-showing costs one click and does NOT mint a new link: the same credential
 * is uncovered again, so the timer bounds exposure without multiplying tokens.
 *
 * SCANNING BEATS SENDING, and the layout says so. The QR is the whole top of
 * the dialog; copying the link is a small secondary button behind a warning,
 * because a link pasted into Viber lives in two chat histories, gets backed up
 * to iCloud or Google Drive, and outlives the minute it was needed for. The QR
 * never leaves the room.
 */
const REVEAL_SECONDS = 60

export function RiderSetupDialog({
  riderId,
  riderName,
  onClose,
}: {
  riderId: string
  riderName: string
  onClose: () => void
}) {
  const [state, setState] = useState<RiderSetupResult | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Minted once, when the dialog opens. Re-showing reuses it — see the note
  // above about not multiplying tokens.
  useEffect(() => {
    let live = true
    createRiderSetupLink(riderId)
      .then((result) => {
        if (live) setState(result)
      })
      .catch(() => {
        if (live) setState({ ok: false, message: 'Network problem — no link was created.' })
      })
    return () => {
      live = false
    }
  }, [riderId])

  const shown = secondsLeft > 0

  useEffect(() => {
    if (!state?.ok || !shown) return
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(timer)
  }, [state, shown])

  const reveal = useCallback(() => setSecondsLeft(REVEAL_SECONDS), [])

  async function revoke() {
    setRevoking(true)
    setNotice(null)
    try {
      const result = await revokeRiderSetupLink(riderId)
      setNotice(result.message)
      // The link on screen is the one just invalidated. Cover it rather than
      // leaving a dead QR that a rider might still try to scan.
      if (result.ok) setSecondsLeft(0)
    } catch {
      setNotice('Network problem — nothing was revoked. Try again.')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <Overlay
      open
      onClose={onClose}
      side="center"
      title={`Set up ${riderName}'s phone`}
      description="They scan this once. After that the app keeps them signed in and they never sign in again."
    >
      <div className="space-y-4">
        {state === null ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Creating a link…</p>
        ) : !state.ok ? (
          <Alert tone="error">{state.message}</Alert>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <div className="relative rounded-lg border bg-white p-3">
                <QRCodeSVG
                  value={state.link}
                  size={220}
                  level="M"
                  marginSize={0}
                  className={cn('block transition', !shown && 'blur-md')}
                />
                {!shown ? (
                  <button
                    type="button"
                    onClick={reveal}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-lg bg-background/80 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Eye className="size-5" aria-hidden="true" />
                    Show the code again
                  </button>
                ) : null}
              </div>

              <p
                className="text-xs text-muted-foreground"
                aria-live="polite"
                role="status"
              >
                {shown
                  ? `Hidden again in ${secondsLeft}s`
                  : 'Hidden. Anyone who photographs this code can sign in as this rider.'}
              </p>
            </div>

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <TriangleAlert
                  className="mt-0.5 size-3.5 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
                <span>
                  Scanning it here is safest. A link sent over Viber or Telegram stays in both
                  chat histories and gets backed up to the cloud — send it only if the rider is
                  not standing with you, and revoke it below once they are in.
                </span>
              </p>
              <CopyButton link={state.link} copied={copied} setCopied={setCopied} />
            </div>

            {notice ? <Alert tone="info">{notice}</Alert> : null}

            <div className="border-t pt-3">
              <p className="text-xs font-medium">If the phone is lost, or the link went astray</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Revoking stops any outstanding link working and marks the rider offline. It does
                not end a session they are already in — to do that, suspend the rider on the
                roster.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={revoke}
                disabled={revoking}
              >
                <ShieldOff />
                {revoking ? 'Revoking…' : 'Revoke this link'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  )
}

function CopyButton({
  link,
  copied,
  setCopied,
}: {
  link: string
  copied: boolean
  setCopied: (v: boolean) => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="mt-2"
      onClick={() => {
        navigator.clipboard
          ?.writeText(link)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
          .catch(() => setCopied(false))
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy the link instead'}
    </Button>
  )
}

/** The roster's trigger, so the dialog is only mounted while it is open. */
export function RiderSetupButton({
  riderId,
  riderName,
  disabled,
}: {
  riderId: string
  riderName: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? 'Activate this rider first' : undefined}
      >
        <QrCode />
        Set up phone
      </Button>
      {open ? (
        <RiderSetupDialog
          riderId={riderId}
          riderName={riderName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
