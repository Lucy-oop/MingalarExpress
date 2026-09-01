import { BrandMark } from '@/components/shared/brand-mark'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10">
      <BrandMark />
      <div className="w-full max-w-sm">{children}</div>
      <p className="text-center text-xs text-muted-foreground">
        Serving Thingangyun Township, Yangon
      </p>
    </main>
  )
}
