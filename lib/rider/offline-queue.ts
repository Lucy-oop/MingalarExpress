'use client'

/**
 * Offline action queue for the rider PWA.
 *
 * The problem this solves is specific and real: a rider in a Thingangyun stairwell
 * taps "Delivered", the request dies, and the parcel is delivered but the system
 * says otherwise. The COD ledger then disagrees with the cash in their pocket.
 *
 * So every state-changing tap is written to IndexedDB FIRST and replayed later.
 * IndexedDB rather than localStorage because the proof photo is a Blob and has to
 * survive the app being killed — localStorage is strings only, and a base64
 * round-trip inflates a 200 KB photo by a third for no reason.
 *
 * Replay safety rests on `advance_order` being idempotent: the status machine
 * short-circuits when the new status equals the old one, so re-sending
 * "picked_up" for an already-picked-up order is a no-op rather than an error.
 * A genuinely stale action (delivered, then a queued picked_up) fails
 * `illegal_transition`, which we treat as "superseded" and drop.
 */

// 'accept_offer' / 'decline_offer' were removed with the offer engine in 0009.
// A queued action is now always a checkpoint on work the rider already holds.
export type QueuedKind = 'picked_up' | 'delivered' | 'failed'

export type QueuedAction = {
  id: string
  kind: QueuedKind
  orderId: string
  orderCode: string
  /** Whole-order snapshot fields needed to replay without re-reading the DB. */
  reason?: string
  receiver?: string
  lat?: number
  lng?: number
  /** Proof photo, still un-uploaded. Stored as a Blob, not base64. */
  proof?: Blob
  proofContentType?: string
  createdAt: number
  attempts: number
  lastError?: string
}

const DB_NAME = 'mingalar-rider'
const DB_VERSION = 1
const STORE = 'queue'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
        store.createIndex('orderId', 'orderId')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'))
      }),
  )
}

export function newActionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function enqueue(action: Omit<QueuedAction, 'id' | 'createdAt' | 'attempts'>) {
  const record: QueuedAction = {
    ...action,
    id: newActionId(),
    createdAt: Date.now(),
    attempts: 0,
  }
  await tx('readwrite', (store) => store.put(record))
  notify()
  return record
}

export async function listQueue(): Promise<QueuedAction[]> {
  const all = await tx<QueuedAction[]>('readonly', (store) => store.getAll() as IDBRequest<QueuedAction[]>)
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function removeAction(id: string) {
  await tx('readwrite', (store) => store.delete(id) as unknown as IDBRequest<undefined>)
  notify()
}

export async function updateAction(action: QueuedAction) {
  await tx('readwrite', (store) => store.put(action))
  notify()
}

export async function queueSize(): Promise<number> {
  try {
    return await tx<number>('readonly', (store) => store.count())
  } catch {
    return 0
  }
}

/** Actions queued against a given order, so the UI can show it as pending sync. */
export async function pendingKindsForOrder(orderId: string): Promise<QueuedKind[]> {
  const all = await listQueue()
  return all.filter((a) => a.orderId === orderId).map((a) => a.kind)
}

// ---------------------------------------------------------------------------
// Change notification. A BroadcastChannel keeps two open tabs in step; the
// window event covers the same tab and browsers without BroadcastChannel.
// ---------------------------------------------------------------------------

export const QUEUE_EVENT = 'mge:queue-changed'

let channel: BroadcastChannel | null = null
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  channel ??= new BroadcastChannel('mge-rider-queue')
  return channel
}

function notify() {
  window.dispatchEvent(new Event(QUEUE_EVENT))
  getChannel()?.postMessage('changed')
}

export function onQueueChange(handler: () => void): () => void {
  window.addEventListener(QUEUE_EVENT, handler)
  const ch = getChannel()
  const onMessage = () => handler()
  ch?.addEventListener('message', onMessage)
  return () => {
    window.removeEventListener(QUEUE_EVENT, handler)
    ch?.removeEventListener('message', onMessage)
  }
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type FlushOutcome = 'done' | 'superseded' | 'retry' | 'dead'

export const MAX_ATTEMPTS = 8

/**
 * Decide what to do with a failed replay.
 *
 * `superseded` matters: after a successful "delivered", a queued "picked_up"
 * from the same trip is not an error to surface — it is history that arrived
 * late. Dropping it silently is correct. Retrying it forever would leave a
 * permanent red badge on a rider's screen for work they completed.
 */
export function classifyFailure(message: string, attempts: number): FlushOutcome {
  const m = message.toLowerCase()

  if (m.includes('illegal_transition')) return 'superseded'
  if (m.includes('order_not_found')) return 'superseded'
  if (m.includes('order_not_assignable')) return 'dead'
  // Postgres says "permission denied for table x" and PostgREST says
  // "row-level security"; neither contains the word "forbidden", and retrying
  // an authorisation failure eight times helps nobody.
  if (
    m.includes('forbidden') ||
    m.includes('42501') ||
    m.includes('permission denied') ||
    m.includes('row-level security')
  ) {
    return 'dead'
  }
  if (m.includes('proof_required') || m.includes('fail_reason_required')) return 'dead'

  return attempts + 1 >= MAX_ATTEMPTS ? 'dead' : 'retry'
}

/** Exponential backoff with a ceiling, in ms. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5))
}
