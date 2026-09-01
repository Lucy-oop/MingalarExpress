import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Mingalar Express',
    template: '%s · Mingalar Express',
  },
  description: 'Fast, friendly, trusted delivery in Thingangyun Township, Yangon.',
  applicationName: 'Mingalar Express',
  formatDetection: { telephone: true },
}

export const viewport: Viewport = {
  themeColor: '#c62828',
  width: 'device-width',
  initialScale: 1,
  // Riders use this one-handed on a bike mount; let them zoom the address.
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground">{children}</body>
    </html>
  )
}
