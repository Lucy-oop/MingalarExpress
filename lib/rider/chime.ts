'use client'

/**
 * The "new parcel" sound.
 *
 * SYNTHESISED, NOT A FILE. Two reasons: an mp3 is a network request a rider on
 * two bars in a stairwell may not get, and a bundled asset is one more thing to
 * cache-bust. WebAudio makes a clean two-note chime in a few lines and it is
 * instant and offline by construction.
 *
 * THE HARD PART IS PERMISSION, NOT SOUND. Mobile browsers refuse to start audio
 * until the user has interacted with the page, and a rider who opens the app and
 * puts the phone in their pocket has interacted with nothing. So the context is
 * created and resumed on the FIRST touch anywhere in the app — `arm()` from the
 * shell — and from then on a chime can fire whenever work arrives.
 *
 * If it never gets armed, the banner and the vibration still land. Nothing here
 * is allowed to be the only signal.
 */

const NOTES = [
  { hz: 880, at: 0, ms: 140 }, // A5
  { hz: 1318.5, at: 0.13, ms: 220 }, // E6
] as const

let ctx: AudioContext | null = null
let armed = false

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    return ctx
  } catch {
    return null
  }
}

/** Call from a real user gesture, once. Safe to call repeatedly. */
export function arm(): void {
  const c = context()
  if (!c) return
  // A suspended context is the normal state before a gesture; resuming inside
  // the gesture is what makes later programmatic playback legal.
  if (c.state === 'suspended') void c.resume()
  armed = true
}

export function isArmed(): boolean {
  return armed
}

export function chime(): void {
  const c = context()
  if (!c || c.state !== 'running') return

  for (const note of NOTES) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = note.hz
    // A short attack and an exponential tail: a square-edged tone through a
    // phone speaker on a moving bike reads as a glitch, not an alert.
    const start = c.currentTime + note.at
    const end = start + note.ms / 1000
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(gain).connect(c.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}

/**
 * Buzz as well as chime. Android honours this and it reaches a rider whose phone
 * is in a jacket pocket in traffic; iOS ignores it silently, which is why it is
 * never the only signal.
 */
export function buzz(): void {
  if (typeof navigator === 'undefined') return
  try {
    navigator.vibrate?.([180, 90, 180])
  } catch {
    // Blocked or unsupported. The banner still shows.
  }
}

export function alertNewWork(): void {
  chime()
  buzz()
}
