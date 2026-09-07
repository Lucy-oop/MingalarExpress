import Link from 'next/link'
import { LifeBuoy } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'

/**
 * One footer covers login and register — and therefore the "This account has
 * been disabled. Contact your dispatcher." and "not set up yet" notices too,
 * which are the messages most likely to leave somebody stranded with nobody to
 * ring. (There is no forgot-password page; this comment used to claim one.)
 *
 * A LINK RATHER THAN THE NUMBER ITSELF. The number was here first and worked,
 * but a `tel:` href is the wrong shape for how this business is reached: Viber
 * is the default messaging app in Yangon and Facebook is where customers
 * already write. /contact holds all of it, needs no auth, and does not depend
 * on `public_settings()` having been pushed — which the raw number here did.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10">
      <BrandMark />
      <div className="w-full max-w-sm">{children}</div>
      <div className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
        <Link
          href="/contact"
          className="inline-flex items-center gap-1.5 rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LifeBuoy className="size-3.5 shrink-0" aria-hidden="true" />
          Trouble signing in? Contact us
        </Link>
        <p>Serving Greater Yangon</p>
      </div>
    </main>
  )
}
