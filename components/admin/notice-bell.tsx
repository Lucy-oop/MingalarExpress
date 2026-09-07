'use client'

import Link from 'next/link'
import { Store } from 'lucide-react'
import { markNoticesSeen } from '@/lib/notices/actions'
import { unseenCount, type OfficeNotice } from '@/lib/admin/notices'
import { NoticeBell } from '@/components/shared/notice-bell'
import { isNewSince } from '@/lib/orders/notifications'
import { formatDateTimeYangon } from '@/lib/utils'

/**
 * What the office has not seen yet, in the header of every admin page.
 *
 * WHY IT IS HERE AND NOT ON A PAGE. A merchant registers and is trading in the
 * same minute, so nothing makes the office look. The notice on /admin/super
 * only helps somebody who happens to be on /admin/super, and it is a worklist
 * that empties as they work it -- reviewing a shop erased the record that it
 * ever registered.
 *
 * The bell, the badge and the drawer live in `components/shared/notice-bell`,
 * which the shop shell uses too. Only the ROWS are here: an office notice is a
 * title and a line of detail, where a shop's is colour-coded by kind.
 *
 * DISPATCHERS SEE IT TOO. The header is shared, `shops_read_dispatch` admits
 * them to the underlying rows, and the marker is written through
 * `profiles_update_self` -- so the count is per person and a dispatcher can
 * clear their own.
 */
export function AdminNoticeBell({
  notices,
  seenAt,
}: {
  notices: OfficeNotice[]
  /** `profiles.notices_seen_at`. Null means they have never opened this. */
  seenAt: string | null
}) {
  const unseen = unseenCount(notices, seenAt)

  return (
    <NoticeBell
      unseen={unseen}
      ariaLabel={unseen > 0 ? `Office updates, ${unseen} new` : 'Office updates'}
      title="Office updates"
      description="New shops as they register. Reviewing one does not remove it from here."
      isEmpty={notices.length === 0}
      empty={
        <p className="text-sm text-muted-foreground">
          Nothing yet. A shop registering will show up here.
        </p>
      }
      onOpen={markNoticesSeen}
    >
      {(close) => (
        <ul className="divide-y">
          {notices.map((n) => (
            <li key={n.id}>
              <Link
                href={n.href}
                onClick={close}
                // min-h-11 rather than padding alone: this is a tap target on a
                // tablet at the hub, not only a click target.
                className="flex min-h-11 items-start gap-3 py-3 hover:bg-muted/50"
              >
                <Store
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {n.title}
                    {isNewSince(n.at, seenAt) ? (
                      <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase text-destructive">
                        new
                      </span>
                    ) : null}
                  </span>
                  {n.detail ? (
                    <span className="block truncate text-xs text-muted-foreground">{n.detail}</span>
                  ) : null}
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTimeYangon(n.at)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </NoticeBell>
  )
}
