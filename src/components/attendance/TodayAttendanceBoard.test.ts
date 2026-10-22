import { describe, expect, it } from 'vitest';
import { groupOf, lateByMinutes, notInLateMinutes, type BoardPerson } from './TodayAttendanceBoard';
import type { AttendanceSession } from '@/lib/attendance';

const staff = { id: 's1', user_id: 'u1', employee_id: 'E1', full_name: 'Ravi', department: null, is_active: true, attendance_tracked: true };
const due = new Date('2026-10-19T14:00:00');
const session = (status: string, checkIn: string) =>
  ({ status, check_in_at: new Date(checkIn).toISOString() }) as unknown as AttendanceSession;
const person = (over: Partial<BoardPerson>): BoardPerson => ({ staff, session: null, due, onLeave: false, ...over });

describe('TodayAttendanceBoard grouping', () => {
  it('puts everyone without a check-in in one "not checked in" group, late only after shift start plus grace', () => {
    expect(groupOf(person({}), new Date('2026-10-19T14:05:00'), 10)).toBe('notin');
    expect(groupOf(person({}), new Date('2026-10-19T14:11:00'), 10)).toBe('notin');
    expect(notInLateMinutes(person({}), new Date('2026-10-19T14:05:00'), 10)).toBe(0);
    expect(notInLateMinutes(person({}), new Date('2026-10-19T14:45:00'), 10)).toBe(45);
    expect(notInLateMinutes(person({ due: null }), new Date('2026-10-19T23:00:00'), 10)).toBe(0);
    expect(groupOf(person({ onLeave: true }), new Date('2026-10-19T18:00:00'), 10)).toBe('leave');
    expect(notInLateMinutes(person({ onLeave: true }), new Date('2026-10-19T18:00:00'), 10)).toBe(0);
  });

  it('groups checked-in people by their session status', () => {
    const now = new Date('2026-10-19T16:00:00');
    expect(groupOf(person({ session: session('active', '2026-10-19T14:02:00') }), now, 10)).toBe('working');
    expect(groupOf(person({ session: session('on_break', '2026-10-19T14:02:00') }), now, 10)).toBe('break');
    expect(groupOf(person({ session: session('completed', '2026-10-19T14:02:00') }), now, 10)).toBe('done');
  });

  it('flags late arrivals beyond the grace period only', () => {
    expect(lateByMinutes(person({ session: session('active', '2026-10-19T14:08:00') }), 10)).toBe(0);
    expect(lateByMinutes(person({ session: session('active', '2026-10-19T14:35:00') }), 10)).toBe(35);
    expect(lateByMinutes(person({ session: session('active', '2026-10-19T14:35:00'), due: null }), 10)).toBe(0);
  });
});
