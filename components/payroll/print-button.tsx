'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** The browser's print dialog, which also offers "Save as PDF". */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
      <Printer />
      {label}
    </Button>
  )
}
