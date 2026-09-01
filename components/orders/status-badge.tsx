import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/types/domain'

/** Single source of truth for status colour. Do not inline these anywhere else. */
const TONE: Record<OrderStatus, 'neutral' | 'gold' | 'blue' | 'green' | 'amber' | 'red'> = {
  pending: 'neutral',
  assigned: 'gold',
  picked_up: 'blue',
  delivered: 'green',
  failed: 'amber',
  cancelled: 'red',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>
}
