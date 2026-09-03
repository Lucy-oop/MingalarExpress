import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireDispatch } from '@/lib/auth/guards'
import { searchAllOrders, getShopOptions } from '@/lib/admin/order-queries'
import { AdminOrderTable } from '@/components/admin/admin-order-table'
import { OrderFilters } from '@/components/orders/order-filters'
import { ShopPicker } from '@/components/admin/shop-picker'
import { PageHeader } from '@/components/admin/kpi'
import { buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'

export const metadata: Metadata = { title: 'Orders · Admin' }
export const dynamic = 'force-dynamic'

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]
const isStatus = (v: string | undefined): v is OrderStatus =>
  !!v && (STATUSES as string[]).includes(v)
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

type Search = {
  status?: string
  q?: string
  from?: string
  to?: string
  page?: string
  shop?: string
  view?: string
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  await requireDispatch()
  const sp = await searchParams

  const filters = {
    // Two saved views for the states nobody is acting on. Neither is a status,
    // so neither can be a value in the status dropdown.
    awaitingShop: sp.view === 'awaiting',
    returning: sp.view === 'returning',
    shopId: sp.shop || null,
    status: isStatus(sp.status) ? sp.status : null,
    q: sp.q?.trim() || null,
    from: isDate(sp.from) ? sp.from : null,
    to: isDate(sp.to) ? sp.to : null,
    page: Number.parseInt(sp.page ?? '1', 10) || 1,
  }

  let result
  let shops
  try {
    ;[result, shops] = await Promise.all([searchAllOrders(filters), getShopOptions()])
  } catch (error) {
    return (
      <Alert tone="error" title="Orders unavailable">
        {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    )
  }

  const { rows, total, page, pageCount } = result
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') qs.set(k, v)
  const pageHref = (n: number) => {
    const p = new URLSearchParams(qs)
    if (n > 1) p.set('page', String(n))
    return `/admin/orders?${p.toString()}`
  }
  const viewHref = (v: string | null) => {
    const p = new URLSearchParams(qs)
    if (v) p.set('view', v)
    else p.delete('view')
    p.delete('page')
    return `/admin/orders?${p.toString()}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="All orders"
        description="Every parcel, every shop. The screen to open when a customer rings."
      />

      {/* Saved views, not statuses. "Waiting on a shop" and "Returning" are
          conditions spanning several columns, and they are the two states in
          which a parcel can sit for days with nobody acting on it. */}
      <nav className="flex flex-wrap gap-1 rounded-lg border bg-card p-1" aria-label="Saved views">
        {[
          { key: null, label: 'All' },
          { key: 'awaiting', label: 'Waiting on a shop' },
          { key: 'returning', label: 'Returning to a shop' },
        ].map((v) => {
          const active = (sp.view ?? null) === v.key
          return (
            <Link
              key={v.label}
              href={viewHref(v.key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {v.label}
            </Link>
          )
        })}
      </nav>

      <OrderFilters
        total={total}
        basePath="/admin/orders"
        exportHref={`/admin/orders/export?${qs.toString()}`}
        extra={<ShopPicker shops={shops} value={sp.shop ?? ''} basePath="/admin/orders" />}
      />

      <AdminOrderTable orders={rows} />

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          <PageLink href={pageHref(page - 1)} disabled={page <= 1}>
            <ChevronLeft />
            Newer
          </PageLink>
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <PageLink href={pageHref(page + 1)} disabled={page >= pageCount}>
            Older
            <ChevronRight />
          </PageLink>
        </nav>
      ) : null}
    </div>
  )
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string
  disabled: boolean
  children: React.ReactNode
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'pointer-events-none opacity-50',
        )}
      >
        {children}
      </span>
    )
  }
  return (
    <Link href={href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      {children}
    </Link>
  )
}
