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
 *
 * NOT PRELOADED. The file is a 154 KB variable font, and a preload puts it at
 * the front of EVERY page's queue -- including the English landing page, which
 * has no Burmese at all. On PageSpeed's throttled mobile profile that was ~1s
 * of bandwidth competing with the HTML and CSS before first paint. Without the
 * preload, the `unicode-range` above means the browser fetches it only when
 * Burmese glyphs are actually on screen, and `display: swap` paints the text in
 * the fallback immediately and swaps when it lands. Latin UI text uses the
 * system font stack and never waits for a download.
 */
export const notoSansMyanmar = Noto_Sans_Myanmar({
  subsets: ['myanmar'],
  display: 'swap',
  preload: false,
  variable: '--font-myanmar',
})
