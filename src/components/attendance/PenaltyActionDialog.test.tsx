import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PenaltyAction, PenaltyActionDialog, PenaltyRowActions, PenaltyTarget } from './PenaltyActionDialog';

const mocks = vi.hoisted(() => ({
  adjustAbsenceDeduction: vi.fn(),
  markDayAsLeave: vi.fn(),
  onDone: vi.fn(),
}));

vi.mock('@/lib/deductions', () => ({
  adjustAbsenceDeduction: mocks.adjustAbsenceDeduction,
  markDayAsLeave: mocks.markDayAsLeave,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-user' }, staffData: { full_name: 'Owner' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const absence: PenaltyTarget = {
  id: 'p1',
  session_id: null,
  staff_id: 's1',
  staff_name: 'Asha',
  work_date: '2026-10-20',
  scheduled_check_in: '10:00:00',
  scheduled_check_out: '19:00:00',
  late_in_minutes: 0,
  early_out_minutes: 0,
  fine_amount: 1000,
  fine_reason: 'Absent — no check-in',
  is_absent: true,
  absent_reason: 'no_checkin',
  deduction_days: 2,
  computed_at: '2026-10-20',
  is_cancelled: false,
};

function Harness({ row }: { row: PenaltyTarget }) {
  const [target, setTarget] = useState<PenaltyTarget | null>(null);
  const [mode, setMode] = useState<PenaltyAction>('cancel');
  return (
    <>
      <PenaltyRowActions row={row} onOpen={(r, a) => { setMode(a); setTarget(r); }} />
      <PenaltyActionDialog target={target} mode={mode} onClose={() => setTarget(null)} onDone={mocks.onDone} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adjustAbsenceDeduction.mockResolvedValue({ deduction_days: 1, fine_amount: 500 });
  mocks.markDayAsLeave.mockResolvedValue(undefined);
});

describe('Penalty actions', () => {
  it('only absences get the leave and change-cut actions', () => {
    const { rerender } = render(<Harness row={absence} />);
    expect(screen.getByRole('button', { name: /On leave/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change cut/ })).toBeInTheDocument();
    rerender(<Harness row={{ ...absence, id: 'p2', is_absent: false, absent_reason: null }} />);
    expect(screen.queryByRole('button', { name: /On leave/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Waive penalty/ })).toBeInTheDocument();
  });

  it('changes a 2-day absence cut to 1 day with a reason', async () => {
    render(<Harness row={absence} />);
    fireEvent.click(screen.getByRole('button', { name: /Change cut/ }));
    expect(screen.getByRole('radio', { name: '1' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Cut 1 day' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Informed late' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cut 1 day' }));
    await waitFor(() => expect(mocks.adjustAbsenceDeduction).toHaveBeenCalledWith('p1', 1, 'Informed late'));
    expect(mocks.onDone).toHaveBeenCalled();
  });

  it('marks a past absence as paid leave', async () => {
    render(<Harness row={absence} />);
    fireEvent.click(screen.getByRole('button', { name: /On leave/ }));
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Asked on phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark on leave' }));
    await waitFor(() =>
      expect(mocks.markDayAsLeave).toHaveBeenCalledWith({
        staffId: 's1',
        date: '2026-10-20',
        paid: true,
        remarks: 'Asked on phone',
        userId: 'owner-user',
      }),
    );
  });
});
