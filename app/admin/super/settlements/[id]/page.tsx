import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSettlement } from '@/lib/admin/queries'
import { SettlementDetail } from '@/components/admin/settlement-detail'

export const metadata: Metadata = { title: 'Settlement · Super Admin' }
export const dynamic = 'force-dynamic'

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await getSettlement(id)
  if (!data) notFound()

  return <SettlementDetail data={data} />
}
