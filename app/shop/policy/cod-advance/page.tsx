import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { requireShop } from '@/lib/auth/guards'
import { getAcceptedPolicyVersion, getPolicyAcceptedAt } from '@/lib/legal/queries'
import { COD_ADVANCE_POLICY, needsAcceptance } from '@/lib/legal/cod-advance'
import { PolicyDocumentView } from '@/components/legal/policy-document'
import { AcceptPolicyButton } from '@/components/legal/accept-policy-button'
import { Card, CardContent } from '@/components/ui/card'
import { getLocale } from '@/lib/i18n/locale'
import { translator } from '@/lib/i18n'
import { formatDateTimeYangon } from '@/lib/utils'

export const metadata: Metadata = { title: 'COD advance terms' }

/** The acceptance state is the point of the page, so never a cached copy. */
export const dynamic = 'force-dynamic'

/**
 * The permanent copy of the COD advance terms.
 *
 * The interstitial in the shop shell is shown once and dismissible; this is
 * where a shop comes back to read what they agreed to, and to accept if they
 * pressed "Read later". Both render the same document through the same
 * component, so the text cannot drift from the text that was accepted.
 */
export default async function CodAdvancePolicyPage() {
  await requireShop()
  const locale = await getLocale()
  const t = translator(locale)

  const [accepted, acceptedAt] = await Promise.all([
    getAcceptedPolicyVersion(COD_ADVANCE_POLICY.key),
    getPolicyAcceptedAt(COD_ADVANCE_POLICY.key),
  ])
  const outstanding = needsAcceptance(accepted, COD_ADVANCE_POLICY.version)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/shop/settings"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        {t('shop.nav.settings')}
      </Link>

      {!outstanding && acceptedAt ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          {t('policy.acceptedOn').replace('{date}', formatDateTimeYangon(acceptedAt))}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-4 sm:p-6">
          <PolicyDocumentView doc={COD_ADVANCE_POLICY} />
        </CardContent>
      </Card>

      {/*
        Only shown when there is something to accept. Re-accepting terms already
        on file would write nothing (the unique key makes it a no-op) and would
        suggest the record was in doubt.
      */}
      {outstanding ? (
        <AcceptPolicyButton
          policyKey={COD_ADVANCE_POLICY.key}
          version={COD_ADVANCE_POLICY.version}
        />
      ) : null}
    </div>
  )
}
