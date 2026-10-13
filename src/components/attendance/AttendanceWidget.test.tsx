import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttendanceWidget } from './AttendanceWidget';
import type { AttendanceSession } from '@/lib/attendance';

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getRecentCompletedSession: vi.fn(),
  getSessionBreaks: vi.fn(),
  startBreak: vi.fn(),
}));

vi.mock('@/lib/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/attendance')>();
  return { ...actual, ...mocks };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, staffData: { id: 'staff-1', attendance_tracked: true } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const active = {
  id: 'sess-1',
  user_id: 'user-1',
  staff_id: 'staff-1',
  work_date: '2026-09-15',
  check_in_at: new Date().toISOString(),
  check_out_at: null,
  total_break_minutes: 0,
  status: 'active',
} as unknown as AttendanceSession;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionBreaks.mockResolvedValue([]);
  mocks.getRecentCompletedSession.mockResolvedValue(null);
});

describe('AttendanceWidget', () => {
  it('keeps the active shift available when recent history fails', async () => {
    mocks.getCurrentSession.mockResolvedValue(active);
    mocks.getRecentCompletedSession.mockRejectedValue(new Error('history unavailable'));
    render(<AttendanceWidget />);
    expect(await screen.findByRole('button', { name: /Check Out/ })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your attendance")).not.toBeInTheDocument();
  });
  it('shows an error with Retry instead of Check In when loading fails', async () => {
    mocks.getCurrentSession.mockRejectedValueOnce(new Error('offline'));
    render(<AttendanceWidget />);

    expect(await screen.findByText("Couldn't load your attendance")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check In/ })).not.toBeInTheDocument();

    mocks.getCurrentSession.mockResolvedValue(null);
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByRole('button', { name: /Check In/ })).toBeInTheDocument();
  });

  it('does not flash "Loading…" when refreshing after a break starts', async () => {
    mocks.getCurrentSession.mockResolvedValue(active);
    mocks.startBreak.mockResolvedValue(undefined);
    render(<AttendanceWidget />);
    fireEvent.click(await screen.findByRole('button', { name: /Start Break/ }));

    expect(screen.queryByText('Loading attendance…')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.getCurrentSession).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Loading attendance…')).not.toBeInTheDocument();
  });

  it('refreshes quietly when the app comes back to the foreground', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.getCurrentSession.mockResolvedValue(active);
      render(<AttendanceWidget />);
      await screen.findByText('On shift');
      expect(mocks.getCurrentSession).toHaveBeenCalledTimes(1);

      // Within the throttle window: ignored.
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(mocks.getCurrentSession).toHaveBeenCalledTimes(1);

      // Next morning: yesterday's shift was auto-closed.
      mocks.getCurrentSession.mockResolvedValue(null);
      vi.advanceTimersByTime(60_000);
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(await screen.findByRole('button', { name: /Check In/ })).toBeInTheDocument();
      expect(screen.queryByText('Loading attendance…')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
