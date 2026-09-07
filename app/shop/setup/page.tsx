import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireShop } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { ShopSetupForm } from '@/components/shops/shop-setup-form'
import { PageHeader } from '@/components/admin/kpi'

export const metadata: Metadata = { title: 'Set up your shop' }
export const dynamic = 'force-dynamic'

/**
 * The step between signing up and trading.
 *
 * Replaces a dead end: an owner who registered online used to land on "Your
 * account has no shop yet. Ask the Mingalar Express office to add your pickup
 * point" and had nothing to do but wait for somebody to type their address for
 * them. They know it better than the office does.
 */
export default async function ShopSetupPage() {
  const { profile } = await requireShop()
  const supabase = await createClient()

  // RLS scopes this to their own shop, so a row here means they are done.
  const { data: shop } = await supabase.from('shops').select('id').limit(1).maybeSingle()
  if (shop) redirect('/shop/dashboard')

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        title="Tell us about your shop"
        description="Five quick things and you are trading. You can change any of it later in Shop settings."
      />
      <ShopSetupForm
        defaultName={profile.full_name}
        defaultPhone={profile.phone ?? ''}
      />
    </div>
  )
}
