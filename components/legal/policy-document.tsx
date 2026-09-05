import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PolicyDocument } from '@/lib/legal/cod-advance'

/**
 * Renders a policy document. One renderer, so the interstitial and the
 * permanent copy under Shop settings cannot drift apart — the text a shop
 * accepts must be the text they can go back and read.
 *
 * `lang` comes off the document and NOT off the viewer's locale toggle. The
 * body is Burmese whichever language the panel is set to, so `:lang(my)` has to
 * be declared here or the line-height rule in globals.css never fires — and
 * this is a long document, exactly where stacked diacritics collide.
 */
export function PolicyDocumentView({
  doc,
  className,
}: {
  doc: PolicyDocument
  className?: string
}) {
  return (
    <article lang={doc.lang} className={cn('space-y-5', className)}>
      <header className="space-y-1 border-b pb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {doc.brand}
        </p>
        <h2 className="text-lg font-bold">{doc.title}</h2>
        <p className="text-sm text-muted-foreground" lang="en">
          {doc.subtitle}
        </p>
        <p className="pt-1 text-sm">{doc.intro}</p>
      </header>

      {doc.sections.map((s) => (
        <section key={s.n} className="space-y-2">
          <h3 className="text-sm font-bold">
            {s.n} {s.heading}
          </h3>

          {s.paragraphs?.map((p) => (
            <p key={p} className="text-sm">
              {p}
            </p>
          ))}

          {s.bullets ? (
            <ul className="ml-4 list-disc space-y-1 text-sm marker:text-muted-foreground">
              {s.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}

          {/* Clause 5's prohibited contents. Set apart rather than bulleted with
              everything else: it is the list that decides whether a shop keeps
              the service, and the ❌ in the source text is doing that work. */}
          {s.forbidden ? (
            <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {s.forbidden.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {s.footer ? <p className="text-sm">{s.footer}</p> : null}
        </section>
      ))}

      {/* The version is on screen, not just in the database. A shop asked to
          accept terms should be able to see which terms. */}
      <p className="border-t pt-3 text-[11px] text-muted-foreground" lang="en">
        Version {doc.version}
      </p>
    </article>
  )
}
