import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditAttendanceDialog } from './EditAttendanceDialog';
import type { AttendanceSession } from '@/lib/attendance';

const mocks = vi.hoisted(() => ({
  saveAttendanceRecord: vi.fn(),
  recomputeDisciplineForSession: vi.fn(),
}));

vi.mock('@/lib/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/attendance')>();
  return { ...actual, ...mocks };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const session = {
  id: 'sess-1',
  user_id: 'user-1',
  staff_id: 'staff-1',
  work_date: '2026-09-15',
  check_in_at: new Date('2026-09-15T10:05').toISOString(),
  check_out_at: null,
  total_break_minutes: 0,
  status: 'active',
} as unknown as AttendanceSession;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveAttendanceRecord.mockResolvedValue('sess-1');
  mocks.recomputeDisciplineForSession.mockResolvedValue(undefined);
});

describe('EditAttendanceDialog', () => {
  it('fixes a forgotten check-out, requires a reason, and recalculates the penalty', async () => {
    const onSaved = vi.fn();
    render(
      <EditAttendanceDialog
        target={{ staffId: 'staff-1', staffName: 'Ravi', workDate: '2026-09-15', session }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-09-15T19:00' } });
    fireEvent.change(screen.getByLabelText('Break (minutes)'), { target: { value: '45' } });
    expect(screen.getByText('8h 10m')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Forgot to check out' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.saveAttendanceRecord).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      staffId: 'staff-1',
      workDate: '2026-09-15',
      checkInIso: new Date('2026-09-15T10:05').toISOString(),
      checkOutIso: new Date('2026-09-15T19:00').toISOString(),
      breakMinutes: 45,
      reason: 'Forgot to check out',
    });
    expect(mocks.recomputeDisciplineForSession).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-1', sessionId: 'sess-1', workDate: '2026-09-15' }),
    );
  });

  it('adds a missed day with default times and blocks impossible ones', async () => {
    render(
      <EditAttendanceDialog
        target={{ staffId: 'staff-1', staffName: 'Ravi', workDate: '2026-09-16', session: null }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText('Add attendance', { selector: 'h2' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Phone broken' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-09-16T09:00' } });
    expect(screen.getByText('Check-out must be after check-in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add attendance' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-09-16T18:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add attendance' }));
    await waitFor(() => expect(mocks.saveAttendanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null, workDate: '2026-09-16', reason: 'Phone broken' }),
    ));
  });

  it('does not show validation errors until something is edited', () => {
    render(
      <EditAttendanceDialog
        target={{ staffId: 'staff-1', staffName: 'Ravi', workDate: '2026-09-15', session }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByText('Give a reason for the change.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Break (minutes)'), { target: { value: '10' } });
    expect(screen.getByText('Give a reason for the change.')).toBeInTheDocument();
  });
});
