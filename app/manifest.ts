import type { MetadataRoute } from 'next'

/**
 * PWA manifest. `start_url` points at the rider dashboard because riders are the
 * only role that installs this to a home screen — the office and shops use a
 * browser on a bigger screen.
 *
 * ---------------------------------------------------------------------------
 * TWO ICONS FROM ONE LOGO, AND WHY THEY DIFFER
 *
 * `purpose: 'any'` is shown whole. `purpose: 'maskable'` is CROPPED by the
 * platform — Android cuts it to a circle, a squircle or a rounded square
 * depending on the launcher, and only the centre 80% is guaranteed to survive.
 *
 * The brand logo is a full-bleed square: the wordmark runs nearly edge to edge
 * and "Fast • Friendly • Trusted" sits low. Measured against a circular mask,
 * 11% of the artwork falls outside the safe zone — both ends of "MINGALAR" and
 * most of the tagline. So the maskable icon is the same logo inset to 80% on
 * its own white field, which clips nothing.
 *
 * Declaring one file for both purposes, which is what this manifest used to do
 * with the old SVG, means either a cropped logo on Android or a needlessly
 * shrunken one everywhere else.
 *
 * PNG, NOT SVG. The previous icon was a hand-written SVG chosen so there was no
 * binary to keep in sync with the brand. The brand is now a raster logo, so
 * that trade no longer applies — and iOS has never accepted SVG for a home
 * screen icon at all.
 *
 * The iOS home-screen icon and the browser tab icon are NOT here: they come
 * from `app/apple-icon.png` and `app/icon.png` via Next's file conventions,
 * which inject the <link> tags automatically.
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
    // White, matching the logo's own field, so the splash screen does not put a
    // white tile on a coloured ground.
    background_color: '#ffffff',
    theme_color: '#c62828',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
