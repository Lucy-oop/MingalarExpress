'use client'

import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { isoDaysAgo } from '@/lib/admin/day'

/**
 * Date range for the money page, held in the URL so a range is shareable.
 *
 * The presets exist because the useful questions are almost always the same
 * three — this week, this month, everything since the last payout — and typing
 * two dates to ask them is friction on the page a shop opens to check whether
 * they have been paid.
 */
export function MoneyRange({ from, to, today }: { from: string; to: string; today: string }) {
  const router = useRouter()
  const go = (nextFrom: string, nextTo: string) =>
    router.push(`/shop/money?from=${nextFrom}&to=${nextTo}`)

  const presets: Array<[label: string, days: number]> = [
    ['7 days', 6],
    ['30 days', 29],
    ['90 days', 89],
  ]

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex items-end gap-1">
        <Input
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && go(e.target.value, to)}
          aria-label="From date"
          className="w-40"
        />
        <span className="pb-2.5 text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={to}
          min={from}
          max={today}
          onChange={(e) => e.target.value && go(from, e.target.value)}
          aria-label="To date"
          className="w-40"
        />
      </div>

      <div className="flex gap-1">
        {presets.map(([label, days]) => (
          <Button
            key={label}
            variant="outline"
            size="sm"
            onClick={() => go(isoDaysAgo(today, days), today)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
