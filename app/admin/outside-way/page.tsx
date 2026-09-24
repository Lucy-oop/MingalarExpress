import type { Metadata } from 'next'
import { requireDispatch } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { getAreaRoutes } from '@/lib/orders/queries'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { I18nProvider } from '@/components/shared/i18n-provider'
import { PageHeader } from '@/components/admin/kpi'
import { OutsideWayForm } from '@/components/admin/outside-way-form'
import { Alert } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'Outside Way · Admin' }
export const dynamic = 'force-dynamic'

/**
 * Outside Way: the office books a parcel that arrived by Telegram, Viber,
 * Facebook or a phone call, on the sender's behalf.
 *
 * THE ONLY ADMIN PAGE WITH ITS OWN I18nProvider. The panel is English and its
 * layout mounts none; this screen follows the locale cookie because the office
 * types these up from Burmese messages and asked for it in Burmese.
 */
export default async function OutsideWayPage() {
  await requireDispatch()
  const [supabase, locale] = await Promise.all([createClient(), getLocale()])
  const t = translator(locale)

  let areas
  try {
    areas = await getAreaRoutes()
  } catch (error) {
    return (
      <Alert tone="error" title="Delivery areas unavailable">
        {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    )
  }

  const { data: shops } = await supabase
    .from('shops')
    .select('id, name, phone, pickup_address, is_active')
    // The house Direct shop is offered as its own option, never as a shop.
    .eq('is_direct', false)
    .order('name')

  return (
    <I18nProvider locale={locale}>
      <div className="mx-auto max-w-4xl space-y-4" lang={locale}>
        <PageHeader title={t('ow.title')} description={t('ow.description')} />
        {areas.length === 0 ? (
          <Alert tone="warning">{t('ow.noAreas')}</Alert>
        ) : (
          <OutsideWayForm
            shops={(shops ?? []).map((s) => ({
              id: s.id,
              name: s.name,
              phone: s.phone,
              pickupAddress: s.pickup_address,
              isActive: s.is_active,
            }))}
            areas={areas}
          />
        )}
      </div>
    </I18nProvider>
  )
}
