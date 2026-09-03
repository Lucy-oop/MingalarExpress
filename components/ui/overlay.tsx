'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Backdrop + panel, in two shapes: a right-hand drawer and a centred dialog.
 *
 * Hand-rolled rather than pulled from a dialog library for the same reason
 * `components/ui/select` is a native <select>: this runs on cheap Android
 * phones over patchy Yangon mobile data, and a headless UI dependency is a lot
 * of JavaScript for a backdrop and an Escape key.
 *
 * It still has to behave like a dialog, so: Escape closes, the backdrop closes,
 * background scroll is locked while open, focus moves into the panel on open
 * and returns to whatever opened it on close.
 */
export function Overlay({
  open,
  onClose,
  title,
  description,
  side = 'right',
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  side?: 'right' | 'center'
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const restoreRef = React.useRef<HTMLElement | null>(null)
  const titleId = React.useId()

  /**
   * `onClose` behind a ref, and this is the whole reason the bug below is fixed.
   *
   * THE BUG. This effect used to list `onClose` as a dependency. Every caller
   * passes an inline arrow — `onClose={() => setChoice(null)}` — which is a new
   * function on every render, so the effect tore down and set up again after
   * EVERY KEYSTROKE in any field inside a dialog: the cleanup restored focus to
   * the trigger, then the setup moved it to the panel. One character per click.
   *
   * It made the override reason on depart-dialog impossible to satisfy, since
   * that one demands ten characters.
   *
   * A ref keeps the latest handler reachable without making it reactive, so the
   * effect can depend on `open` alone and run once per open. Do not "fix" the
   * dependency array by adding onClose back.
   */
  const onCloseRef = React.useRef(onClose)
  React.useEffect(() => {
    onCloseRef.current = onClose
  })

  React.useEffect(() => {
    if (!open) return

    // Only claim focus if nothing inside the panel already has it. A child with
    // autoFocus is focused during commit, before this runs, and stealing it back
    // would defeat the point of asking for it.
    //
    // The restore target is captured in the same breath: when focus is already
    // inside the panel there is no outside element to remember, so such a dialog
    // does not return focus to its trigger on close. Worth the trade — a dialog
    // that cannot be typed into is a worse problem than one that ends with focus
    // on <body>.
    const panel = panelRef.current
    const active = document.activeElement as HTMLElement | null
    if (!panel?.contains(active)) {
      restoreRef.current = active
      panel?.focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    // Locking scroll on <body> stops the page behind the drawer scrolling under
    // a thumb drag, which on mobile is the difference between a drawer and a
    // confusing overlay.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
      restoreRef.current?.focus?.()
      restoreRef.current = null
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-dvh flex-col bg-background shadow-xl outline-none',
          side === 'right'
            ? 'ml-auto h-dvh w-full max-w-2xl border-l'
            : 'm-auto w-full max-w-lg rounded-lg border',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer ? <div className="border-t p-4">{footer}</div> : null}
      </div>
    </div>
  )
}
