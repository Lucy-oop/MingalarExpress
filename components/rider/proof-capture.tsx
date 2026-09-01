'use client'

import { useRef, useState } from 'react'
import { Camera, ImageUp, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prepareProofImage, type PreparedImage } from '@/lib/rider/image'
import { cn } from '@/lib/utils'

/**
 * Delivery-proof camera.
 *
 * `capture="environment"` opens the rear camera directly on Android and iOS
 * rather than a file browser. The photo is downscaled and re-encoded on-device
 * before it is ever queued or uploaded — a raw 5 MB camera JPEG will not survive
 * a stairwell connection.
 */
export function ProofCapture({
  onReady,
  disabled,
}: {
  onReady: (image: PreparedImage | null) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
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
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
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
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={disabled}>
              <RotateCcw />
              Retake
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="touch"
          block
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className={cn('border-dashed', error && 'border-destructive')}
        >
          {busy ? <ImageUp className="animate-pulse" /> : <Camera />}
          {busy ? 'Preparing photo…' : 'Take delivery photo'}
        </Button>
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
