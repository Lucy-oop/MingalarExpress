import type { Metadata } from 'next'
import { PackageOpen, WifiOff } from 'lucide-react'
import { requireRider } from '@/lib/auth/guards'
import { getRiderFeed } from '@/lib/rider/queries'
import { RiderDashboard } from '@/components/rider/rider-dashboard'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'Jobs' }

/** Never cached: a stale jobs feed offers work that is already gone. */
export const dynamic = 'force-dynamic'

export default async function RiderDashboardPage() {
  const { userId } = await requireRider()
  const feed = await getRiderFeed(userId)

  // Not translated on purpose: a rider whose profile is missing cannot work, and
  // this is the message that gets read out to the office over the phone.
  if (!feed.profile) {
    return (
      <Alert tone="error" title="Rider profile missing">
        Your account is not set up as a rider yet. Contact the Mingalar Express office.
      </Alert>
    )
  }

  return <RiderDashboard riderId={userId} feed={feed} />
}
