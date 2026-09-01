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

  React.useEffect(() => {
    if (!open) return

    restoreRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
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
    }
  }, [open, onClose])

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
