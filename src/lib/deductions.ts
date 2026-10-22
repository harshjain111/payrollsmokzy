import { supabase } from '@/integrations/supabase/client';
import { fetchDisciplineRules, fetchStaffAssignment, lateFine } from '@/lib/discipline';

export type DeductionKind = 'late' | 'early' | 'late_early' | 'absent' | 'leave';

export interface DeductionItem {
  id: string;
  date: string; // yyyy-MM-dd
  kind: DeductionKind;
  amount: number;
  days?: number | null;
  late_minutes?: number;
  early_minutes?: number;
  reason?: string | null;
  waived: boolean;
  waive_reason?: string | null;
  /** Today's late fine before check-out; the final amount is saved at check-out. */
  provisional?: boolean;
}

export interface MyDeductions {
  month: string;
  daily_rate: number;
  total: number;
  items: DeductionItem[];
}

/** The signed-in staff member's deductions for a month (same numbers the salary settlement uses). */
export async function fetchMyDeductions(month: string): Promise<MyDeductions> {
  const { data, error } = await supabase.rpc('get_my_deductions' as never, { _month: month } as never);
  if (error) throw error;
  const d = data as unknown as MyDeductions;
  return {
    ...d,
    daily_rate: Number(d.daily_rate) || 0,
    total: Number(d.total) || 0,
    items: (d.items ?? []).map((i) => ({ ...i, amount: Number(i.amount) || 0 })),
  };
}

/**
 * Today's late check-in fine while the shift is still running. Late fines are saved at check-out,
 * so without this a late check-in would only show up at the end of the day.
 */
export async function fetchTodayLateFine(
  staffId: string,
  today: string,
  dailyRate: number,
): Promise<DeductionItem | null> {
  const { data: session } = await supabase
    .from('attendance_sessions')
    .select('id, check_in_at')
    .eq('staff_id', staffId)
    .eq('work_date', today)
    .order('check_in_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!session?.check_in_at) return null;

  const [rules, assignment] = await Promise.all([fetchDisciplineRules(), fetchStaffAssignment(staffId)]);
  if (!rules || rules.penalties_enabled === false || !assignment) return null;
  let start = assignment.override_check_in;
  if (!start && assignment.shift_id) {
    const { data: shift } = await supabase
      .from('shifts' as never)
      .select('check_in_time')
      .eq('id', assignment.shift_id)
      .maybeSingle();
    start = (shift as { check_in_time: string } | null)?.check_in_time ?? null;
  }
  if (!start) return null;

  const { minutes, amount } = lateFine(session.check_in_at, start, today, rules, dailyRate);
  if (amount <= 0) return null;
  return {
    id: `today-${session.id}`,
    date: today,
    kind: 'late',
    amount: Math.round(amount * 100) / 100,
    late_minutes: minutes,
    waived: false,
    provisional: true,
  };
}

/** Owner/admin: change how many days of salary an absence cuts (e.g. 2 → 1). */
export async function adjustAbsenceDeduction(logId: string, days: number, reason: string) {
  const { data, error } = await supabase.rpc(
    'adjust_absence_deduction' as never,
    { _log_id: logId, _days: days, _reason: reason } as never,
  );
  if (error) throw error;
  return data as unknown as { deduction_days: number; fine_amount: number };
}

/** Owner/admin: record that the person was on approved leave that day (no salary cut). */
export async function markDayAsLeave(params: {
  staffId: string;
  date: string;
  paid: boolean;
  remarks: string;
  userId: string | null;
}) {
  const approval = {
    leave_type: params.paid ? ('paid' as const) : ('unpaid' as const),
    deduction_days: params.paid ? 0 : 1,
    status: 'approved' as const,
    remarks: params.remarks || undefined,
    approved_by: params.userId ?? undefined,
    approved_at: new Date().toISOString(),
  };
  const { data: existing, error: findError } = await supabase
    .from('leave_records')
    .select('id, status')
    .eq('staff_id', params.staffId)
    .eq('leave_date', params.date)
    .maybeSingle();
  if (findError) throw findError;
  if (existing?.status === 'approved') throw new Error('A leave is already approved for this day.');

  // A leave request the person already sent for that day is approved instead of duplicated.
  const { error } = existing
    ? await supabase.from('leave_records').update(approval).eq('id', existing.id)
    : await supabase.from('leave_records').insert([
        { ...approval, staff_id: params.staffId, leave_date: params.date, created_by: params.userId ?? undefined },
      ]);
  if (error) throw error;
}
