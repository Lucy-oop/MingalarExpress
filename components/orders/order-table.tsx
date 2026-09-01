import Link from 'next/link'
import { PackageOpen } from 'lucide-react'
import { StatusBadge } from '@/components/orders/status-badge'
import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'
import type { Order } from '@/types/domain'

type Row = Pick<
  Order,
  | 'id'
  | 'code'
  | 'status'
  | 'customer_name'
  | 'customer_phone'
  | 'dropoff_address'
  | 'cod_amount'
  | 'delivery_fee'
  | 'payment_method'
  | 'created_at'
>

export function OrderTable({ orders }: { orders: Row[] }) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <PackageOpen className="size-8 text-muted-foreground" />
        <p className="font-medium">No orders yet</p>
        <p className="text-sm text-muted-foreground">
          Create your first delivery and it will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Destination</th>
            <th className="px-3 py-2 text-right font-medium">COD</th>
            <th className="px-3 py-2 text-right font-medium">Fee</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-muted/40">
              <td className="px-3 py-2">
                <Link
                  href={`/shop/orders/${o.id}`}
                  className="font-mono text-xs font-medium text-primary hover:underline"
                >
                  {o.code}
                </Link>
              </td>
              <td className="px-3 py-2">
                <div className="font-medium">{o.customer_name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatMyanmarPhone(o.customer_phone)}
                </div>
              </td>
              <td className="max-w-[240px] truncate px-3 py-2 text-muted-foreground">
                {o.dropoff_address}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {o.payment_method === 'cod' ? formatMmk(o.cod_amount) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMmk(o.delivery_fee)}</td>
              <td className="px-3 py-2">
                <StatusBadge status={o.status} />
              </td>
              <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                {formatDateTimeYangon(o.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
