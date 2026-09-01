'use client'

/**
 * Delivery-proof image preparation.
 *
 * A modern phone camera produces a 3–6 MB JPEG. Uploading that over Yangon
 * mobile data from a stairwell is the difference between a proof that lands and
 * one that times out, so every photo is downscaled and re-encoded before it
 * leaves the device. Target is ~120–250 KB, which is plenty to read a house
 * number and a face.
 *
 * WebP where supported, JPEG otherwise. The storage bucket accepts both
 * (migration 0004 allows image/webp, image/jpeg, image/png), so the fallback is
 * a real fallback and not a broken upload.
 */

export const MAX_EDGE_PX = 1280
export const WEBP_QUALITY = 0.72
export const JPEG_QUALITY = 0.78
/** Matches the bucket's file_size_limit in migration 0004. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export type PreparedImage = {
  blob: Blob
  contentType: 'image/webp' | 'image/jpeg'
  extension: 'webp' | 'jpg'
  width: number
  height: number
  originalBytes: number
}

let webpSupport: boolean | null = null

/**
 * Can this browser ENCODE WebP? Decoding is near-universal; encoding via
 * canvas.toDataURL is not (older Safari silently hands back a PNG), so we check
 * the returned MIME type rather than trusting the request.
 */
export function supportsWebpEncode(): boolean {
  if (webpSupport !== null) return webpSupport
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpSupport = false
  }
  return webpSupport
}

export function scaledSize(
  width: number,
  height: number,
  maxEdge = MAX_EDGE_PX,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const ratio = maxEdge / longest
  // Never round to 0 for an extreme aspect ratio — a 0-width canvas throws.
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap also applies EXIF orientation, which matters: a photo
  // taken in portrait would otherwise be stored on its side.
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image'))
    }
    img.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export async function prepareProofImage(file: File | Blob): Promise<PreparedImage> {
  const originalBytes = file.size
  const bitmap = await loadBitmap(file)
  const sourceWidth = 'width' in bitmap ? bitmap.width : 0
  const sourceHeight = 'height' in bitmap ? bitmap.height : 0
  if (!sourceWidth || !sourceHeight) throw new Error('That image could not be read')

  const { width, height } = scaledSize(sourceWidth, sourceHeight)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This device cannot process images')
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height)
  if ('close' in bitmap) bitmap.close()

  const preferWebp = supportsWebpEncode()
  let blob = await toBlob(canvas, preferWebp ? 'image/webp' : 'image/jpeg', preferWebp ? WEBP_QUALITY : JPEG_QUALITY)
  let contentType: PreparedImage['contentType'] = preferWebp ? 'image/webp' : 'image/jpeg'

  // Belt and braces: if WebP encoding silently produced nothing, fall back.
  if (!blob && preferWebp) {
    blob = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY)
    contentType = 'image/jpeg'
  }
  if (!blob) throw new Error('Could not compress the photo')

  // Still too big (a very detailed 1280px frame): step the quality down once.
  if (blob.size > MAX_UPLOAD_BYTES) {
    const retry = await toBlob(canvas, contentType, 0.5)
    if (retry && retry.size < blob.size) blob = retry
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error('That photo is too large. Take another one.')
  }

  return {
    blob,
    contentType,
    extension: contentType === 'image/webp' ? 'webp' : 'jpg',
    width,
    height,
    originalBytes,
  }
}

/**
 * Storage object path. MUST be `<order_id>/<name>` — the storage policy in
 * migration 0004 reads `(storage.foldername(name))[1]::uuid` as the order id to
 * check the rider owns it. Any other shape is rejected.
 */
export function proofObjectPath(orderId: string, extension: string): string {
  const unique =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${orderId}/${unique}.${extension}`
}
