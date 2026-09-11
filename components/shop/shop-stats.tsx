import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * The shop's headline figures, sized for the phone they are read on.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE EXIST RATHER THAN `components/admin/kpi`
 *
 * That file opens by saying what it is for: "Presentational tiles shared by the
 * Super Admin pages." The shop dashboard imported it anyway, so a shop owner's
 * first screen rendered at the office's density — `text-[10px]` uppercase
 * labels over a `text-2xl` value — on a 360px phone.
 *
 * The arithmetic is what settles it. `main` is `px-4`, so 328px; the old row
 * was `grid-cols-2 gap-3`, so 158px a tile; `Kpi`'s `p-4` left 126px of content
 * box. A 10px uppercase label wrapped to two or three lines in that, and the
 * value carried no `truncate` and no `min-w-0` — `formatMmk` emits
 * "1,250,000 Ks", one unbreakable ~145px token at 24px, and `grid-cols-2` is
 * `minmax(0,1fr)` so the track cannot grow. The digits spilled past the tile's
 * own border. Five tiles in two columns also left an orphan on row three.
 *
 * The office keeps its tiles. Nobody reconciles a settlement on a phone, and
 * dense is correct at a desk — the mistake was sharing them, not writing them.
 *
 * ---------------------------------------------------------------------------
 * MONEY FIRST, COUNTS BELOW
 *
 * "COD in transit" is the only real money on the page, the only tile with no
 * link, and the only one that can overflow. It gets the full width. The four
 * counts follow in a 2x2, which is also what removes the orphan row.
 *
 * Sentence case, not uppercase: `tracking-wide` uppercase costs about 15% more
 * width for the same words, which is the last thing a 126px box needs — and
 * Burmese has no case, so the transform is pure decoration on the default
 * language.
 */

export type ShopStatTone = 'default' | 'warn' | 'bad'

const TONES: Record<ShopStatTone, string> = {
  default: 'border-border bg-card',
  warn: 'border-amber-300 bg-amber-50',
  bad: 'border-destructive/30 bg-destructive/5',
}

/**
 * The one figure that is money. Full width, so it cannot be the thing that
 * overflows — and `min-w-0` + `truncate` so it still cannot if the shop grows
 * a digit.
 */
export function ShopMoneyCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: ShopStatTone
}) {
  return (
    <div className={cn('rounded-lg border p-4', TONES[tone])}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {/*
        `min-w-0` on the flex child and `truncate` on the text. A comma-grouped
        MMK figure is a single unbreakable token, so without both of these a
        seven-figure sum renders straight through the card's right edge.
      */}
      <p className="mt-1 min-w-0 truncate text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * One of the four counts. A count is at most four digits, so it cannot overflow
 * the way the money figure can — the constraint here is the LABEL.
 *
 * `min-h-11` because three of the four are links, and 44px is the floor the
 * rider suite enforces as a test (`job-panel.test.ts` bans `min-h-10`). The
 * padding alone would usually clear it; the floor makes that true regardless of
 * how short a translated label turns out to be.
 */
export function ShopCountTile({
  label,
  value,
  hint,
  tone = 'default',
  href,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: ShopStatTone
  href?: string
}) {
  const body = (
    <>
      {/*
        13px, not 10px. Small enough that two Burmese words fit on one line in a
        half-width tile, large enough to be read at arm's length in a shop.
      */}
      <p className="text-[13px] font-medium leading-snug text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </>
  )

  const className = cn(
    'flex min-h-11 flex-col justify-center rounded-lg border p-3 transition-colors',
    TONES[tone],
    href && 'hover:border-primary/40 active:bg-muted/50',
  )

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
