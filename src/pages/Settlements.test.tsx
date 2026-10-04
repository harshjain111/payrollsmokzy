import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Settlements from './Settlements';
import type { PayrollRow } from '@/lib/payroll';

const mocks = vi.hoisted(() => ({
  fetchPayrollMonth: vi.fn(),
  fetchPayrollStaff: vi.fn(),
  settleSalary: vi.fn(),
  undoSettlement: vi.fn(),
  auth: { canAccessSettlements: true, isOwner: false },
}));

vi.mock('@/lib/payroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payroll')>();
  return {
    ...actual,
    fetchPayrollMonth: mocks.fetchPayrollMonth,
    fetchPayrollStaff: mocks.fetchPayrollStaff,
    settleSalary: mocks.settleSalary,
    undoSettlement: mocks.undoSettlement,
  };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base = {
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
const row = (over: Partial<PayrollRow>): PayrollRow => ({
  ...base,
  staff_id: 's1',
  full_name: 'Asha',
  employee_id: 'E1',
  is_active: true,
  date_of_joining: '2025-01-01',
  estimated_net: 27800,
  settlement_id: null,
  settled_at: null,
  settled_net_salary: null,
  settled_balance_payable: null,
  is_paid: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.canAccessSettlements = true;
  mocks.fetchPayrollMonth.mockResolvedValue([
    row({}),
    row({ staff_id: 's2', full_name: 'Bilal', employee_id: 'E2', settlement_id: 'set-2', settled_balance_payable: 20000, advance_outstanding: 0 }),
  ]);
  mocks.fetchPayrollStaff.mockResolvedValue(base);
  mocks.settleSalary.mockResolvedValue({ settlement_id: 'new', net_payable: 25500, payout_request_id: 'p' });
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/settlements?month=2026-09']}>
      <Settlements />
    </MemoryRouter>,
  );

describe('Settlements page', () => {
  it('shows the month overview with status and totals', async () => {
    renderPage();
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(mocks.fetchPayrollMonth).toHaveBeenCalledWith('2026-09');
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('To settle')).toBeInTheDocument();
    expect(screen.getByText('Settled · to pay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settle salary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View settlement' })).toBeInTheDocument();
  });

  it('settles with bonus, deduction and advance recovery after confirmation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Settle salary' }));

    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText('Bonus / incentive / overtime'), { target: { value: '1000' } });
    fireEvent.change(within(sheet).getByPlaceholderText('What is it for? (required)'), { target: { value: 'Festival' } });
    fireEvent.change(within(sheet).getByLabelText('Other deduction'), { target: { value: '300' } });
    fireEvent.change(within(sheet).getByPlaceholderText('e.g. damage, uniform (required)'), { target: { value: 'Glass' } });
    fireEvent.change(within(sheet).getByLabelText('Recover from advance'), { target: { value: '3000' } });

    expect(within(sheet).getByText('₹25,500')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Review & settle' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Settle salary' }));

    await waitFor(() => expect(mocks.settleSalary).toHaveBeenCalled());
    expect(mocks.settleSalary).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: 's1',
        month: '2026-09',
        leaveDays: 2,
        bonus: 1000,
        bonusNote: 'Festival',
        otherDeduction: 300,
        otherDeductionNote: 'Glass',
        advanceRecovery: 3000,
        lastWorkingDate: null,
        paymentMode: 'cash',
      }),
    );
    await waitFor(() => expect(mocks.fetchPayrollMonth).toHaveBeenCalledTimes(2));
  });

  it('will not settle while a required reason is missing', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Settle salary' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText('Unpaid leave days'), { target: { value: '0' } });
    expect(within(sheet).getByText('Give a reason for changing the leave days.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Review & settle' })).toBeDisabled();
  });

  it('blocks roles without settlement access', () => {
    mocks.auth.canAccessSettlements = false;
    renderPage();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(mocks.fetchPayrollMonth).not.toHaveBeenCalled();
  });
});
