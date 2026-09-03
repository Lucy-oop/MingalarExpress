import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'
import { ShopSettingsForm } from '@/components/orders/shop-settings-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { formatMyanmarPhone } from '@/lib/utils'

export const metadata: Metadata = { title: 'Shop settings' }
export const dynamic = 'force-dynamic'

export default async function ShopSettingsPage() {
  const { profile } = await requireShop()
  const locale = await getLocale()
  const t = translator(locale)
  const supabase = await createClient()

  const { data: shop } = await supabase
    .from('shops')
    .select(
      'id, name, phone, pickup_address, pickup_lat, pickup_lng, pickup_note, is_active, service_areas:area_id (name)',
    )
    .limit(1)
    .maybeSingle()

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('ss.title')}</h1>

      {/* A suspended shop cannot create orders, and until now the only way it
          learned that was by trying. */}
      {shop && !shop.is_active ? (
        <Alert tone="error" title={t('ss.suspended')}>
          New orders are blocked. Contact the Mingalar Express office to reactivate it.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ss.account')}</CardTitle>
          <CardDescription>
            Your login and role. Contact the office to change these.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label={t('ss.owner')} value={profile.full_name} />
          <Row label={t('ss.phone')} value={formatMyanmarPhone(profile.phone)} />
          <Row label={t('ss.language')} value={profile.preferred_lang === 'my' ? 'Burmese' : 'English'} />
          <Row
            label={t('ss.ward')}
            value={(shop?.service_areas as { name: string } | null)?.name ?? '—'}
          />
        </CardContent>
      </Card>

      {shop ? (
        <ShopSettingsForm shop={shop} />
      ) : (
        <Alert tone="error" title={t('ss.noShop')}>
          Ask the Mingalar Express office to register your shop and pickup point.
        </Alert>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
