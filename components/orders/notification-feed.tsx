'use client'

import { useEffect, useRef, useState } from 'react'
import { PackageCheck } from 'lucide-react'
import type { NotificationGroup } from '@/lib/orders/notifications'
import { useT } from '@/components/shared/i18n-provider'
import { markNoticesSeen } from '@/lib/notices/actions'
import { isNewSince } from '@/lib/orders/notifications'
import { NotificationRow } from '@/components/orders/notification-row'
import { NotificationDetail } from '@/components/orders/notification-detail'

/**
 * The shop's feed, in full, at /shop/notifications.
 *
 * THE MARKER IS DURABLE NOW. This used to keep its own read marker in
 * `localStorage` under `mge:shop:seenEvents:<id>`, and its docblock stated the
 * cost honestly: per-device, so read on the phone and still bold on the laptop.
 * The reasoning was that a durable marker needed a table, a write path and a
 * migration -- and 0035 built all three for the header bell, so the objection
 * expired. `seenAt` now arrives from the server, which also means the FIRST
 * PAINT marks the right rows instead of waiting for an effect.
 *
 * AND IT AGREES WITH THE BELL. The old `isNew` was
 * `seen !== null && at > seen`, so a shop that had NEVER looked saw nothing
 * highlighted, while `unseenCount` counted everything. `isNewSince` is the one
 * rule both use: no marker means everything is new, because a first visit
 * should show what was missed.
 *
 * ROWS COME FROM `notification-row`, shared with the header drawer so the two
 * cannot drift.
 */
export function NotificationFeed({
  groups,
  seenAt,
}: {
  groups: NotificationGroup[]
  /** `profiles.notices_seen_at`, or null when they have never looked. */
  seenAt: string | null
}) {
  const t = useT()

  /*
    ADVANCED ON VIEW, ONCE. Opening the page IS reading it, so the marker moves
    -- but only on mount, and a ref rather than a dependency because the action
    is fire-and-forget and re-running it on every render would be a pointless
    write. No `router.refresh()` either: the rows are already correct on screen,
    and refreshing would restyle them out from under the reader mid-scroll.
  */
  const [open, setOpen] = useState<NotificationGroup | null>(null)

  const marked = useRef(false)
  useEffect(() => {
    if (marked.current) return
    marked.current = true
    void markNoticesSeen()
  }, [])

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-10 text-center">
        <PackageCheck className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t('sn.empty')}</p>
        <p className="text-sm text-muted-foreground">{t('sn.emptyHint')}</p>
      </div>
    )
  }

  return (
    <>
      <ul className="space-y-2">
        {groups.map((group) => (
          <NotificationRow
            key={group.key}
            group={group}
            isNew={isNewSince(group.at, seenAt)}
            onOpen={setOpen}
          />
        ))}
      </ul>
      {/* The modal lives HERE, not inside the row, so only one can ever be
          open and a row stays a row. */}
      <NotificationDetail group={open} onClose={() => setOpen(null)} />
    </>
  )
}
