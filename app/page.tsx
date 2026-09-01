import Link from 'next/link'
import { PackageSearch } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <BrandMark />

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="space-y-1 text-center">
            <h1 className="font-semibold">Track your parcel</h1>
            <p className="text-sm text-muted-foreground">
              Enter the code your shop gave you.
            </p>
          </div>
          {/* GET form: the code becomes the URL, so the page is shareable and
              the customer can bookmark it. */}
          <form action="/track" className="flex gap-2">
            <Input
              name="code"
              placeholder="MGE-260825-000001"
              className="font-mono"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
            <button type="submit" className={buttonVariants({ size: 'default' })}>
              <PackageSearch className="size-4" />
              Track
            </button>
          </form>
        </CardContent>
      </Card>

      {/* One door for all four roles; the portal sorts them by role on arrival. */}
      <div className="flex flex-col gap-2">
        <Link href="/login" className={buttonVariants({ variant: 'default', block: true })}>
          Portal Sign In
        </Link>
        <Link href="/register-shop" className={buttonVariants({ variant: 'outline', block: true })}>
          Register Your Shop
        </Link>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Serving Greater Yangon · Fast · Friendly · Trusted
      </p>
    </main>
  )
}
