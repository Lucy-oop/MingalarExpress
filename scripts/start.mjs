/**
 * `next start`, with the .env files actually loaded.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS FOR
 *
 * In Next 16, `next start` does NOT read `.env.local`. `next dev` does — it
 * even announces it:
 *
 *     next dev    ▲ Next.js 16.3.2 (Turbopack)
 *                 - Environments: .env.local     <-- loaded
 *     next start  ▲ Next.js 16.3.2
 *                 (no such line)                 <-- not loaded
 *
 * Most of the app never noticed, because every other variable it reads is
 * `NEXT_PUBLIC_*` and those are INLINED INTO THE BUNDLE at build time, when
 * `next build` does load `.env.local`. So the site renders, sign-in works, the
 * map has its tiles — and exactly one variable is missing:
 * `SUPABASE_SERVICE_ROLE_KEY`, which is server-only and therefore read from
 * `process.env` at runtime.
 *
 * The result was a production-mode server where everything worked except
 * creating accounts, failing with "SUPABASE_SERVICE_ROLE_KEY is not configured
 * on the server". Registering a rider, minting a rider setup link, the office
 * creating a shop owner, and the phone-uniqueness check during public signup —
 * all four go through `createAdminClient()`, and all four were dead.
 *
 * ---------------------------------------------------------------------------
 * WHY A WRAPPER AND NOT A SHELL LINE
 *
 * `set -a; . ./.env.local; set +a && next start` would work on this machine and
 * nowhere else: it is bash-specific, it mis-parses any value containing a
 * space or a `#`, and it silently does nothing if the file is absent. This uses
 * the same loader Next itself uses — `@next/env`, the package `next dev` calls
 * — so the parsing, the precedence and the file list are identical by
 * construction rather than by imitation.
 *
 * SAFE IN A REAL DEPLOYMENT. `loadEnvConfig` never overwrites a variable that
 * is already set: real `process.env` wins over every file. On a host that
 * injects its own secrets there is no `.env.local` to find, and this is a
 * no-op that costs one require.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// `@next/env` is CommonJS, so the named export is not reachable from ESM.
import nextEnv from '@next/env'

const { loadEnvConfig } = nextEnv

const dir = process.cwd()

// `dev = false` — the same argument `next start` would pass, so the file
// precedence matches production: .env.production.local, .env.local,
// .env.production, .env.
const { loadedEnvFiles } = loadEnvConfig(dir, false)

if (loadedEnvFiles.length > 0) {
  // Say what was loaded, because the whole failure mode above was silence.
  // Mirrors the line `next dev` prints.
  console.log(`- Environments: ${loadedEnvFiles.map((f) => f.path).join(', ')}`)
} else {
  console.log('- Environments: none found (using the process environment as-is)')
}

/*
  Spawned rather than imported: `next start` is a CLI, and re-implementing its
  argument handling to call the server programmatically would be a second thing
  to keep in step with Next. The child inherits the process.env that
  loadEnvConfig just populated, which is the entire point.
*/
const child = spawn(
  process.execPath,
  [
    // fileURLToPath, not URL.pathname: the latter leaves %20 in any path with
    // a space in it, which is most of them on a Mac.
    fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    'start',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: process.env },
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

/*
  FORWARD SIGNALS, or the server outlives the wrapper.

  Ctrl-C in a terminal signals the whole process group, so interactive use was
  always fine — but anything that targets this process by name (`pkill -f
  scripts/start.mjs`, a supervisor, a stop script) killed the wrapper and left
  `next-server` holding port 3000. The next start then failed with EADDRINUSE
  and looked like a port conflict rather than an orphan.
*/
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (child.exitCode === null && !child.killed) child.kill(signal)
  })
}
