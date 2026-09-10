import Link from 'next/link'
import type { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }

const NOTICES: Record<string, { tone: 'error' | 'info'; message: string }> = {
  account_disabled: {
    tone: 'error',
    message: 'This account has been disabled. Contact the office.',
  },
  no_profile: {
    tone: 'error',
    message: 'This account is not set up yet. Contact the office.',
  },
  session_expired: { tone: 'info', message: 'Your session expired. Please sign in again.' },
  not_configured: {
    tone: 'error',
    message: 'Sign-in is not configured on this deployment. Contact the administrator.',
  },
  /*
    A ROLE THAT NO LONGER EXISTS. `ROLE_HOME.dispatcher` points here rather
    than into /admin, because /admin now refuses the role and sending it there
    would loop. Nothing should reach this -- the one dispatcher account went
    with the change -- but the enum value survives in the schema, so an account
    minted by hand through the Admin API still can.
  */
  role_retired: {
    tone: 'error',
    message: 'This account type is no longer used. Ask the administrator for an office account.',
  },
  missing_code: { tone: 'error', message: 'That confirmation link was incomplete.' },
  link_expired: { tone: 'error', message: 'That link has expired. Please sign in again.' },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; registered?: string }>
}) {
  const { next, error, registered } = await searchParams
  const notice = error ? NOTICES[error] : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portal Sign In</CardTitle>
        <CardDescription>
          Shops, riders and the office use the same door. Sign in with the email address
          your account was created with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {registered ? (
          <Alert tone="success" title="Account created">
            Sign in to set up your shop and pickup point.
          </Alert>
        ) : null}
        {notice ? <Alert tone={notice.tone}>{notice.message}</Alert> : null}

        <LoginForm next={next} />

        <p className="text-center text-sm text-muted-foreground">
          Running an online shop?{' '}
          <Link href="/register-shop" className="font-medium text-primary hover:underline">
            Register your shop
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground">
          Riders are registered by the Mingalar Express office.
        </p>
      </CardContent>
    </Card>
  )
}
