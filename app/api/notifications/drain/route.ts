import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { drainOutbox } from '@/lib/notifications/worker'

/**
 * The outbox drain, called once a minute by pg_cron.
 *
 * WHY A ROUTE AND NOT A SUPABASE EDGE FUNCTION. The plan was an Edge Function,
 * and the reason given for it — pg_cron drives it, no external server, no cron
 * process to babysit — is unchanged here: pg_cron still fires it, via
 * `net.http_post`. What changed is where the code lives. An Edge Function is
 * Deno, so the Burmese templates and the segment arithmetic would have to be
 * duplicated across the two runtimes or imported across a bundling boundary
 * Supabase does not really support; both roads end in the two copies drifting.
 * Keeping the drain in this repo means one language, one test suite, one place
 * a template is edited.
 *
 * The cost of that choice, stated plainly: notifications pause while the web app
 * is down or mid-deploy. They are not lost — the outbox is in Postgres and the
 * next minute's tick picks them up — but they are delayed. If that ever stops
 * being acceptable, the Edge Function is a thin wrapper around `drainOutbox`
 * and the schema does not move.
 *
 * See supabase/snippets/notify_cron.sql for the scheduling.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorised(request: NextRequest): boolean {
  const secret = process.env.NOTIFY_CRON_SECRET
  // Fail CLOSED. An unset secret must not mean an open endpoint that anybody
  // can use to drain the outbox at somebody else's expense.
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const offered = header.startsWith('Bearer ') ? header.slice(7) : header

  const a = Buffer.from(offered)
  const b = Buffer.from(secret)
  // timingSafeEqual throws on a length mismatch, which is itself a leak of the
  // secret's length, so compare lengths separately and always run the compare.
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  try {
    const report = await drainOutbox()
    // pg_cron discards the body; this is for `curl` and for the log.
    return NextResponse.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'drain failed'
    console.error('[sms] drain failed:', message)
    // 500 rather than 200: an uptime check should see this.
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
