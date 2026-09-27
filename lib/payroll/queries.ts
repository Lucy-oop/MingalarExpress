import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database.types'

type Functions = Database['public']['Functions']
export type PreviewRow = Functions['payroll_preview']['Returns'][number]
export type PayslipRow = Database['public']['Tables']['payslips']['Row']
export type PayslipWithName = PayslipRow & { full_name: string }

export type PayrollMonth = {
  month: string
  locked: { lockedAt: string; payslipCount: number; totalNet: number } | null
  /** Locked month: its payslips. Open month: the live preview. */
  payslips: PayslipWithName[]
  preview: PreviewRow[]
  /** Runs dated in or before the month that are still open -- they block the lock. */
  openRuns: number
}

async function riderNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const supabase = await createClient()
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids)
  return new Map((data ?? []).map((p) => [p.id, p.full_name]))
}

/** Everything the payroll page shows for one month. */
export async function getPayrollMonth(month: string): Promise<PayrollMonth> {
  const supabase = await createClient()
  const monthEnd = new Date(`${month}T00:00:00Z`)
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
  monthEnd.setUTCDate(0)
  const finish = monthEnd.toISOString().slice(0, 10)

  const [{ data: period }, { count: openRuns }] = await Promise.all([
    supabase.from('pay_periods').select('locked_at, payslip_count, total_net').eq('month', month).maybeSingle(),
    supabase
      .from('trips')
      .select('id', { count: 'exact', head: true })
      .lte('service_date', finish)
      .in('status', ['planned', 'loading', 'departed', 'returned']),
  ])

  if (period) {
    const { data: slips, error } = await supabase
      .from('payslips')
      .select('*')
      .eq('month', month)
      .order('net', { ascending: false })
    if (error) throw new Error(`payslips unavailable: ${error.message}`)
    const names = await riderNames((slips ?? []).map((s) => s.rider_id))
    return {
      month,
      locked: { lockedAt: period.locked_at, payslipCount: period.payslip_count, totalNet: Number(period.total_net) },
      payslips: (slips ?? []).map((s) => ({ ...s, full_name: names.get(s.rider_id) ?? 'Rider' })),
      preview: [],
      openRuns: openRuns ?? 0,
    }
  }

  const { data: preview, error } = await supabase.rpc('payroll_preview', { p_month: month })
  if (error) throw new Error(`payroll preview unavailable: ${error.message}`)
  return { month, locked: null, payslips: [], preview: preview ?? [], openRuns: openRuns ?? 0 }
}

/** One payslip, with the rider's name. RLS: its rider, or the office. */
export async function getPayslip(id: string): Promise<PayslipWithName | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('payslips').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  const names = await riderNames([data.rider_id])
  return { ...data, full_name: names.get(data.rider_id) ?? 'Rider' }
}

/** The signed-in rider's own payslips, newest first. RLS scopes it. */
export async function getMyPayslips(): Promise<PayslipRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('payslips').select('*').order('month', { ascending: false })
  if (error) throw new Error(`payslips unavailable: ${error.message}`)
  return data ?? []
}

/** Active riders, for the adjustment form. */
export async function getPayrollRiders(): Promise<Array<{ id: string; name: string; baseSalary: number }>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('rider_profiles')
    .select('id, base_salary, profiles!rider_profiles_id_fkey (full_name, is_active)')
  return (data ?? [])
    .filter((r) => (r.profiles as unknown as { is_active: boolean } | null)?.is_active !== false)
    .map((r) => ({
      id: r.id,
      name: (r.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Rider',
      baseSalary: Number(r.base_salary ?? 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
