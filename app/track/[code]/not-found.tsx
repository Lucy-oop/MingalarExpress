import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'

export default function TrackNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <BrandMark />
      <SearchX className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Tracking code not found</h1>
      <p className="text-sm text-muted-foreground">
        Check the code with the shop you ordered from. Codes look like{' '}
        <span className="font-mono">MGE-260825-000001</span>.
      </p>
      <Link href="/" className="text-sm text-primary hover:underline">
        Back to Mingalar Express
      </Link>
    </main>
  )
}
