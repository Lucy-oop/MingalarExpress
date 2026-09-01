import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertRole } from '@/lib/auth/guards'
import { getShopDetail } from '@/lib/admin/shop-queries'

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Detail payload for the shop drawer.
 *
 * A route handler rather than a Server Action for the same reason as
 * /api/dispatch/candidates: it is a read, it is fired on every row click, and
 * it should be cancellable with AbortController instead of queueing behind
 * whatever mutation the operator just fired.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertRole('super_admin')
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  try {
    const detail = await getShopDetail(parsed.data.id)
    if (!detail) return NextResponse.json({ error: 'shop_not_found' }, { status: 404 })
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'shop_lookup_failed' },
      { status: 500 },
    )
  }
}
