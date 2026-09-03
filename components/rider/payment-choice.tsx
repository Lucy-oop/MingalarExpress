'use client'

import * as React from 'react'
import { Banknote, ImageOff, Smartphone } from 'lucide-react'
import { formatMmk, formatMyanmarPhone } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Translate } from '@/lib/i18n'

/**
 * Cash or KBZPay, then the QR if it is KBZPay.
 *
 * TWO BUTTONS, EACH HALF THE SCREEN. Not a dropdown, not a radio list — this is
 * answered at a doorstep, one-handed, and it decides where the money goes. A
 * mis-tap here books cash against a rider who took none.
 *
 * THE QR IS A STATIC ASSET, not a signed Storage URL. A rider standing in a
 * stairwell with no signal still has to be able to show it, and the service
 * worker caches `/kpay-qr.png`. A signed URL would fail exactly when it matters.
 *
 * The amount is repeated beside the QR because the customer types it into their
 * own app: the single most common KPay dispute is a transfer for the wrong
 * figure, and the receipt screenshot is checked against THIS number.
 */
export function PaymentChoice({
  value,
  onChange,
  amount,
  account,
  disabled,
  t,
}: {
  value: 'cash' | 'kpay' | null
  onChange: (via: 'cash' | 'kpay') => void
  amount: number
  account: { name: string | null; phone: string | null; qrUrl: string }
  disabled?: boolean
  t: Translate
}) {
  const [qrBroken, setQrBroken] = React.useState(false)

  return (
    <div className="space-y-3">
      <p className="text-base font-semibold">{t('pay.how')}</p>

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { via: 'cash' as const, label: t('pay.cash'), Icon: Banknote },
            { via: 'kpay' as const, label: t('pay.kpay'), Icon: Smartphone },
          ]
        ).map(({ via, label, Icon }) => (
          <button
            key={via}
            type="button"
            disabled={disabled}
            aria-pressed={value === via}
            onClick={() => onChange(via)}
            className={cn(
              // 88px. Two targets, each unmissable with a thumb.
              'flex min-h-22 flex-col items-center justify-center gap-1 rounded-xl border-2 text-lg font-bold',
              value === via
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-border bg-card active:bg-muted',
              disabled && 'opacity-50',
            )}
          >
            <Icon className="size-7" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {value === 'kpay' ? (
        <div className="space-y-2 rounded-xl border-2 border-[#0d4ea6] bg-[#0d4ea6] p-3 text-white">
          <p className="text-center text-sm font-semibold">{t('pay.showQr')}</p>

          {/* A plain <img>, not next/image: the optimiser is a network round
              trip, and this has to render for a rider with no signal.

              AND IT DEGRADES. The QR is a file somebody has to put in
              `public/kpay-qr.png`; until they do, hiding a broken-image icon
              and keeping the NAME, PHONE and AMOUNT visible means the transfer
              can still be made by hand. Losing the account details because a
              picture is missing would be the worse failure. */}
          {qrBroken ? (
            <p className="flex items-center justify-center gap-2 rounded-lg bg-white/10 p-3 text-sm">
              <ImageOff className="size-4 shrink-0" aria-hidden="true" />
              {t('pay.accountPhone')}: {account.phone ? formatMyanmarPhone(account.phone) : '—'}
            </p>
          ) : (
            <div className="mx-auto w-fit rounded-lg bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={account.qrUrl}
                alt={t('pay.kpay')}
                width={220}
                height={220}
                onError={() => setQrBroken(true)}
                className="size-[220px] object-contain"
              />
            </div>
          )}

          <dl className="space-y-0.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-white/70">{t('pay.accountName')}</dt>
              <dd className="font-semibold">{account.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/70">{t('pay.accountPhone')}</dt>
              <dd className="font-semibold tabular-nums">
                {account.phone ? formatMyanmarPhone(account.phone) : '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-white/25 pt-1">
              <dt className="font-medium">{t('pay.amountToSend')}</dt>
              <dd className="text-2xl font-bold tabular-nums">{formatMmk(amount)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  )
}
