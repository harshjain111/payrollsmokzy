import { describe, it, expect, vi } from 'vitest';
import { scheduleForDate } from './discipline';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

const evening = {
  check_in_time: '16:00:00',
  check_out_time: '23:00:00',
  weekend_check_out_time: '00:00:00',
  weekend_days: [0, 6],
};
const noOverride = { override_check_in: null, override_check_out: null };

describe('scheduleForDate', () => {
  it('ends at 11 PM on weekdays and 12 AM on Saturday and Sunday', () => {
    expect(scheduleForDate(noOverride, evening, '2026-10-23')).toEqual({ checkIn: '16:00:00', checkOut: '23:00:00' }); // Fri
    expect(scheduleForDate(noOverride, evening, '2026-10-24')).toEqual({ checkIn: '16:00:00', checkOut: '00:00:00' }); // Sat
    expect(scheduleForDate(noOverride, evening, '2026-10-25')).toEqual({ checkIn: '16:00:00', checkOut: '00:00:00' }); // Sun
    expect(scheduleForDate(noOverride, evening, '2026-10-26')).toEqual({ checkIn: '16:00:00', checkOut: '23:00:00' }); // Mon
  });

  it('uses the same end time every day when the shift has no weekend time', () => {
    const plain = { ...evening, weekend_check_out_time: null };
    expect(scheduleForDate(noOverride, plain, '2026-10-24').checkOut).toBe('23:00:00');
  });

  it("a person's override wins over the shift", () => {
    const a = { override_check_in: '17:00:00', override_check_out: '22:00:00' };
    expect(scheduleForDate(a, evening, '2026-10-24')).toEqual({ checkIn: '17:00:00', checkOut: '22:00:00' });
  });
});
