'use client'

import * as React from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The short link the office pastes into Viber or Telegram.
 *
 * `/o/MGE-260901-000009` rather than `/shop/orders/<uuid>`. It was built to fit
 * a Burmese SMS segment; the SMS is gone and the link outlived it, because a
 * 36-character UUID in a chat message is just as unreadable as it was in a text.
 *
 * The origin comes from the browser rather than an env var, so this is correct
 * on localhost, on a preview deploy and in production without anything being
 * configured. It renders a placeholder until mount to avoid a hydration
 * mismatch — the server has no window to read.
 */
export function ShareOrderLink({ code }: { code: string }) {
  const [origin, setOrigin] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => setOrigin(window.location.origin), [])

  React.useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const url = origin ? `${origin}/o/${code}` : `/o/${code}`

  const copy = async () => {
    setFailed(false)
    try {
      // Throws on an insecure origin and when the user has denied clipboard
      // access. Selecting the field is a worse experience than a copy, and a
      // much better one than a button that silently does nothing.
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setFailed(true)
      inputRef.current?.select()
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label="Short link to this parcel"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs"
        />
        <Button variant="outline" size="sm" type="button" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {failed
          ? 'Could not reach the clipboard — the link is selected, press Ctrl/Cmd+C.'
          : 'Paste into Viber or Telegram. It opens the parcel for whoever is signed in.'}
      </p>
    </div>
  )
}
