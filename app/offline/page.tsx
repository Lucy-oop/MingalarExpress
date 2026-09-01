import { WifiOff } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'

/** Cached by the service worker and served when a navigation fails. */
export const metadata = { title: 'No connection' }

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <BrandMark />
      <WifiOff className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">No connection</h1>
      <p className="text-sm text-muted-foreground">
        Anything you tapped while offline is saved on your phone and will send by itself once you
        have signal.
      </p>
      <p className="text-xs text-muted-foreground">Keep the app open when you get back in range.</p>
    </main>
  )
}
