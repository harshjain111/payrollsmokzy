import { differenceInCalendarDays, endOfMonth, format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

/**
 * Payroll helpers for the Settlements page.
 *
 * The database (get_payroll_month / get_payroll_staff / settle_salary in
 * supabase/migrations/20261004100000_payroll_settlement_v2.sql) is the source of truth and
 * recomputes every amount when settling. computeSettlement mirrors that arithmetic so the
 * form can show the exact result before the owner/admin confirms.
 */

export type PayoutMode = 'cash' | 'upi' | 'bank_transfer' | 'cheque';

export const PAYOUT_MODES: { value: PayoutMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

/** System numbers for one staff member and month (payroll_base). */
export interface PayrollBase {
  monthly_salary: number;
  days_in_month: number;
  period_start: string;
  period_end: string;
  payable_days: number;
  daily_rate: number;
  base_pay: number;
  system_leave_days: number;
  discipline_fine: number;
  advance_outstanding: number;
}

/** One row of the month overview. */
export interface PayrollRow extends PayrollBase {
  staff_id: string;
  full_name: string;
  employee_id: string;
  is_active: boolean;
  date_of_joining: string;
  estimated_net: number;
  settlement_id: string | null;
  settled_at: string | null;
  settled_net_salary: number | null;
  settled_balance_payable: number | null;
  is_paid: boolean;
}

export type PayrollStatus = 'pending' | 'awaiting_payment' | 'paid' | 'nothing_to_pay';

export function payrollStatus(row: PayrollRow): PayrollStatus {
  if (!row.settlement_id) return 'pending';
  if (Number(row.settled_balance_payable) === 0) return 'nothing_to_pay';
  return row.is_paid ? 'paid' : 'awaiting_payment';
}

export interface SettleInputs {
  leaveDays: number;
  leaveReason: string;
  bonus: number;
  bonusNote: string;
  otherDeduction: number;
  otherDeductionNote: string;
  advanceRecovery: number;
}

export interface SettlementResult {
  payableDays: number;
  basePay: number;
  leaveDeduction: number;
  fine: number;
  bonus: number;
  otherDeduction: number;
  earnings: number;
  gross: number;
  advanceRecovery: number;
  net: number;
  advanceLeft: number;
  /** Largest advance recovery allowed right now. */
  maxRecovery: number;
  errors: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: unknown) => Number(n) || 0;

/** Same rules and rounding as settle_salary. */
export function computeSettlement(base: PayrollBase, input: SettleInputs): SettlementResult {
  const daily = num(base.daily_rate);
  const basePay = num(base.base_pay);
  const fine = num(base.discipline_fine);
  const outstanding = num(base.advance_outstanding);
  const leaveDays = num(input.leaveDays);
  const bonus = num(input.bonus);
  const otherDeduction = num(input.otherDeduction);
  const advanceRecovery = num(input.advanceRecovery);

  const leaveDeduction = round2(daily * leaveDays);
  const earnings = round2(basePay + bonus);
  const gross = round2(earnings - leaveDeduction - fine - otherDeduction);
  const maxRecovery = Math.max(0, Math.min(outstanding, gross));
  const net = round2(gross - advanceRecovery);

  const errors: string[] = [];
  if (leaveDays < 0 || leaveDays > base.payable_days) {
    errors.push(`Leave days must be between 0 and ${base.payable_days}.`);
  }
  if (leaveDays !== num(base.system_leave_days) && !input.leaveReason.trim()) {
    errors.push('Give a reason for changing the leave days.');
  }
  if (bonus < 0 || otherDeduction < 0 || advanceRecovery < 0) {
    errors.push('Amounts cannot be negative.');
  }
  if (bonus > 0 && !input.bonusNote.trim()) errors.push('Add a note for the bonus / incentive.');
  if (otherDeduction > 0 && !input.otherDeductionNote.trim()) {
    errors.push('Add a note for the other deduction.');
  }
  if (gross < 0) errors.push('Deductions are more than the salary earned.');
  if (advanceRecovery > outstanding) errors.push('Advance recovery is more than the advance outstanding.');
  else if (gross >= 0 && advanceRecovery > gross) {
    errors.push('Advance recovery is more than the salary payable.');
  }

  return {
    payableDays: base.payable_days,
    basePay,
    leaveDeduction,
    fine,
    bonus,
    otherDeduction,
    earnings,
    gross,
    advanceRecovery,
    net,
    advanceLeft: round2(outstanding - advanceRecovery),
    maxRecovery: round2(maxRecovery),
    errors,
  };
}

export const monthEndOf = (month: string) =>
  format(endOfMonth(parseISO(month + '-01')), 'yyyy-MM-dd');

export const daysBetweenInclusive = (from: string, to: string) =>
  differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;

const toNumbers = <T extends object>(row: T): T => {
  const out = { ...row } as Record<string, unknown>;
  for (const k of [
    'monthly_salary', 'daily_rate', 'base_pay', 'system_leave_days', 'discipline_fine',
    'advance_outstanding', 'estimated_net', 'settled_net_salary', 'settled_balance_payable',
  ]) {
    if (k in out && out[k] !== null) out[k] = Number(out[k]);
  }
  return out as T;
};

export async function fetchPayrollMonth(month: string): Promise<PayrollRow[]> {
  const { data, error } = await supabase.rpc('get_payroll_month' as never, { _month: month } as never);
  if (error) throw error;
  return ((data as PayrollRow[]) ?? []).map(toNumbers);
}

export async function fetchPayrollStaff(
  staffId: string,
  month: string,
  lastWorkingDate: string | null,
): Promise<PayrollBase> {
  const { data, error } = await supabase.rpc(
    'get_payroll_staff' as never,
    { _staff_id: staffId, _month: month, _last_working_date: lastWorkingDate } as never,
  );
  if (error) throw error;
  const row = (data as PayrollBase[] | null)?.[0];
  if (!row) throw new Error('No payroll data for this staff member');
  return toNumbers(row);
}

export interface SettleRequest extends SettleInputs {
  staffId: string;
  month: string;
  lastWorkingDate: string | null;
  paymentMode: PayoutMode;
  notes: string;
}

export async function settleSalary(req: SettleRequest) {
  const { data, error } = await supabase.rpc(
    'settle_salary' as never,
    {
      _staff_id: req.staffId,
      _month: req.month,
      _leave_days: req.leaveDays,
      _leave_reason: req.leaveReason || null,
      _advance_recovery: req.advanceRecovery,
      _bonus: req.bonus,
      _bonus_note: req.bonusNote || null,
      _other_deduction: req.otherDeduction,
      _other_deduction_note: req.otherDeductionNote || null,
      _last_working_date: req.lastWorkingDate,
      _payment_mode: req.paymentMode,
      _notes: req.notes || null,
    } as never,
  );
  if (error) throw error;
  return data as { settlement_id: string; net_payable: number; payout_request_id: string | null };
}

export async function undoSettlement(settlementId: string, reason: string) {
  const { error } = await supabase.rpc(
    'undo_salary_settlement' as never,
    { _settlement_id: settlementId, _reason: reason } as never,
  );
  if (error) throw error;
}
