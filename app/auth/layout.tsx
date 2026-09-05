import { BrandMark } from '@/components/shared/brand-mark'
import { ContactSupport } from '@/components/shared/contact-support'
import { getPublicSettings } from '@/lib/settings/public'

/**
 * One footer covers login, register and forgot-password — and therefore the
 * "This account has been disabled. Contact your dispatcher." and "not set up
 * yet" notices too, which are the messages most likely to leave somebody
 * stranded with nobody to ring.
 *
 * The number comes through `public_settings()` because anon cannot read
 * app_settings, and someone who cannot sign in is exactly the person who needs
 * to call. See migration 0024.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { supportPhone } = await getPublicSettings()

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10">
      <BrandMark />
      <div className="w-full max-w-sm">{children}</div>
      <div className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
        <ContactSupport phone={supportPhone} label="Trouble signing in?" />
        <p>Serving Greater Yangon</p>
      </div>
    </main>
  )
}
