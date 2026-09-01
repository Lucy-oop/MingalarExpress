/**
 * Resolve hook for `node --test` on TypeScript sources.
 *
 * Node 24 strips types natively but does NOT do bundler-style resolution, so it
 * rejects the extensionless and `@/`-aliased specifiers the app uses. Rather
 * than contort application code to suit the test runner (or install a whole
 * second toolchain), this teaches Node the two rules tsconfig already states:
 *
 *   1. `@/x` -> <project root>/x
 *   2. extensionless -> probe .ts, .tsx, .mts, .js, then /index.*
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs']

function probe(basePath) {
  for (const ext of EXTENSIONS) {
    if (existsSync(basePath + ext)) return basePath + ext
  }
  for (const ext of EXTENSIONS) {
    const indexed = path.join(basePath, `index${ext}`)
    if (existsSync(indexed)) return indexed
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  const spec = specifier.startsWith('@/')
    ? pathToFileURL(path.join(ROOT, specifier.slice(2))).href
    : specifier

  try {
    return await nextResolve(spec, context)
  } catch (error) {
    let base
    if (spec.startsWith('file://')) base = fileURLToPath(spec)
    else if (spec.startsWith('.')) {
      const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : ROOT
      base = path.resolve(parent, spec)
    } else throw error

    const found = probe(base)
    if (!found) throw error
    return nextResolve(pathToFileURL(found).href, context)
  }
}
