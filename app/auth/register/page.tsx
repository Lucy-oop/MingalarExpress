import Link from 'next/link'
import type { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RegisterForm } from './register-form'

export const metadata: Metadata = { title: 'Create a shop account' }

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a shop account</CardTitle>
        <CardDescription>
          For online shops in Thingangyun sending parcels with Mingalar Express.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RegisterForm />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/auth/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
