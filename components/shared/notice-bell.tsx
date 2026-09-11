'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The bell, the count and the drawer — everything the office feed and the shop
 * feed do identically.
 *
 * WHY A SHELL AND NOT ONE COMPONENT. The two feeds hold different things. The
 * office reads a title and a line of detail; a shop reads a KIND — gold for
 * collected, amber for a failed delivery, blue for a return — with parcel codes
 * and a shared reason. Flattening the shop's rows into the office's shape would
 * make the shop feed worse in the name of consistency, so the rows arrive as
 * `children` and only the frame is shared. Same placement, same interaction,
 * same keyboard behaviour; different contents, because they are different news.
 *
 * A DRAWER, NOT A DROPDOWN. `components/ui/overlay` already has Escape, the
 * backdrop, the scroll lock and returning focus to the trigger, and it was
 * hand-rolled precisely so this app does not ship a headless-UI dependency to
 * cheap Android phones. On a phone a full-height panel also beats a popover
 * pinned to a 40-pixel button.
 */
export function NoticeBell({
  unseen,
  ariaLabel,
  title,
  description,
  empty,
  isEmpty,
  onOpen,
  children,
}: {
  /** How many the reader has not seen. Zero hides the badge. */
  unseen: number
  /** Must carry the count: a screen reader meeting a bare bell learns nothing. */
  ariaLabel: string
  title: string
  description?: string
  /** Shown instead of `children` when there is nothing. */
  empty: React.ReactNode
  isEmpty: boolean
  /** Fire-and-forget side effect for "they have looked". */
  onOpen: () => Promise<void>
  /*
    A RENDER PROP, because the rows need to close the drawer and the drawer owns
    that state. This bell is mounted in a LAYOUT, so a Link inside it navigates
    client-side without unmounting anything -- the panel would otherwise stay
    open on top of the page it just sent the reader to.
  */
  children: (close: () => void) => React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()
  /*
    THE COUNT FREEZES AT OPEN, deliberately. Marking seen and refreshing would
    otherwise empty the badge while the panel is still on screen and the reader
    is halfway down it, so the list they are looking at would stop matching the
    number that made them look.
  */
  const [dismissed, setDismissed] = useState(false)
  const showing = dismissed ? 0 : unseen

  function show() {
    setOpen(true)
    if (showing === 0) return
    setDismissed(true)
    /*
      Fire and forget. A failed write costs a badge that stays up until the next
      visit; blocking the panel from opening on a round trip whose only job is
      to clear a number would be worse. The action logs its own failures.
    */
    startTransition(async () => {
      await onOpen()
      router.refresh()
    })
  }

  return (
    <>
      {/* 44px square, not the 32px `sm` this used to be. It is the most-tapped
          control in either header and it sits next to sign-out. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={show}
        aria-label={ariaLabel}
        className="relative size-11"
      >
        <Bell />
        {showing > 0 ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center',
              'rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white',
            )}
          >
            {/* Two characters is the most that fits, and past nine the exact
                number stops being the point. */}
            {showing > 9 ? '9+' : showing}
          </span>
        ) : null}
      </Button>

      <Overlay open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {isEmpty ? empty : children(() => setOpen(false))}
      </Overlay>
    </>
  )
}
