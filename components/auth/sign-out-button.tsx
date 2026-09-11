'use client'

import { useFormStatus } from 'react-dom'
import { LogOut, Loader2 } from 'lucide-react'
import { signOut } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'

/**
 * Sign out, and say so while it happens.
 *
 * WHY THIS IS A COMPONENT AND NOT FOUR INLINE FORMS. It was four inline forms
 * — the three shells and the policy gate — each a plain `<form action={signOut}>`
 * with a plain Button and no pending state at all. The login form has had
 * `useFormStatus` since it was written; sign-out never got the same treatment.
 *
 * That gap is not cosmetic. `signOut` is a round trip to GoTrue, then
 * `revalidatePath('/', 'layout')`, then a redirect — and that revalidate
 * invalidates the ROOT layout, so the login page that follows renders
 * completely cold. Against this project that is comfortably over a second of
 * nothing visibly happening after the click, on a control the user pressed
 * because they want to leave. The obvious reading is that it did not work, and
 * the obvious response is to press it again.
 *
 * A second press is not harmless either: it posts the action twice, and the
 * second lands on a session the first already destroyed.
 *
 * `useFormStatus` must read the status of an ANCESTOR form, so the button and
 * the form cannot be the same component — hence the wrapper below rendering
 * the form and `SignOutInner` reading the status from inside it.
 */
function SignOutInner({
  label,
  iconOnly,
  className,
}: {
  label: string
  iconOnly?: boolean
  className?: string
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      variant="ghost"
      size={iconOnly ? 'icon' : 'sm'}
      type="submit"
      disabled={pending}
      aria-label={label}
      className={className}
    >
      {pending ? <Loader2 className="animate-spin" /> : <LogOut />}
      {/* The label is hidden below sm in every shell that shows one: an icon
          alone beside the language toggle makes "switch language" and "end my
          session" neighbours in the same thumb zone. */}
      {iconOnly ? null : <span className="hidden sm:inline">{label}</span>}
    </Button>
  )
}

export function SignOutButton({
  label,
  iconOnly,
  className,
}: {
  label: string
  iconOnly?: boolean
  /** For the shells that need a bigger target than the default icon size. */
  className?: string
}) {
  return (
    <form action={signOut}>
      <SignOutInner label={label} iconOnly={iconOnly} className={className} />
    </form>
  )
}
