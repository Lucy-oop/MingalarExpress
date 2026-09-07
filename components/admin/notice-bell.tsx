'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, Store } from 'lucide-react'
import { markNoticesSeen } from '@/lib/admin/actions'
import { unseenCount, type OfficeNotice } from '@/lib/admin/notices'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { cn, formatDateTimeYangon } from '@/lib/utils'

/**
 * What the office has not seen yet, in the header of every admin page.
 *
 * WHY IT IS HERE AND NOT ON A PAGE. A merchant registers and is trading in the
 * same minute, so nothing makes the office look. The notice on /admin/super
 * only helps somebody who happens to be on /admin/super, and it is a worklist
 * that empties as they work it -- reviewing a shop erased the record that it
 * ever registered.
 *
 * A DRAWER, NOT A DROPDOWN. `components/ui/overlay` already handles Escape, the
 * backdrop, the scroll lock and returning focus to the trigger, and it was
 * hand-rolled precisely so this app does not ship a headless-UI dependency to
 * cheap Android phones. A bespoke popover here would be a second, worse copy of
 * that -- and on a phone a full-height panel beats a dropdown pinned to a
 * 40-pixel button.
 *
 * DISPATCHERS SEE IT TOO. The header is shared, `shops_read_dispatch` admits
 * them to the underlying rows, and the marker is written through
 * `profiles_update_self` -- so the count is per person and a dispatcher can
 * clear their own.
 */
export function NoticeBell({
  notices,
  seenAt,
}: {
  notices: OfficeNotice[]
  /** `profiles.notices_seen_at`. Null means they have never opened this. */
  seenAt: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()
  /*
    THE COUNT IS FROZEN AT OPEN, deliberately. Marking seen and refreshing would
    otherwise empty the badge while the panel is still on screen and the reader
    is halfway down it, so the list they are looking at would stop matching the
    number that made them look.
  */
  const [dismissed, setDismissed] = useState(false)

  const unseen = dismissed ? 0 : unseenCount(notices, seenAt)

  function show() {
    setOpen(true)
    if (unseen === 0) return
    setDismissed(true)
    /*
      Fire and forget. A failed write costs a badge that stays up until the next
      visit; blocking the panel from opening on a round trip whose only job is
      to clear a number would be worse. `markNoticesSeen` logs its own failures.
    */
    startTransition(async () => {
      await markNoticesSeen()
      router.refresh()
    })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={show}
        // The count is in the label, not only in the badge: a screen reader
        // reaching a bare bell icon learns nothing.
        aria-label={unseen > 0 ? `Office updates, ${unseen} new` : 'Office updates'}
        className="relative"
      >
        <Bell />
        {unseen > 0 ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center',
              'rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white',
            )}
          >
            {/* Two digits is the most that fits; beyond that the exact number
                stops being the point. */}
            {unseen > 9 ? '9+' : unseen}
          </span>
        ) : null}
      </Button>

      <Overlay
        open={open}
        onClose={() => setOpen(false)}
        title="Office updates"
        description="New shops as they register. Reviewing one does not remove it from here."
      >
        {notices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. A shop registering will show up here.
          </p>
        ) : (
          <ul className="divide-y">
            {notices.map((n) => {
              const isNew = unseenCount([n], seenAt) > 0
              return (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    // min-h-11 rather than padding alone: this is a tap target
                    // on a tablet at the hub, not only a click target.
                    className="flex min-h-11 items-start gap-3 py-3 hover:bg-muted/50"
                  >
                    <Store className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {n.title}
                        {isNew ? (
                          <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase text-destructive">
                            new
                          </span>
                        ) : null}
                      </span>
                      {n.detail ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {n.detail}
                        </span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTimeYangon(n.at)}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Overlay>
    </>
  )
}
