import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { format } from 'date-fns';
import { DayPenaltiesView } from './DayPenaltiesView';

const today = format(new Date(), 'yyyy-MM-dd');

const mocks = vi.hoisted(() => {
  const updateEq = vi.fn();
  const update = vi.fn();
  const logEq = vi.fn();
  const staffIn = vi.fn();
  const rpc = vi.fn();
  const invoke = vi.fn();
  return { updateEq, update, logEq, staffIn, rpc, invoke };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'attendance_discipline_log') {
        return { select: () => ({ eq: mocks.logEq }), update: mocks.update };
      }
      return { select: () => ({ in: mocks.staffIn }) };
    },
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-user', email: 'owner@x' }, staffData: { full_name: 'Owner' } }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const logRow = (overrides: Record<string, unknown>) => ({
  session_id: null,
  work_date: today,
  scheduled_check_in: '10:00:00',
  scheduled_check_out: '19:00:00',
  late_in_minutes: 0,
  early_out_minutes: 0,
  is_absent: false,
  absent_reason: null,
  computed_at: today,
  is_cancelled: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.logEq.mockResolvedValue({
    data: [
      logRow({ id: 'p1', staff_id: 's1', fine_amount: 100, fine_reason: 'Late by 25m' }),
      logRow({
        id: 'p2',
        staff_id: 's2',
        fine_amount: 50,
        fine_reason: 'Early out by 15m',
        is_cancelled: true,
        cancelled_by_name: 'Owner',
        cancellation_reason: 'Doctor visit',
      }),
      // Zero-fine, not-absent rows are not penalties and must be hidden.
      logRow({ id: 'p3', staff_id: 's3', fine_amount: 0, fine_reason: 'On time' }),
    ],
    error: null,
  });
  const staff = [
    { id: 's1', full_name: 'Asha', phone: '919999999999' },
    { id: 's2', full_name: 'Bilal', phone: null },
    { id: 's3', full_name: 'Chetan', phone: null },
  ];
  mocks.staffIn.mockResolvedValue({ data: staff });
  mocks.rpc.mockResolvedValue({ data: staff });
  mocks.updateEq.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.updateEq });
  mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
});

describe('DayPenaltiesView', () => {
  it("loads today's penalties and shows cancel/restore for owners", async () => {
    render(<DayPenaltiesView canManage />);

    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('Bilal')).toBeInTheDocument();
    expect(screen.queryByText('Chetan')).not.toBeInTheDocument();
    expect(mocks.logEq).toHaveBeenCalledWith('work_date', today);
    expect(screen.getByText(/Waived by Owner — Doctor visit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel penalty/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
  });

  it('requires a reason, then cancels the penalty and notifies the staff member', async () => {
    render(<DayPenaltiesView canManage />);
    fireEvent.click(await screen.findByRole('button', { name: /Cancel penalty/ }));

    const confirm = await screen.findByRole('button', { name: 'Confirm cancellation' });
    fireEvent.click(confirm);
    expect(mocks.update).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/Traffic jam/), {
      target: { value: 'Approved by owner on call' },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.updateEq).toHaveBeenCalledWith('id', 'p1'));
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_cancelled: true,
        cancelled_by: 'owner-user',
        cancelled_by_name: 'Owner',
        cancellation_reason: 'Approved by owner on call',
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      'send-attendance-whatsapp',
      expect.objectContaining({
        body: expect.objectContaining({ event_type: 'penalty_waived', staff_phone: '919999999999' }),
      }),
    );
  });

  it('is read-only for HR and does not read phone numbers', async () => {
    render(<DayPenaltiesView canManage={false} />);

    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel penalty/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith('get_attendance_staff');
    expect(mocks.staffIn).not.toHaveBeenCalled();
  });
});
