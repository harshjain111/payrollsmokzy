import { describe, it, expect } from 'vitest';
import { computeSettlement, payrollStatus, PayrollBase, PayrollRow, SettleInputs } from './payroll';

// Same scenarios as the database test of settle_salary, so the form and the server agree.
const fullMonth: PayrollBase = {
  monthly_salary: 30000,
  days_in_month: 30,
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  payable_days: 30,
  daily_rate: 1000,
  base_pay: 30000,
  system_leave_days: 2,
  discipline_fine: 200,
  advance_outstanding: 5000,
};

const inputs = (over: Partial<SettleInputs> = {}): SettleInputs => ({
  leaveDays: 2,
  leaveReason: '',
  bonus: 0,
  bonusNote: '',
  otherDeduction: 0,
  otherDeductionNote: '',
  advanceRecovery: 0,
  ...over,
});

describe('computeSettlement', () => {
  it('handles leave, fine, bonus, other deduction and advance recovery together', () => {
    const r = computeSettlement(
      fullMonth,
      inputs({ bonus: 1000, bonusNote: 'Festival', otherDeduction: 300, otherDeductionNote: 'Glass', advanceRecovery: 3000 }),
    );
    expect(r.leaveDeduction).toBe(2000);
    expect(r.gross).toBe(28500);
    expect(r.net).toBe(25500);
    expect(r.advanceLeft).toBe(2000);
    expect(r.errors).toEqual([]);
  });

  it('pays a mid-month joiner only for the days worked', () => {
    const joiner = { ...fullMonth, period_start: '2026-09-11', payable_days: 20, base_pay: 20000, system_leave_days: 0, discipline_fine: 0, advance_outstanding: 0 };
    expect(computeSettlement(joiner, inputs({ leaveDays: 0 })).net).toBe(20000);
  });

  it('caps advance recovery at what is payable and allows a zero payout', () => {
    const big = { ...fullMonth, system_leave_days: 0, discipline_fine: 0, advance_outstanding: 40000 };
    const r = computeSettlement(big, inputs({ leaveDays: 0, advanceRecovery: 30000 }));
    expect(r.maxRecovery).toBe(30000);
    expect(r.net).toBe(0);
    expect(r.errors).toEqual([]);
    expect(computeSettlement(big, inputs({ leaveDays: 0, advanceRecovery: 30001 })).errors).toContain(
      'Advance recovery is more than the salary payable.',
    );
  });

  it('requires reasons and notes, and blocks impossible amounts', () => {
    expect(computeSettlement(fullMonth, inputs({ leaveDays: 1 })).errors).toContain(
      'Give a reason for changing the leave days.',
    );
    expect(computeSettlement(fullMonth, inputs({ leaveDays: 1, leaveReason: 'Paid leave' })).errors).toEqual([]);
    expect(computeSettlement(fullMonth, inputs({ bonus: 500 })).errors).toContain('Add a note for the bonus / incentive.');
    expect(computeSettlement(fullMonth, inputs({ otherDeduction: 500 })).errors).toContain(
      'Add a note for the other deduction.',
    );
    expect(computeSettlement(fullMonth, inputs({ advanceRecovery: 6000 })).errors).toContain(
      'Advance recovery is more than the advance outstanding.',
    );
    expect(
      computeSettlement(fullMonth, inputs({ otherDeduction: 50000, otherDeductionNote: 'x' })).errors,
    ).toContain('Deductions are more than the salary earned.');
    expect(computeSettlement(fullMonth, inputs({ leaveDays: 31, leaveReason: 'x' })).errors).toContain(
      'Leave days must be between 0 and 30.',
    );
  });

  it('rounds like the database (2 decimals)', () => {
    const odd = { ...fullMonth, monthly_salary: 31000, days_in_month: 31, daily_rate: 1000, base_pay: 31000, payable_days: 31, system_leave_days: 0.5, discipline_fine: 0, advance_outstanding: 0 };
    const r = computeSettlement({ ...odd, daily_rate: 25000 / 31, base_pay: 25000 }, inputs({ leaveDays: 0.5 }));
    expect(r.leaveDeduction).toBe(403.23);
    expect(r.net).toBe(24596.77);
  });
});

describe('payrollStatus', () => {
  const row = (over: Partial<PayrollRow>) => ({ ...fullMonth, staff_id: 's', full_name: 'A', employee_id: 'E', is_active: true, date_of_joining: '2025-01-01', estimated_net: 0, settlement_id: null, settled_at: null, settled_net_salary: null, settled_balance_payable: null, is_paid: false, ...over }) as PayrollRow;
  it('labels each stage', () => {
    expect(payrollStatus(row({}))).toBe('pending');
    expect(payrollStatus(row({ settlement_id: 'x', settled_balance_payable: 100 }))).toBe('awaiting_payment');
    expect(payrollStatus(row({ settlement_id: 'x', settled_balance_payable: 100, is_paid: true }))).toBe('paid');
    expect(payrollStatus(row({ settlement_id: 'x', settled_balance_payable: 0, is_paid: true }))).toBe('nothing_to_pay');
  });
});
