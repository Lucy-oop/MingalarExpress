import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { searchShopOrders } from '@/lib/orders/queries'
import { OrderTable } from '@/components/orders/order-table'
import { OrderFilters } from '@/components/orders/order-filters'
import { ShopLiveRefresh } from '@/components/orders/shop-live-refresh'
import { buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'

export const metadata: Metadata = { title: 'Orders' }
export const dynamic = 'force-dynamic'

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]
const isStatus = (v: string | undefined): v is OrderStatus =>
  !!v && (STATUSES as string[]).includes(v)
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

type Search = { status?: string; q?: string; from?: string; to?: string; page?: string }

export default async function ShopOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  await requireShop()
  const sp = await searchParams

  // Every parameter is validated before it reaches a query. A bad `?page=abc`
  // falls back to page 1 rather than erroring — the list is the shop's main
  // working surface and must not be takeable down by a URL.
  const filters = {
    status: isStatus(sp.status) ? sp.status : null,
    q: sp.q?.trim() || null,
    from: isDate(sp.from) ? sp.from : null,
    to: isDate(sp.to) ? sp.to : null,
    page: Number.parseInt(sp.page ?? '1', 10) || 1,
  }

  let result
  try {
    result = await searchShopOrders(filters)
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
    return `/shop/orders?${p.toString()}`
  }

  return (
    <div className="space-y-4">
      <ShopLiveRefresh />

      <h1 className="text-xl font-semibold">Orders</h1>

      <OrderFilters total={total} exportHref={`/shop/orders/export?${qs.toString()}`} />

      <OrderTable orders={rows} />

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
  // A disabled span rather than a dead link, so keyboard and screen-reader users
  // are not offered a control that does nothing.
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-events-none opacity-50')}
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
