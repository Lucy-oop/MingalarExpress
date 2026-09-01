import type { MetadataRoute } from 'next'

/**
 * PWA manifest. `start_url` points at the rider dashboard because riders are the
 * only role that installs this to a home screen — shops and dispatchers use a
 * browser on a bigger screen.
 *
 * Icons are declared as SVG (app/icon.svg) so there is no binary asset to keep
 * in sync with the brand. Android accepts SVG for maskable icons; replace with
 * 192/512 PNGs before store submission if you ever wrap this in a native shell.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mingalar Express Rider',
    short_name: 'Mingalar',
    description: 'Delivery jobs, pickups and proof of delivery for Mingalar Express riders.',
    start_url: '/rider/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#c62828',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
