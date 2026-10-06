import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AttendanceSession,
  getCurrentSession,
  getRecentCompletedSession,
} from '@/lib/attendance';

/** Minimum gap between quiet refreshes triggered by the app coming back to the foreground. */
const WAKE_REFRESH_THROTTLE_MS = 30_000;

export function useCurrentAttendanceSession(userId: string | undefined) {
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [recentCompleted, setRecentCompleted] = useState<AttendanceSession | null>(null);
  // Only true until the first load finishes; later refreshes run quietly so the card
  // does not flash "Loading…" after a break, check-in or app resume.
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedOnce = useRef(false);
  const lastLoadAt = useRef(0);
  const requestSeq = useRef(0);

  useEffect(() => {
    loadedOnce.current = false;
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    const req = ++requestSeq.current;
    lastLoadAt.current = Date.now();
    if (!loadedOnce.current) setIsLoading(true);
    try {
      const [open, done] = await Promise.all([
        getCurrentSession(userId),
        getRecentCompletedSession(userId),
      ]);
      if (req !== requestSeq.current) return; // a newer refresh superseded this one
      setSession(open);
      setRecentCompleted(done);
      setError(null);
      loadedOnce.current = true;
    } catch (e) {
      if (req !== requestSeq.current) return;
      console.error('Attendance session load error', e);
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (req === requestSeq.current) setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A PWA resumed the next morning must not show yesterday's timer: refresh quietly when
  // the app becomes visible / focused again (throttled, no loading flag).
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadAt.current < WAKE_REFRESH_THROTTLE_MS) return;
      refresh();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [refresh]);

  return { session, recentCompleted, isLoading, error, refresh };
}
