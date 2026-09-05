import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { getOrderLabels, getOrderLabelsByFilter, type OrderLabelRow } from '@/lib/orders/queries'
import { MAX_LABELS, parseLabelIds } from '@/lib/orders/label'
import { ParcelLabel } from '@/components/orders/parcel-label'
import { PrintControls } from '@/components/orders/print-on-load'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { Alert } from '@/components/ui/alert'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'

export const metadata: Metadata = { title: 'Labels' }

/** Labels reflect live order data, and are printed the moment they load. */
export const dynamic = 'force-dynamic'

/**
 * Printable waybills — one parcel or a whole filtered batch.
 *
 * ONE ROUTE FOR BOTH so there is a single label implementation and a single
 * @page rule. `?ids=` comes from the success modal and the detail page; the
 * filter params are the orders list's own query string, so the batch button's
 * href is the CSV export's href with a different path.
 *
 * A static `labels` segment beside the dynamic `[id]` resolves in favour of the
 * static one. `app/shop/orders/export/route.ts` has relied on that since Phase 2.
 *
 * Auth is the shop layout's `requireShop()`, then RLS. Nothing here filters by
 * shop_id: an id belonging to another shop returns no row, which is why a
 * hand-edited `?ids=` produces a short stack rather than a leak.
 */

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]
const isStatus = (v: string | undefined): v is OrderStatus =>
  !!v && (STATUSES as string[]).includes(v)
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v

export default async function ShopLabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireShop()
  const sp = await searchParams
  const locale = await getLocale()
  const t = translator(locale)

  /*
    WHICH MODE, decided by whether `ids` was SENT -- not by whether it survived
    parsing. `?ids=not-a-uuid` parses to an empty list, and treating that as
    "no ids, so use the filters" meant a corrupted link printed the shop's
    entire order history instead of the one parcel it asked for. An `ids` param
    that yields nothing is an empty result, not an invitation to print
    everything.
  */
  const byId = sp.ids !== undefined
  const ids = parseLabelIds(sp.ids)

  let rows: OrderLabelRow[] = []
  let capped = false
  if (byId) {
    rows = await getOrderLabels(ids)
  } else {
    const result = await getOrderLabelsByFilter({
      status: isStatus(one(sp.status)) ? (one(sp.status) as OrderStatus) : null,
      q: one(sp.q)?.trim() || null,
      from: isDate(one(sp.from)) ? (one(sp.from) as string) : null,
      to: isDate(one(sp.to)) ? (one(sp.to) as string) : null,
      needsDecision: one(sp.needs) === '1',
    })
    rows = result.rows
    capped = result.capped
  }

  const autoPrint = one(sp.print) === '1'

  return (
    <>
      {/*
        The page box is a physical 100x150mm, and @page cannot be scoped by a
        selector -- putting it in globals.css would resize the print output of
        every page in the app. So the rule is emitted here, by the only route
        that wants it, and exists in no other document.
      */}
      <style>{`
        @page { size: 100mm 150mm; margin: 0 }
        @media print {
          .mge-label { break-after: page; page-break-after: always }
          .mge-label:last-of-type { break-after: auto; page-break-after: auto }
        }
      `}</style>

      <div className="space-y-4 print:space-y-0">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-lg font-semibold">{t('label.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {rows.length > 0
                ? t('label.count').replace('{n}', String(rows.length))
                : t('label.none')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/shop/orders"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ArrowLeft className="size-3.5" />
              {t('label.back')}
            </Link>
            {rows.length > 0 ? <PrintControls auto={autoPrint} /> : null}
          </div>
        </div>

        {/* Never a silently short stack: a shop would find out by counting
            parcels against paper. */}
        {capped ? (
          <div className="print:hidden">
            <Alert tone="warning" title={t('label.tooMany').replace('{n}', String(MAX_LABELS))}>
              {t('label.count').replace('{n}', String(MAX_LABELS))}
            </Alert>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="print:hidden">
            <Alert tone="info" title={t('label.none')}>
              {t('label.noneHint')}
            </Alert>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-4 print:block print:gap-0">
          {rows.map((order) => (
            // On screen each label sits in a bordered card at its true printed
            // size, so the shop sees exactly what will come off the roll.
            <div
              key={order.id}
              className="border border-dashed border-muted-foreground/40 shadow-sm print:border-0 print:shadow-none"
            >
              <ParcelLabel order={order} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
