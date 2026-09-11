import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Mingalar Express',
    template: '%s · Mingalar Express',
  },
  description: 'Fast, friendly, trusted parcel delivery across Greater Yangon.',
  applicationName: 'Mingalar Express',
  formatDetection: { telephone: true },
}

export const viewport: Viewport = {
  themeColor: '#c62828',
  width: 'device-width',
  initialScale: 1,
  // Riders use this one-handed on a bike mount; let them zoom the address.
  maximumScale: 5,
  /*
    WITHOUT THIS, EVERY SAFE-AREA INSET IN THE APP IS ZERO.

    `env(safe-area-inset-*)` only resolves to a real value once the viewport is
    told to extend under the device's rounded corners and home indicator. Until
    then mobile Safari reports 0, silently — nothing errors, the padding is just
    not there.

    Three places had been written against it and were all no-ops on an iPhone:
    the shop tab bar (components/shop/shop-nav.tsx), the rider tab bar
    (components/rider/rider-tabs.tsx) and the rider's fixed action bar
    (components/rider/job-actions.tsx), which is where a rider taps DONE. On a
    home-indicator phone the indicator sat over the bottom of those targets.

    Safe here because every bar that reaches the bottom edge already carries its
    own inset padding; this is the line that makes that padding mean something.
  */
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground">{children}</body>
    </html>
  )
}
