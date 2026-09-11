'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  isNewSince,
  unseenCount,
  type NotificationGroup,
} from '@/lib/orders/notifications'
import { markNoticesSeen } from '@/lib/notices/actions'
import { NoticeBell } from '@/components/shared/notice-bell'
import { NotificationRow } from '@/components/orders/notification-row'
import { NotificationDetail } from '@/components/orders/notification-detail'
import { useT } from '@/components/shared/i18n-provider'

/**
 * The shop's updates, in the header — the same bell, badge and drawer the
 * office uses.
 *
 * WHAT THIS REPLACED. This feed had a bottom-bar tab, a desktop nav tab and a
 * full page, for news the office reaches with one icon. Moving it to the header
 * also freed the fifth tab, which is the one that made a Burmese `ShopTabs`
 * wrap and doubled the height of a FIXED bottom bar on every phone.
 *
 * LIVE, unlike the office bell. `shop-parcel-alert` already holds a
 * `shop-parcels:${userId}` realtime channel on every shop page, debounced into
 * `router.refresh()`, and every status event is written alongside an `orders`
 * UPDATE -- so this count moves on its own with no new socket. The office bell
 * has no such channel and updates on navigation.
 *
 * THE PAGE IS STILL THERE. `getShopNotifications` defaults to 120 events, which
 * is a page and not a panel, so the drawer shows the recent ones and links on.
 */
export function ShopNoticeBell({
  groups,
  seenAt,
}: {
  groups: NotificationGroup[]
  /** `profiles.notices_seen_at`, or null when they have never looked. */
  seenAt: string | null
}) {
  const t = useT()
  const unseen = unseenCount(groups, seenAt)
  const [open, setOpen] = React.useState<NotificationGroup | null>(null)

  // Enough to answer "what happened while I was away" without turning the
  // panel into the page it links to.
  const recent = groups.slice(0, 8)

  return (
    <>
    <NoticeBell
      unseen={unseen}
      ariaLabel={unseen > 0 ? `${t('sn.title')}, ${unseen}` : t('sn.title')}
      title={t('sn.title')}
      description={t('sn.hint')}
      isEmpty={groups.length === 0}
      empty={
        <div className="text-center">
          <p className="font-medium">{t('sn.empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('sn.emptyHint')}</p>
        </div>
      }
      onOpen={markNoticesSeen}
    >
      {(close) => (
        <>
          <ul className="-mx-1">
            {recent.map((group) => (
              <NotificationRow
                key={group.key}
                group={group}
                isNew={isNewSince(group.at, seenAt)}
                compact
                onNavigate={close}
                onOpen={(g) => {
                  // The drawer closes behind the modal: two stacked panels on a
                  // phone leaves the detail in a 60%-height strip.
                  close()
                  setOpen(g)
                }}
              />
            ))}
          </ul>
          <Link
            href="/shop/notifications"
            onClick={close}
            className="mt-3 flex min-h-11 items-center justify-center rounded-md border text-sm font-medium hover:bg-muted/50"
          >
            {t('sn.seeAll')}
          </Link>
        </>
      )}
    </NoticeBell>
    <NotificationDetail group={open} onClose={() => setOpen(null)} />
    </>
  )
}
