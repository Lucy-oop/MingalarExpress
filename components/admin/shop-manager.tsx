'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Store, X } from 'lucide-react'
import type { ShopListResult, ShopListRow } from '@/lib/admin/shop-queries'
import type { ShopActionResult } from '@/lib/admin/shop-actions'
import { SHOP_STATUSES, SHOP_STATUS_LABEL, type ShopStatus } from '@/lib/validation/admin-shop'
import type { ServiceArea } from '@/types/domain'
import { ShopTable } from '@/components/admin/shop-table'
import { ShopDetailModal } from '@/components/admin/shop-detail-modal'
import { ShopStatusDialog } from '@/components/admin/shop-status-dialog'
import { ShopOnboardForm, type UnattachedOwner } from '@/components/admin/shop-onboard-form'
import { ShopConfirmDialog } from '@/components/admin/shop-confirm-dialog'
import { Kpi } from '@/components/admin/kpi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { cn, formatMmk } from '@/lib/utils'

type Feedback = { tone: 'success' | 'error'; message: string }

/** Everything the search box looks at, lowercased once per row. */
function haystack(r: ShopListRow): string {
  return [r.name, r.ownerName, r.ownerPhone, r.phone, r.pickupAddress, r.area]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function ShopManager({
  data,
  areas,
  owners,
}: {
  data: ShopListResult
  areas: ServiceArea[]
  owners: UnattachedOwner[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ShopStatus | 'all'>('all')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [, startTransition] = useTransition()

  const [detailRow, setDetailRow] = useState<ShopListRow | null>(null)

  /*
    OPENED BY URL, so a notice elsewhere can point AT a shop.
    `/admin/shops?shop=<id>` lands here and opens that shop's detail view — the
    review screen already existed and simply had no way in from outside this
    component's own state.

    The param is dropped once consumed: leaving it would re-open the drawer
    every time this list re-rendered, including after a Confirm, so an admin
    would have to close the same shop twice. Matched against the rows actually
    loaded, so a stale or invented id opens nothing rather than an empty panel.
  */
  const params = useSearchParams()
  const requested = params.get('shop')
  useEffect(() => {
    if (!requested) return
    const row = data.rows.find((r) => r.shopId === requested)
    if (row) setDetailRow(row)
    router.replace('/admin/shops', { scroll: false })
    // Deliberately not depending on `data.rows` by identity: a refresh would
    // re-run this against a param that is already gone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested])
  const [statusTarget, setStatusTarget] = useState<{
    row: ShopListRow
    action: 'activate' | 'suspend' | 'approve' | 'reject'
  } | null>(null)
  const [onboarding, setOnboarding] = useState(false)
  const [presetOwnerId, setPresetOwnerId] = useState<string | null>(null)
  /** The pending owner being confirmed — the quick path, not the full form. */
  const [confirming, setConfirming] = useState<UnattachedOwner | null>(null)

  const searchable = useMemo(
    () => data.rows.map((r) => ({ row: r, text: haystack(r) })),
    [data.rows],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return searchable
      .filter(({ row, text }) => {
        if (status !== 'all' && row.status !== status) return false
        return needle === '' || text.includes(needle)
      })
      .map(({ row }) => row)
  }, [searchable, query, status])

  function settle(result: ShopActionResult) {
    setFeedback({
      tone: result.ok ? 'success' : 'error',
      message: result.ok && result.warning ? `${result.message} ${result.warning}` : result.message,
    })
    if (result.ok) startTransition(() => router.refresh())
  }

  const { summary } = data

  return (
    <div className="space-y-4">
      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      {data.truncated ? (
        <Alert tone="error" title="Order counts are incomplete">
          The order scan hit its ceiling, so per-shop counts and in-flight COD are floors, not
          totals. Move this aggregation into a database function before trusting it.
        </Alert>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Summary                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {/* First, because it is the only tile that is a QUEUE. Not a queue of
            BLOCKED shops though -- every one of these is trading prepaid right
            now, and reviewing it unlocks cash on delivery. Hence 'default'
            rather than 'warn': amber on a tile of working shops reads as a
            fault, and the office has enough real amber to look at. */}
        <Kpi
          label="COD review"
          value={summary.awaiting}
          hint="trading prepaid, cash locked"
        />
        <Kpi label="Active shops" value={summary.active} tone="good" />
        <Kpi
          label="Suspended"
          value={summary.suspended}
          tone={summary.suspended > 0 ? 'bad' : 'default'}
        />
        <Kpi
          label="Pending setup"
          value={summary.pending}
          hint="signed up, no shop yet"
          tone={summary.pending > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="COD pending clearance"
          value={formatMmk(summary.codPendingClearance)}
          hint={`+${formatMmk(summary.codInFlight)} still on riders`}
          tone={summary.codPendingClearance > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Search + filter                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shop name, owner, phone or address…"
            className="pl-9"
            aria-label="Search shops"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex gap-1" role="group" aria-label="Filter by status">
          <FilterChip active={status === 'all'} onClick={() => setStatus('all')}>
            All ({data.rows.length})
          </FilterChip>
          {SHOP_STATUSES.map((s) => (
            <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
              {SHOP_STATUS_LABEL[s]} ({summary[s]})
            </FilterChip>
          ))}
        </div>

        <Button
          onClick={() => {
            setPresetOwnerId(null)
            setOnboarding(true)
          }}
        >
          <Store />
          Register a shop
        </Button>
      </div>

      {/* ---------------------------------------------------------------- */}
      <ShopTable
        rows={visible}
        onOpen={setDetailRow}
        onStatus={(row, action) => setStatusTarget({ row, action })}
        onRegisterFor={(row) =>
          setConfirming({ id: row.ownerId, fullName: row.ownerName, phone: row.ownerPhone })
        }
      />

      <p className="text-xs text-muted-foreground">
        Showing {visible.length} of {data.rows.length}. &ldquo;COD balance&rdquo; is what Mingalar
        owes a shop for delivered orders — derived from orders, not a shop-side ledger.
      </p>

      {/* ---------------------------------------------------------------- */}
      <ShopDetailModal
        row={detailRow}
        areas={areas}
        onClose={() => setDetailRow(null)}
        onStatus={(row, action) => {
          setDetailRow(null)
          setStatusTarget({ row, action })
        }}
        onSaved={settle}
      />

      <ShopStatusDialog
        row={statusTarget?.row ?? null}
        action={statusTarget?.action ?? 'suspend'}
        onClose={() => setStatusTarget(null)}
        onDone={settle}
      />

      <ShopConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        owner={confirming}
        areas={areas}
        onDone={settle}
      />

      <ShopOnboardForm
        open={onboarding}
        onClose={() => {
          setOnboarding(false)
          setPresetOwnerId(null)
        }}
        areas={areas}
        owners={owners}
        presetOwnerId={presetOwnerId}
        onDone={settle}
      />
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
