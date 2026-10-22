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
  paySalary: vi.fn(),
  auth: { canAccessSettlements: true, canRecordSalaryPayments: false },
}));

vi.mock('@/lib/payroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payroll')>();
  return {
    ...actual,
    fetchPayrollMonth: mocks.fetchPayrollMonth,
    fetchPayrollStaff: mocks.fetchPayrollStaff,
    settleSalary: mocks.settleSalary,
    undoSettlement: mocks.undoSettlement,
    paySalary: mocks.paySalary,
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
  mocks.auth.canRecordSalaryPayments = false;
  mocks.paySalary.mockResolvedValue({ journal_entry_id: 'j', amount: 25500, payment_request_id: 'p' });
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
  it('opens on "To settle" and shows each step with totals', async () => {
    renderPage();
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(mocks.fetchPayrollMonth).toHaveBeenCalledWith('2026-09');
    expect(screen.queryByText('Bilal')).not.toBeInTheDocument();
    expect(screen.getByText('To settle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settle salary' })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /All/ }));
    fireEvent.click(screen.getByRole('tab', { name: /All/ }));
    expect(await screen.findByText('Bilal')).toBeInTheDocument();
    expect(screen.getByText('Settled · to pay')).toBeInTheDocument();
    // Without payment rights the settled row can only be viewed.
    expect(screen.getByRole('button', { name: 'View settlement' })).toBeInTheDocument();
  });

  it('settles with bonus, deduction and advance recovery after confirmation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Settle salary' }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('₹27,800')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /Bonus \/ extra pay/ }));
    fireEvent.change(within(sheet).getByLabelText('Bonus / incentive / overtime'), { target: { value: '1000' } });
    fireEvent.change(within(sheet).getByPlaceholderText('What is it for? (required)'), { target: { value: 'Festival' } });
    fireEvent.click(within(sheet).getByRole('button', { name: /Other deduction/ }));
    fireEvent.change(within(sheet).getByLabelText('Other deduction'), { target: { value: '300' } });
    fireEvent.change(within(sheet).getByPlaceholderText('e.g. damage, uniform (required)'), { target: { value: 'Glass' } });
    fireEvent.click(within(sheet).getByRole('button', { name: /Recover advance/ }));
    fireEvent.change(within(sheet).getByLabelText('Recover from advance'), { target: { value: '3000' } });

    expect(within(sheet).getByText('₹25,500')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Settle ₹25,500' }));
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
    expect(mocks.paySalary).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.fetchPayrollMonth).toHaveBeenCalledTimes(2));
  });

  it('will not settle while a required reason is missing', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Settle salary' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Unpaid leave/ }));
    fireEvent.change(within(sheet).getByLabelText('Unpaid leave days'), { target: { value: '0' } });
    expect(within(sheet).getByText('Give a reason for changing the leave days.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Settle ₹/ })).toBeDisabled();
  });

  it('owner/admin can settle and pay in one step', async () => {
    mocks.auth.canRecordSalaryPayments = true;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Settle salary' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Settle & pay' }));
    fireEvent.click(await screen.findByRole('alertdialog').then((d) => within(d).getByRole('button', { name: 'Settle & pay' })));
    await waitFor(() => expect(mocks.paySalary).toHaveBeenCalledWith('new', 'cash'));
  });

  it('settles everyone selected in one go', async () => {
    mocks.fetchPayrollMonth.mockResolvedValue([
      row({}),
      row({ staff_id: 's3', full_name: 'Chetan', employee_id: 'E3', advance_outstanding: 0, system_leave_days: 0 }),
    ]);
    renderPage();
    await screen.findByText('Chetan');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select everyone to settle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle 2' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Settle all' }));
    await waitFor(() => expect(mocks.settleSalary).toHaveBeenCalledTimes(2));
    expect(mocks.settleSalary).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 's1', leaveDays: 2, bonus: 0, advanceRecovery: 0 }),
    );
    expect(mocks.settleSalary).toHaveBeenCalledWith(expect.objectContaining({ staffId: 's3', leaveDays: 0 }));
    expect(mocks.paySalary).not.toHaveBeenCalled();
  });

  it('pays a settled salary from its row', async () => {
    mocks.auth.canRecordSalaryPayments = true;
    mocks.fetchPayrollMonth.mockResolvedValue([
      row({ staff_id: 's2', full_name: 'Bilal', employee_id: 'E2', settlement_id: 'set-2', settled_balance_payable: 20000, advance_outstanding: 0 }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as paid' }));
    await waitFor(() => expect(mocks.paySalary).toHaveBeenCalledWith('set-2', 'cash'));
  });

  it('blocks roles without settlement access', () => {
    mocks.auth.canAccessSettlements = false;
    renderPage();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(mocks.fetchPayrollMonth).not.toHaveBeenCalled();
  });
});
