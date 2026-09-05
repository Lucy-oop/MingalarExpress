'use client'

import * as React from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/components/shared/i18n-provider'

/**
 * The print dialog, and the button to summon it again.
 *
 * `auto` fires once on arrival, and only when the page was opened with
 * `?print=1` -- which the modal, the detail page and the batch button all set.
 * Landing on the URL without it shows the labels and waits, so nobody gets an
 * unexplained print dialog from following a link.
 *
 * It waits on `document.fonts.ready` because the code is set in a monospace
 * face at 20pt: printing before it loads measures the fallback and can wrap the
 * one string on the label that must never wrap. The guard ref survives the
 * double-invoke of development Strict Mode, which would otherwise open the
 * dialog twice.
 */
export function PrintControls({ auto }: { auto: boolean }) {
  const t = useT()
  const fired = React.useRef(false)

  React.useEffect(() => {
    if (!auto || fired.current) return
    fired.current = true
    let cancelled = false
    const go = () => {
      if (!cancelled) window.print()
    }
    if (document.fonts?.ready) {
      void document.fonts.ready.then(go)
    } else {
      go()
    }
    return () => {
      cancelled = true
    }
  }, [auto])

  return (
    <Button size="touch" onClick={() => window.print()}>
      <Printer />
      {t('label.print')}
    </Button>
  )
}
