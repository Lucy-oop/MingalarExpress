'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]

/**
 * Filters for the shop's order list.
 *
 * State lives in the URL, not in React, following `components/admin/cod-explorer`.
 * That is what makes a filtered view shareable and survive a reload — a shop
 * chasing a parcel with the office needs to be able to send the link.
 *
 * Every change resets to page 1. Staying on page 4 while narrowing a search to
 * six results shows an empty table and looks like the search is broken.
 */
export function OrderFilters({
  total,
  exportHref,
  basePath = '/shop/orders',
  extra,
}: {
  total: number
  exportHref: string
  /** Which list this bar drives. The office's is the same bar, different route. */
  basePath?: string
  /** Slot for filters only one of the two lists has, e.g. the office's shop picker. */
  extra?: React.ReactNode
}) {
  const router = useRouter()
  const params = useSearchParams()

  const status = params.get('status') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const [term, setTerm] = React.useState(params.get('q') ?? '')

  // Keep the box in step when the URL changes underneath us (back button, or a
  // Clear press elsewhere).
  React.useEffect(() => {
    setTerm(params.get('q') ?? '')
  }, [params])

  const setParam = React.useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      next.delete('page')
      router.push(`${basePath}?${next.toString()}`)
    },
    [params, router, basePath],
  )

  const hasFilters = Boolean(status || from || to || params.get('q'))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="relative min-w-56 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            setParam({ q: term })
          }}
        >
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Code, customer, phone or address…"
            aria-label="Search orders"
            className="pl-8"
          />
        </form>

        {extra}

        <Select
          value={status}
          onChange={(e) => setParam({ status: e.target.value })}
          aria-label="Status"
          className="w-40"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>

        <div className="flex items-end gap-1">
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setParam({ from: e.target.value })}
            aria-label="From date"
            className="w-40"
          />
          <span className="pb-2.5 text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setParam({ to: e.target.value })}
            aria-label="To date"
            className="w-40"
          />
        </div>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => router.push(basePath)}>
            <X />
            Clear
          </Button>
        ) : null}

        {/* A link, not a fetch: the browser handles the download and the file
            name comes from Content-Disposition. */}
        <a href={exportHref} className="ml-auto">
          <Button variant="outline" size="sm" type="button">
            <Download />
            Export CSV
          </Button>
        </a>
      </div>

      <p className="text-xs text-muted-foreground">
        {total === 0
          ? 'No orders match these filters.'
          : `${total.toLocaleString()} order${total === 1 ? '' : 's'}${hasFilters ? ' match these filters' : ''}`}
      </p>
    </div>
  )
}
