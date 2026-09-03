'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Select } from '@/components/ui/select'

/** Narrow the office's order list to one shop. URL-held, like every other filter. */
export function ShopPicker({
  shops,
  value,
  basePath,
}: {
  shops: Array<{ id: string; name: string }>
  value: string
  basePath: string
}) {
  const router = useRouter()
  const params = useSearchParams()

  return (
    <Select
      value={value}
      aria-label="Shop"
      className="w-48"
      onChange={(e) => {
        const next = new URLSearchParams(params.toString())
        if (e.target.value) next.set('shop', e.target.value)
        else next.delete('shop')
        next.delete('page')
        router.push(`${basePath}?${next.toString()}`)
      }}
    >
      <option value="">All shops</option>
      {shops.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  )
}
