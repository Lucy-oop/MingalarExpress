import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/dictionary'
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
import {
  SHOP_BLOCKED_MESSAGE,
  shopApprovalState,
  type ShopApprovalState,
} from '@/lib/shops/approval'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Shop settings' }
export const dynamic = 'force-dynamic'

const BLOCKED_TITLE: Record<Exclude<ShopApprovalState, 'active'>, MessageKey> = {
  awaiting: 'ss.awaiting',
  rejected: 'ss.rejected',
  suspended: 'ss.suspended',
}

export default async function ShopSettingsPage() {
  const { profile } = await requireShop()
  const locale = await getLocale()
  const t = translator(locale)
  const supabase = await createClient()

  const { data: shop } = await supabase
    .from('shops')
    .select(
      'id, name, phone, pickup_address, pickup_lat, pickup_lng, pickup_note, is_active, approved_at, rejected_at, goods_type, service_areas:area_id (name)',
    )
    .limit(1)
    .maybeSingle()

  const [acceptance, policyAcceptedAt, { supportPhone }] = await Promise.all([
    readPolicyAcceptance(COD_ADVANCE_POLICY.key),
    getPolicyAcceptedAt(COD_ADVANCE_POLICY.key),
    getPublicSettings(),
  ])
  const policyOutstanding = shouldBlock(acceptance, COD_ADVANCE_POLICY.version)
  const state = shop
    ? shopApprovalState({
        isActive: shop.is_active,
        approvedAt: shop.approved_at,
        rejectedAt: shop.rejected_at,
      })
    : null
  const blocked = state && state !== 'active' ? SHOP_BLOCKED_MESSAGE[state] : null

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('ss.title')}</h1>

      {/* A suspended shop cannot create orders, and until now the only way it
          learned that was by trying. */}
      {/*
        One of three reasons, and the TITLE has to move with it too: telling a
        shop that has never been looked at that it is "suspended" is the exact
        confusion lib/shops/approval exists to prevent.
      */}
      {blocked && state && state !== 'active' ? (
        <Alert tone="warning" title={t(BLOCKED_TITLE[state])}>
          <span className="block">{blocked}</span>
          <ContactSupport phone={supportPhone} moreLabel={t('contact.more')} className="mt-2 text-sm" />
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
        <Alert tone="warning" title={t('ss.noShop')}>
          <span className="block">
            Tell us your shop name, what you sell and where riders collect from.
          </span>
          <Link href="/shop/setup" className={cn(buttonVariants({ size: 'sm' }), 'mt-3')}>
            Set up my shop
          </Link>
          {/* The button is the answer for most owners; the number is for the
              one whose address the map cannot find. */}
          <ContactSupport phone={supportPhone} moreLabel={t('contact.more')} className="mt-3 text-sm" />
        </Alert>
      )}

      {/* The permanent home for the number, so it is somewhere findable and not
          only on the screens that happen to be broken. No longer gated on there
          being a number: the card also carries the link to /contact, which
          exists whether or not the office ever filled that field in. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="size-4 shrink-0 text-brand-gold" aria-hidden="true" />
            {t('ss.help')}
          </CardTitle>
          <CardDescription>{t('ss.helpHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ContactSupport
            phone={supportPhone}
            moreLabel={t('contact.more')}
            className="text-base"
          />
        </CardContent>
      </Card>

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
