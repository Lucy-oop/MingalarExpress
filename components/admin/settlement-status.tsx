import { Badge } from '@/components/ui/badge'
import type { SettlementStatus } from '@/types/domain'

/**
 * open -> submitted -> approved -> paid, with `approved -> submitted` as the one
 * reverse gear. `paid` is terminal: corrections are booked as adjustments.
 */
const TONE: Record<SettlementStatus, 'neutral' | 'amber' | 'blue' | 'green'> = {
  open: 'neutral',
  submitted: 'amber',
  approved: 'blue',
  paid: 'green',
}

const LABEL: Record<SettlementStatus, string> = {
  open: 'Open',
  submitted: 'Drafted',
  approved: 'Approved',
  paid: 'Paid',
}

export function SettlementStatusBadge({ status }: { status: SettlementStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>
}

export const SETTLEMENT_LABEL = LABEL
