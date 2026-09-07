import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Banknote, MapPinned, Percent, UserCheck } from 'lucide-react'
import { getAdminOverview, getCodPositions, getRiders } from '@/lib/admin/queries'
import { getNewShopNotices } from '@/lib/admin/shop-queries'
import { Kpi, PageHeader } from '@/components/admin/kpi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'

export const metadata: Metadata = { title: 'Super Admin' }
export const dynamic = 'force-dynamic'

export default async function SuperAdminOverviewPage() {
  const [overview, riders, positions, newShops] = await Promise.all([
    getAdminOverview(),
    getRiders(),
    getCodPositions(),
    getNewShopNotices(),
  ])

  const pending = riders.filter((r) => !r.isActive)
  const overFloat = positions.filter(
    (p) => p.cod_float_limit > 0 && p.open_balance >= p.cod_float_limit,
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Super Admin"
        description="Fleet, money and configuration for the Greater Yangon routes. Figures come from the COD ledger, which is the book of record — never recomputed from orders."
      />

      {/* Things that need a human today, before the numbers. */}
      <div className="space-y-2">
        {/*
          NEW SHOPS, FIRST IN THE LIST. Since 0031 these are already trading —
          booking prepaid parcels right now — so this is not a queue holding
          anyone up. It is the opposite: every hour a real merchant sits here is
          an hour they cannot take cash, which is most of why they signed up.
          That makes it the most time-sensitive thing on this page, so it goes
          above the rider approvals and the float warnings.
        */}
        {newShops.length > 0 ? (
          <Alert
            tone="info"
            title={`${newShops.length} new shop${newShops.length === 1 ? '' : 's'} to review`}
          >
            <p className="text-xs">
              They can book prepaid parcels already. Reviewing one unlocks cash on delivery for
              it.
            </p>
            <ul className="mt-2 space-y-1.5">
              {newShops.map((s) => (
                <li key={s.shopId}>
                  {/* Straight into the detail view for THAT shop — the review
                      screen already exists, it just had no way in from here. */}
                  <Link
                    href={`/admin/shops?shop=${s.shopId}`}
                    className="flex flex-wrap items-baseline gap-x-2 rounded text-sm hover:underline"
                  >
                    <span className="font-medium">{s.name ?? 'Unnamed shop'}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.goodsType ? `${s.goodsType} · ` : ''}
                      {s.ownerName}
                      {s.ownerPhone ? ` · ${formatMyanmarPhone(s.ownerPhone)}` : ''}
                    </span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDateTimeYangon(s.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {pending.length > 0 ? (
          <Alert tone="info" title={`${pending.length} rider${pending.length === 1 ? '' : 's'} waiting for approval`}>
            <Link href="/admin/super/riders" className="underline underline-offset-2">
              Review registrations
            </Link>{' '}
            — a held account cannot sign in until it is approved.
          </Alert>
        ) : null}

        {overFloat.length > 0 ? (
          <Alert
            tone="error"
            title={`${overFloat.length} rider${overFloat.length === 1 ? ' is' : 's are'} at or over the COD float limit`}
          >
            Dispatch has stopped offering them COD work. Take a deposit or settle them:{' '}
            {overFloat.slice(0, 4).map((p, i) => (
              <span key={p.rider_id}>
                {i > 0 ? ', ' : ''}
                <Link
                  href={`/admin/audit?rider=${p.rider_id}`}
                  className="underline underline-offset-2"
                >
                  {p.full_name}
                </Link>{' '}
                ({formatMmk(p.open_balance)})
              </span>
            ))}
            {overFloat.length > 4 ? ` and ${overFloat.length - 4} more` : null}.
          </Alert>
        ) : null}

        {overview.settlements_open > 0 || overview.settlements_unpaid > 0 ? (
          <Alert tone="info" title="Settlements are waiting">
            {overview.settlements_open} drafted awaiting approval, {overview.settlements_unpaid}{' '}
            approved but not yet paid out.{' '}
            <Link href="/admin/super/settlements" className="underline underline-offset-2">
              Open the settlement engine
            </Link>
            .
          </Alert>
        ) : null}
      </div>

      {/* Today's operations */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Today</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Orders" value={overview.orders_today} />
          <Kpi label="Delivered" value={overview.delivered_today} tone="good" />
          <Kpi
            label="Pending"
            value={overview.pending_now}
            hint="unassigned"
            tone={overview.pending_now > 0 ? 'warn' : 'default'}
            href="/admin/dispatcher"
          />
          <Kpi label="In flight" value={overview.in_flight_now} href="/admin/dispatcher" />
          <Kpi
            label="Riders online"
            value={`${overview.riders_online} / ${overview.riders_total}`}
            href="/admin/super/riders"
          />
          <Kpi
            label="Wards active"
            value={overview.areas_total}
            href="/admin/super/areas"
          />
        </div>
      </section>

      {/* Money */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Money</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi
            label="COD outstanding"
            value={formatMmk(overview.cod_outstanding)}
            hint="unsettled, net of commission"
            tone={overview.cod_outstanding > 0 ? 'warn' : 'good'}
            href="/admin/audit"
          />
          <Kpi label="Delivery fees today" value={formatMmk(overview.fees_today)} />
          <Kpi
            label="Rider earnings today"
            value={formatMmk(overview.rider_earnings_today)}
            hint="commission booked"
          />
          <Kpi
            label="Platform share today"
            value={formatMmk(overview.fees_today - overview.rider_earnings_today)}
          />
          <Kpi
            label="Riders over float"
            value={overview.riders_over_float}
            tone={overview.riders_over_float > 0 ? 'bad' : 'good'}
            href="/admin/audit"
          />
        </div>
      </section>

      {/* Pending approvals, in full */}
      {pending.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <UserCheck className="size-4" />
              Awaiting approval
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {pending.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatMyanmarPhone(r.phone)} · {r.baseArea ?? 'no base ward'} ·{' '}
                      {r.coverageKm} km
                    </p>
                  </div>
                  <Badge tone="amber">Held</Badge>
                </li>
              ))}
            </ul>
            <Link
              href="/admin/super/riders"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Approve on the roster <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* Where to go next */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NavCard
          href="/admin/super/riders"
          icon={<UserCheck className="size-4" />}
          title="Riders"
          body="Register, approve, suspend. Set base ward, radius, parcel cap and COD float limit."
        />
        <NavCard
          href="/admin/super/areas"
          icon={<MapPinned className="size-4" />}
          title="Coverage & rates"
          body="Delivery zones and what each costs, the wards in them, and the served bounds."
        />
        <NavCard
          href="/admin/super/pricing"
          icon={<Percent className="size-4" />}
          title="Pricing & commission"
          body="Fee tiers and the rider / platform split. Live orders keep the rate they were assigned at."
        />
        <NavCard
          href="/admin/super/settlements"
          icon={<Banknote className="size-4" />}
          title="Settlements"
          body="Draft the day, take cash in, approve and pay out."
        />
      </section>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        Money figures are whole kyat and come from <code>cod_ledger</code>. The ledger is append
        only — corrections are booked as adjustments in the{' '}
        <Link href="/admin/audit" className="underline underline-offset-2">
          COD audit explorer
        </Link>
        , never edited.
      </p>
    </div>
  )
}

function NavCard({
  href,
  icon,
  title,
  body,
}: {
  href: string
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
        <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </Link>
  )
}
