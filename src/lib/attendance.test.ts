import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const upload = vi.fn();
  const single = vi.fn();
  const insert = vi.fn();
  const maybeSingle = vi.fn();
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  return { calls, upload, single, insert, maybeSingle, chain };
});

vi.mock('@/integrations/supabase/client', () => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    gte: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: mocks.maybeSingle,
  };
  mocks.chain.eq = query.eq;
  mocks.chain.gte = query.gte;
  mocks.chain.order = query.order;
  return {
    supabase: {
      storage: { from: () => ({ upload: mocks.upload }) },
      from: () => ({
        insert: (row: unknown) => {
          mocks.calls.push('insert');
          mocks.insert(row);
          return { select: () => ({ single: mocks.single }) };
        },
        select: query.select,
      }),
    },
  };
});
vi.mock('@/lib/discipline', () => ({ computeAndLogDiscipline: vi.fn() }));
vi.mock('@/lib/attendance-whatsapp', () => ({
  notifyCheckinWhatsapp: vi.fn(),
  notifyCheckoutWhatsapp: vi.fn(),
}));

import {
  AlreadyCheckedInError,
  attendanceErrorMessage,
  cameraErrorMessage,
  checkIn,
  formatSessionStatus,
  formatSessionTime,
  formatTime,
  getRecentCompletedSession,
  locationErrorMessage,
} from './attendance';

const payload = { photoBlob: new Blob(['x']), lat: 1, lng: 2, accuracy: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.upload.mockImplementation(async () => {
    mocks.calls.push('upload');
    return { error: null };
  });
});

describe('checkIn', () => {
  it('uploads the selfie first, then inserts one row with the real photo path', async () => {
    mocks.single.mockResolvedValue({ data: { id: 'x', staff_id: null }, error: null });
    await checkIn('user-1', null, payload);

    expect(mocks.calls).toEqual(['upload', 'insert']);
    const path = mocks.upload.mock.calls[0][0] as string;
    // Storage policy only requires the first folder to be the user's id.
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\/checkin-\d+\.jpg$/);
    const row = mocks.insert.mock.calls[0][0] as { id: string; check_in_photo_url: string };
    expect(row.check_in_photo_url).toBe(path);
    expect(path.split('/')[1]).toBe(row.id);
  });

  it('does not create a session when the upload fails', async () => {
    mocks.upload.mockResolvedValue({ error: new Error('network') });
    await expect(checkIn('user-1', null, payload)).rejects.toThrow('Photo could not be saved');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('maps the one-open-session unique violation to AlreadyCheckedInError', async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    await expect(checkIn('user-1', null, payload)).rejects.toBeInstanceOf(AlreadyCheckedInError);
  });

  it('does not upload or insert again when a shift is already open', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'existing', status: 'active' }, error: null });
    await expect(checkIn('user-1', null, payload)).rejects.toBeInstanceOf(AlreadyCheckedInError);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('uses insert-only photo uploads and exposes plain-object save errors', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: '42501', message: 'Permission denied' } });
    await expect(checkIn('user-1', null, payload)).rejects.toThrow('Check-in could not be saved. Permission denied');
    expect(mocks.upload.mock.calls[0][2]).toMatchObject({ upsert: false });
  });
});

describe('attendance error messages', () => {
  it('preserves plain-object messages rather than hiding them', () => {
    expect(attendanceErrorMessage({ message: 'Permission denied' })).toBe('Permission denied');
    expect(attendanceErrorMessage({ message: 'JWT expired' })).toMatch(/Sign in again/);
    expect(attendanceErrorMessage(new TypeError('Failed to fetch'))).toMatch(/connection was interrupted/);
  });
});

describe('getRecentCompletedSession', () => {
  it('looks back by check-out time, not by work date', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const before = Date.now();
    await getRecentCompletedSession('user-1');
    expect(mocks.chain.eq).toHaveBeenCalledWith('status', 'completed');
    expect(mocks.chain.eq).not.toHaveBeenCalledWith('work_date', expect.anything());
    const [col, since] = mocks.chain.gte.mock.calls[0] as [string, string];
    expect(col).toBe('check_out_at');
    const hours = (before - Date.parse(since)) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThan(12.1);
  });
});

describe('formatting', () => {
  it('formats times as "9:05 AM" and adds the date for after-midnight check-outs', () => {
    expect(formatTime(new Date('2026-05-19T09:05').toISOString())).toBe('9:05 AM');
    expect(formatTime(null)).toBe('—');
    expect(formatSessionTime(new Date('2026-05-20T02:00').toISOString(), '2026-05-19')).toBe(
      '2:00 AM, 20 May',
    );
  });

  it('humanises statuses', () => {
    expect(formatSessionStatus('on_break')).toBe('On break');
    expect(formatSessionStatus('active')).toBe('On shift');
  });

  it('gives plain guidance for camera and location errors', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toMatch(/permission is blocked/);
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toMatch(/another app/);
    expect(locationErrorMessage(1)).toMatch(/allow Location/);
    expect(locationErrorMessage(3)).toMatch(/took too long/);
  });
});
