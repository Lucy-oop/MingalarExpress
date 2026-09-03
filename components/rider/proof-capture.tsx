'use client'

import { useId, useRef, useState } from 'react'
import { Camera, ImageUp, RotateCcw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { prepareProofImage, type PreparedImage } from '@/lib/rider/image'
import { cn } from '@/lib/utils'
import type { Translate } from '@/lib/i18n'

/**
 * Delivery-proof camera.
 *
 * `capture="environment"` opens the rear camera directly on Android and iOS
 * rather than a file browser. The photo is downscaled and re-encoded on-device
 * before it is ever queued or uploaded — a raw 5 MB camera JPEG will not survive
 * a stairwell connection.
 *
 * THE TRIGGER IS A <label>, NOT A BUTTON CALLING .click().
 *
 * It used to be a button doing `inputRef.current?.click()` on an input styled
 * `display: none`. That combination is unreliable on exactly the hardware this
 * app targets: several Android WebViews and older Samsung Internet builds refuse
 * to open the camera for an input that is not rendered, so the button did
 * nothing at all and the rider had no way to finish the job. A label activates
 * the input through the platform's own path, which needs no JavaScript and
 * cannot be blocked, and the input is now visually hidden rather than removed
 * from the layout.
 *
 * `inputRef` survives for `reset()`, which has to clear `input.value` — without
 * that, re-selecting the same file fires no change event and Retake appears to
 * hang.
 */
export function ProofCapture({
  onReady,
  disabled,
  t,
  label,
}: {
  onReady: (image: PreparedImage | null) => void
  disabled?: boolean
  t: Translate
  /** Overrides the button text — the KPay receipt is not a delivery photo. */
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [preview, setPreview] = useState<string | null>(null)
  const [image, setImage] = useState<PreparedImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const prepared = await prepareProofImage(file)
      if (preview) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(prepared.blob))
      setImage(prepared)
      onReady(prepared)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use that photo')
      setImage(null)
      onReady(null)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setImage(null)
    setError(null)
    onReady(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="relative space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled || busy}
        /* Visually hidden, but still laid out and still clickable — `hidden`
           (display: none) is what broke the camera on some Android WebViews. */
        className="absolute size-px overflow-hidden opacity-0"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {preview ? (
        <div className="space-y-2">
          {/* Local blob preview; next/image would add no value and cannot optimise a blob URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Delivery proof"
            className="max-h-56 w-full rounded-lg border object-cover"
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {image ? `${image.width}×${image.height} · ${formatKb(image.blob.size)}` : null}
              {image && image.originalBytes > image.blob.size ? (
                <span className="text-emerald-700">
                  {' '}
                  (from {formatKb(image.originalBytes)})
                </span>
              ) : null}
            </span>
            <Button type="button" variant="outline" size="touch" onClick={reset} disabled={disabled}>
              <RotateCcw />
              {t('action.retakePhoto')}
            </Button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'touch', block: true }),
            'min-h-20 cursor-pointer border-2 border-dashed text-lg font-bold',
            error && 'border-destructive',
            // A label has no disabled state, so it is spelled out.
            (disabled || busy) && 'pointer-events-none opacity-50',
          )}
        >
          {busy ? <ImageUp className="animate-pulse" /> : <Camera className="size-6" />}
          {busy ? t('action.preparing') : (label ?? t('action.takePhoto'))}
        </label>
      )}

      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

function formatKb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`
}
