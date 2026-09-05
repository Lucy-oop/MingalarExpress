import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'
import { ShopSettingsForm } from '@/components/orders/shop-settings-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { formatDateTimeYangon, formatMyanmarPhone } from '@/lib/utils'
import Link from 'next/link'
import { CheckCircle2, FileText, LifeBuoy } from 'lucide-react'
import { getPolicyAcceptedAt, readPolicyAcceptance } from '@/lib/legal/queries'
import { COD_ADVANCE_POLICY } from '@/lib/legal/cod-advance'
import { ContactSupport } from '@/components/shared/contact-support'
import { getPublicSettings } from '@/lib/settings/public'
import { shouldBlock } from '@/lib/legal/gate'

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

  const [acceptance, policyAcceptedAt, { supportPhone }] = await Promise.all([
    readPolicyAcceptance(COD_ADVANCE_POLICY.key),
    getPolicyAcceptedAt(COD_ADVANCE_POLICY.key),
    getPublicSettings(),
  ])
  const policyOutstanding = shouldBlock(acceptance, COD_ADVANCE_POLICY.version)

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('ss.title')}</h1>

      {/* A suspended shop cannot create orders, and until now the only way it
          learned that was by trying. */}
      {shop && !shop.is_active ? (
        <Alert tone="error" title={t('ss.suspended')}>
          <span className="block">
            New orders are blocked. Contact the Mingalar Express office to reactivate it.
          </span>
          <ContactSupport phone={supportPhone} className="mt-2 text-sm" />
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
          <span className="block">
            Ask the Mingalar Express office to register your shop and pickup point.
          </span>
          <ContactSupport phone={supportPhone} className="mt-2 text-sm" />
        </Alert>
      )}

      {/* The permanent home for the number, so it is somewhere findable and not
          only on the screens that happen to be broken. */}
      {supportPhone ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LifeBuoy className="size-4 shrink-0 text-brand-gold" aria-hidden="true" />
              {t('ss.help')}
            </CardTitle>
            <CardDescription>{t('ss.helpHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ContactSupport phone={supportPhone} className="text-base" />
          </CardContent>
        </Card>
      ) : null}

      {/* The permanent home for the terms. The interstitial in the shell is
          dismissible, so this is where a shop comes back to read what they
          agreed to -- or to accept, if they pressed "Read later". */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('policy.settingsCard')}</CardTitle>
          <CardDescription>{t('policy.settingsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {policyOutstanding || !policyAcceptedAt ? (
            <span className="font-medium text-amber-700">{t('policy.notAccepted')}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-800">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              {t('policy.acceptedOn').replace('{date}', formatDateTimeYangon(policyAcceptedAt))}
            </span>
          )}
          <Link
            href="/shop/policy/cod-advance"
            className="flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <FileText className="size-4" />
            {t('policy.readFull')}
          </Link>
        </CardContent>
      </Card>
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
