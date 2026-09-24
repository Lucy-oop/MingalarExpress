import { Noto_Sans_Myanmar } from 'next/font/google'

/**
 * Noto Sans Myanmar, self-hosted by next/font at build time.
 *
 * MYANMAR SUBSET ONLY, so the generated @font-face carries a Burmese
 * `unicode-range`. The browser uses this face for Burmese characters and falls
 * through to the next font in the stack for everything else -- which is why it
 * can sit first in `--font-sans` without turning the Latin text into Noto.
 *
 * Exposed as `--font-myanmar`; the root layout puts the
 * variable on <html>, and globals.css builds the font stacks from it.
 */
export const notoSansMyanmar = Noto_Sans_Myanmar({
  subsets: ['myanmar'],
  display: 'swap',
  variable: '--font-myanmar',
})
