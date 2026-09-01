'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Plus, X } from 'lucide-react'
import { saveArea, type AdminResult } from '@/lib/admin/actions'
import type { ServiceArea } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Feedback = { tone: 'success' | 'error'; message: string }

/**
 * Wards are a table, not an enum, precisely so this screen can exist — renaming
 * or adding one must never need a migration.
 *
 * There is no delete. A ward is referenced by shops, orders and rider base
 * areas; deactivating hides it from every picker while leaving history
 * readable, which is what "we stopped serving that ward" actually means.
 */
export function AreaManager({ areas }: { areas: ServiceArea[] }) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function submit(areaId: string | null, fd: FormData) {
    setBusy(true)
    setFeedback(null)
    setFieldErrors(null)
    try {
      const result: AdminResult = await saveArea(areaId, fd)
      setFeedback({ tone: result.ok ? 'success' : 'error', message: result.message })
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? null)
      } else {
        setEditingId(null)
        setAdding(false)
        startTransition(() => router.refresh())
      }
    } catch {
      setFeedback({ tone: 'error', message: 'Network problem — nothing was saved. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm">Wards ({areas.filter((a) => a.is_active).length} active)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Used for rider base areas, dropoff grouping and shop registration.
          </p>
        </div>
        <Button
          size="sm"
          variant={adding ? 'ghost' : 'outline'}
          onClick={() => {
            setAdding((a) => !a)
            setEditingId(null)
          }}
        >
          {adding ? <X /> : <Plus />}
          {adding ? 'Cancel' : 'Add ward'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

        {adding ? (
          <AreaForm
            area={null}
            busy={busy}
            fieldErrors={fieldErrors}
            nextSortOrder={(areas.at(-1)?.sort_order ?? 0) + 10}
            onSubmit={(fd) => submit(null, fd)}
            onCancel={() => setAdding(false)}
          />
        ) : null}

        {areas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No wards yet. Add the ones Mingalar Express serves.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {areas.map((a) => (
              <li key={a.id}>
                <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {a.name}
                      {a.name_mm ? (
                        <span className="text-muted-foreground">{a.name_mm}</span>
                      ) : null}
                      {a.is_active ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Inactive</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Sort {a.sort_order}
                      {a.centroid ? ' · centroid set' : ' · no centroid'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(editingId === a.id ? null : a.id)
                      setAdding(false)
                      setFieldErrors(null)
                    }}
                  >
                    {editingId === a.id ? 'Close' : 'Edit'}
                  </Button>
                </div>

                {editingId === a.id ? (
                  <div className="border-t bg-muted/30 p-3">
                    <AreaForm
                      area={a}
                      busy={busy}
                      fieldErrors={fieldErrors}
                      onSubmit={(fd) => submit(a.id, fd)}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------

function AreaForm({
  area,
  busy,
  fieldErrors,
  nextSortOrder,
  onSubmit,
  onCancel,
}: {
  area: ServiceArea | null
  busy: boolean
  fieldErrors: Record<string, string[]> | null
  nextSortOrder?: number
  onSubmit: (fd: FormData) => void
  onCancel: () => void
}) {
  const id = area?.id ?? 'new'
  const err = (k: string) => fieldErrors?.[k]?.[0]

  return (
    <form action={onSubmit} className="space-y-3 rounded-md border bg-background p-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ward name" htmlFor={`name-${id}`} required error={err('name')}>
          <Input
            id={`name-${id}`}
            name="name"
            defaultValue={area?.name ?? ''}
            required
            aria-invalid={!!err('name')}
          />
        </Field>

        <Field label="Name (Myanmar)" htmlFor={`nameMm-${id}`} error={err('nameMm')}>
          <Input id={`nameMm-${id}`} name="nameMm" defaultValue={area?.name_mm ?? ''} />
        </Field>

        <Field
          label="Sort order"
          htmlFor={`sort-${id}`}
          hint="Lower shows first in pickers."
          error={err('sortOrder')}
        >
          <Input
            id={`sort-${id}`}
            name="sortOrder"
            type="number"
            min="0"
            defaultValue={area?.sort_order ?? nextSortOrder ?? 100}
          />
        </Field>

        <div className="flex items-end pb-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              className="size-4"
              defaultChecked={area?.is_active ?? true}
            />
            Active
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Centroid latitude"
          htmlFor={`lat-${id}`}
          hint="Optional. Both or neither."
          error={err('lat')}
        >
          <Input id={`lat-${id}`} name="lat" type="number" step="0.000001" placeholder="16.8409" />
        </Field>
        <Field label="Centroid longitude" htmlFor={`lng-${id}`} error={err('lng')}>
          <Input id={`lng-${id}`} name="lng" type="number" step="0.000001" placeholder="96.1735" />
        </Field>
      </div>

      {area?.centroid ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" />
          A centroid is already stored. Leave the two fields blank to keep it.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? 'Saving…' : area ? 'Save ward' : 'Add ward'}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
