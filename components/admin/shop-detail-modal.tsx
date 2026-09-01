'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Ban, CheckCircle2, ClipboardList, History, Pencil, Save } from 'lucide-react'
import { updateShop, type ShopActionResult } from '@/lib/admin/shop-actions'
import type { ShopDetail, ShopListRow } from '@/lib/admin/shop-queries'
import { SUSPEND_REASON_LABEL, type SuspendReason } from '@/lib/validation/admin-shop'
import type { LatLng, ServiceArea } from '@/types/domain'
import { LocationPicker } from '@/components/map/location-picker'
import { StatusBadge } from '@/components/orders/status-badge'
import { Stat } from '@/components/admin/kpi'
import { Overlay } from '@/components/ui/overlay'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'

const ACTION_LABEL: Record<string, string> = {
  'shop.suspend': 'Suspended',
  'shop.activate': 'Activated',
  'shop.onboard': 'Registered',
}

export function ShopDetailModal({
  row,
  areas,
  onClose,
  onStatus,
  onSaved,
}: {
  row: ShopListRow | null
  areas: ServiceArea[]
  onClose: () => void
  onStatus: (row: ShopListRow, action: 'activate' | 'suspend') => void
  onSaved: (result: ShopActionResult) => void
}) {
  const [detail, setDetail] = useState<ShopDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const shopId = row?.shopId ?? null

  // Fetched on open rather than shipped with the table: the drawer needs order
  // history and an audit trail for ONE shop, and loading that for every row of
  // a list nobody has clicked is wasted work on a mobile connection.
  useEffect(() => {
    if (!shopId) {
      setDetail(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setLoadError(null)
    setEditing(false)

    fetch(`/api/admin/shops/${shopId}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 403 ? 'forbidden' : 'load_failed')
        return (await res.json()) as ShopDetail
      })
      .then(setDetail)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(
          error instanceof Error && error.message === 'forbidden'
            ? 'You do not have permission to view this shop.'
            : 'Could not load this shop. Check your connection and try again.',
        )
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [shopId])

  if (!row || !shopId) return null

  const suspended = row.status === 'suspended'

  return (
    <Overlay
      open
      onClose={onClose}
      title={row.name ?? 'Shop'}
      description={`${row.area ?? 'No ward'} · joined ${formatDateTimeYangon(row.joinedAt)}`}
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" onClick={() => setEditing((e) => !e)}>
            <Pencil />
            {editing ? 'Stop editing' : 'Edit details'}
          </Button>
          <Button
            variant={suspended ? 'default' : 'destructive'}
            onClick={() => onStatus(row, suspended ? 'activate' : 'suspend')}
          >
            {suspended ? <CheckCircle2 /> : <Ban />}
            {suspended ? 'Activate shop' : 'Suspend shop'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ---------------------------------------------------------------- */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={suspended ? 'red' : 'green'}>{suspended ? 'Suspended' : 'Active'}</Badge>
            {!row.ownerActive ? <Badge tone="red">Owner login blocked</Badge> : null}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total orders" value={String(row.totalOrders)} emphasis />
            <Stat label="Delivered" value={String(row.deliveredOrders)} />
            <Stat label="In flight" value={String(row.inFlightOrders)} />
            <Stat label="Cancelled / failed" value={String(row.cancelledOrders)} />
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/40 p-3 sm:grid-cols-3">
            <Stat
              label="Owed to shop"
              value={formatMmk(row.owedToShop)}
              emphasis
              hint="delivered, derived"
            />
            <Stat
              label="COD in flight"
              value={formatMmk(row.codInFlight)}
              hint="on a rider now"
            />
            <Stat label="Delivery fees" value={formatMmk(row.platformFees)} />
          </div>

          <p className="text-xs text-muted-foreground">
            Shop figures are <strong>derived from orders</strong>, not from a ledger — there is no
            shop-side double entry in this schema, so nothing here is marked &ldquo;cleared&rdquo;.
            The rider ledger in the{' '}
            <Link href="/admin/audit" className="underline underline-offset-2">
              COD audit explorer
            </Link>{' '}
            is the book of record.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Contact</h3>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <Row label="Owner" value={row.ownerName} />
            <Row label="Owner phone" value={formatMyanmarPhone(row.ownerPhone)} />
            <Row label="Shop phone" value={formatMyanmarPhone(row.phone)} />
            <Row label="Ward" value={row.area ?? '—'} />
            <Row label="Pickup address" value={row.pickupAddress ?? '—'} wide />
            {detail?.shop.pickupNote ? (
              <Row label="Pickup note" value={detail.shop.pickupNote} wide />
            ) : null}
          </dl>
        </section>

        {loadError ? <Alert tone="error">{loadError}</Alert> : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading history…</p> : null}

        {/* ---------------------------------------------------------------- */}
        {editing && detail ? (
          <EditForm
            detail={detail}
            areas={areas}
            onSaved={(result) => {
              onSaved(result)
              if (result.ok) setEditing(false)
            }}
          />
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {detail ? (
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="size-4" />
              Recent orders
            </h3>
            {detail.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">This shop has never sent an order.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {detail.orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 p-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs">{o.code}</span>
                        <StatusBadge status={o.status} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.customer_name} · {formatDateTimeYangon(o.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium tabular-nums">
                        {o.payment_method === 'cod' ? formatMmk(o.cod_amount) : 'Prepaid'}
                      </p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        fee {formatMmk(o.delivery_fee)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {detail ? (
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <History className="size-4" />
              Office notes
            </h3>
            <p className="text-xs text-muted-foreground">
              Every suspension, reactivation and registration, with the reason given and who gave
              it. Read from <code>audit_log</code> — there is no free-text notes field to edit or
              lose.
            </p>
            {detail.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {detail.notes.map((n) => (
                  <li key={n.id} className="p-2.5">
                    <p className="text-sm font-medium">
                      {ACTION_LABEL[n.action] ?? n.action}
                      {n.reason ? (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          — {SUSPEND_REASON_LABEL[n.reason as SuspendReason] ?? n.reason}
                        </span>
                      ) : null}
                    </p>
                    {n.detail ? <p className="text-sm">{n.detail}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {n.actor_name ?? 'System'} · {formatDateTimeYangon(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------------------

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button size="sm" type="submit" disabled={pending}>
      <Save />
      {pending ? 'Saving…' : 'Save details'}
    </Button>
  )
}

function EditForm({
  detail,
  areas,
  onSaved,
}: {
  detail: ShopDetail
  areas: ServiceArea[]
  onSaved: (result: ShopActionResult) => void
}) {
  const [state, action] = useActionState<ShopActionResult, FormData>(updateShop, {
    ok: false,
    message: '',
  })
  const err = (k: string) => (state.ok ? undefined : state.fieldErrors?.[k]?.[0])

  const [point, setPoint] = useState<LatLng>({
    lat: detail.shop.pickupLat,
    lng: detail.shop.pickupLng,
  })
  const [address, setAddress] = useState(detail.shop.pickupAddress)

  const seen = useRef<ShopActionResult | null>(null)
  useEffect(() => {
    if (state === seen.current || !state.message) return
    seen.current = state
    onSaved(state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <form action={action} className="space-y-3 rounded-md border bg-muted/30 p-3" noValidate>
      <input type="hidden" name="shopId" value={detail.shop.id} />
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Edit shop details
      </p>

      {!state.ok && state.message ? <Alert tone="error">{state.message}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Shop name" htmlFor="edit-name" required error={err('name')}>
          <Input id="edit-name" name="name" defaultValue={detail.shop.name} required />
        </Field>

        <Field label="Shop phone" htmlFor="edit-phone" required error={err('phone')}>
          <Input
            id="edit-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={detail.shop.phone}
            required
          />
        </Field>

        <Field label="Ward" htmlFor="edit-area" error={err('areaId')}>
          <Select id="edit-area" name="areaId" defaultValue={detail.shop.areaId ?? ''}>
            <option value="">No ward</option>
            {areas
              .filter((a) => a.is_active || a.id === detail.shop.areaId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.is_active ? '' : ' (inactive)'}
                </option>
              ))}
          </Select>
        </Field>

        <Field label="Pickup note" htmlFor="edit-note" error={err('pickupNote')}>
          <Textarea
            id="edit-note"
            name="pickupNote"
            defaultValue={detail.shop.pickupNote ?? ''}
            placeholder="Blue shutter, ask for Ma Thida"
          />
        </Field>
      </div>

      <LocationPicker
        kind="pickup"
        label="Pickup point"
        point={point}
        address={address}
        onPointChange={setPoint}
        onAddressChange={setAddress}
        fieldPrefix="pickup"
        addressError={err('pickupAddress')}
        pointError={err('pickupPoint')}
      />

      <SaveButton />
    </form>
  )
}

function Row({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words">{value}</dd>
    </div>
  )
}
