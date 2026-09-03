import type { Metadata } from 'next'
import { PackageOpen, WifiOff } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { getRiderFeed } from '@/lib/rider/queries'
import { RiderDashboard } from '@/components/rider/rider-dashboard'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'Jobs' }

/** Never cached: a stale jobs feed offers work that is already gone. */
export const dynamic = 'force-dynamic'

export default async function RiderDashboardPage() {
  const { userId } = await requireRider()
  const [feed, locale] = await Promise.all([getRiderFeed(userId), getLocale()])
  const t = translator(locale)

  if (!feed.profile) {
    return (
      <Alert tone="error" title="Rider profile missing">
        Your account is not set up as a rider yet. Contact the Mingalar Express office.
      </Alert>
    )
  }

  return <RiderDashboard riderId={userId} feed={feed} locale={locale} t={t} />
}
