import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Coffee,
  Loader2,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentAttendanceSession } from '@/hooks/useCurrentAttendanceSession';
import { CaptureDialog } from './CaptureDialog';
import {
  AlreadyCheckedInError,
  CapturePayload,
  checkIn,
  checkOut,
  endBreak,
  formatMinutes,
  formatTime,
  getSessionBreaks,
  startBreak,
} from '@/lib/attendance';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

function useTick(intervalMs = 1000): number {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}

function formatElapsed(fromIso: string, now: number): string {
  const ms = now - new Date(fromIso).getTime();
  if (ms < 0) return '0:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function AttendanceWidget() {
  const { user, staffData } = useAuth();
  const { session, recentCompleted, isLoading, error, refresh } = useCurrentAttendanceSession(user?.id);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showCheckOut, setShowCheckOut] = useState(false);
  const [breakLoading, setBreakLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [activeBreakStart, setActiveBreakStart] = useState<string | null>(null);
  const tick = useTick(1000);

  // When status is on_break, fetch the open break to show timer
  useEffect(() => {
    let cancelled = false;
    async function loadBreak() {
      if (session?.status === 'on_break') {
        try {
          const breaks = await getSessionBreaks(session.id);
          const open = breaks.find((b) => !b.end_at);
          if (!cancelled) setActiveBreakStart(open?.start_at ?? null);
        } catch (e) {
          console.error('Break load error', e);
        }
      } else {
        setActiveBreakStart(null);
      }
    }
    loadBreak();
    return () => {
      cancelled = true;
    };
  }, [session?.id, session?.status]);

  const handleCheckIn = async (payload: CapturePayload) => {
    if (!user) return;
    try {
      await checkIn(user.id, staffData?.id ?? null, payload);
      toast.success('Checked in', { description: 'Have a great shift!' });
    } catch (e) {
      if (e instanceof AlreadyCheckedInError) {
        // Another tab/device already opened a shift; just show it.
        toast.info('You are already checked in');
        return;
      }
      throw e;
    } finally {
      // Always re-sync, so a failed attempt never leaves the card out of date.
      void refresh();
    }
  };

  const handleCheckOut = async (payload: CapturePayload) => {
    if (!user || !session) return;
    try {
      await checkOut(user.id, session, payload);
      toast.success('Checked out', { description: 'Session saved successfully.' });
    } finally {
      void refresh();
    }
  };

  const handleStartBreak = async () => {
    if (!session) return;
    setBreakLoading(true);
    try {
      await startBreak(session.id);
      toast.success('Break started');
    } catch (e) {
      toast.error('Failed', {
        description: e instanceof Error ? e.message : 'Could not start break',
      });
    } finally {
      await refresh();
      setBreakLoading(false);
    }
  };

  const handleEndBreak = async () => {
    if (!session) return;
    setBreakLoading(true);
    try {
      await endBreak(session.id);
      toast.success('Break ended');
    } catch (e) {
      toast.error('Failed', {
        description: e instanceof Error ? e.message : 'Could not end break',
      });
    } finally {
      await refresh();
      setBreakLoading(false);
    }
  };

  const retry = async () => {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  };

  // If staff is not tracked in attendance, hide the widget entirely
  const tracked = (staffData as unknown as { attendance_tracked?: boolean })?.attendance_tracked !== false;
  if (!tracked) return null;

  if (isLoading) {
    return (
      <Card className="rounded-2xl shadow-card border-0">
        <CardContent className="p-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading attendance…
        </CardContent>
      </Card>
    );
  }

  // ---- Could not load: never offer Check In blind (it may already be open) ----
  if (error && !session) {
    return (
      <Card className="rounded-2xl shadow-card border-0">
        <CardContent className="p-5">
          <div role="alert" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <h3 className="font-semibold">Couldn't load your attendance</h3>
                <p className="text-xs text-muted-foreground">
                  Check your internet connection, then tap Retry.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={retry} disabled={retrying} className="w-full sm:w-auto">
              {retrying ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- COMPLETED recently (incl. a night shift that ended after midnight), no active session ----
  if (!session && recentCompleted) {
    return (
      <Card className="rounded-2xl shadow-card border-0 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <h3 className="font-semibold">Shift completed</h3>
                <Badge variant="secondary" className="text-[10px]">
                  {format(parseISO(recentCompleted.work_date), 'dd MMM')}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">In</p>
                  <p className="font-medium">{formatTime(recentCompleted.check_in_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Out</p>
                  <p className="font-medium">{formatTime(recentCompleted.check_out_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Worked</p>
                  <p className="font-medium">{formatMinutes(recentCompleted.worked_minutes)}</p>
                </div>
              </div>
              {recentCompleted.total_break_minutes > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Break time: {formatMinutes(recentCompleted.total_break_minutes)}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => setShowCheckIn(true)}
              className="w-full shrink-0 sm:w-auto"
            >
              <LogIn className="mr-2 h-4 w-4" />
              New shift
            </Button>
          </div>
        </CardContent>
        <CaptureDialog
          open={showCheckIn}
          onOpenChange={setShowCheckIn}
          title="Check in"
          description="Take a selfie and share your location to start a new shift."
          actionLabel="Check in"
          onCapture={handleCheckIn}
        />
      </Card>
    );
  }

  // ---- NO active session, nothing completed recently ----
  if (!session) {
    return (
      <Card className="rounded-2xl shadow-card border-0 bg-gradient-to-br from-primary/10 to-primary/5">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-primary/15 flex items-center justify-center">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold">Ready for your shift?</h3>
                <p className="text-xs text-muted-foreground">
                  Check in with a photo and your location.
                </p>
              </div>
            </div>
            <Button onClick={() => setShowCheckIn(true)} size="lg" className="w-full sm:w-auto">
              <LogIn className="mr-2 h-5 w-5" />
              Check In
            </Button>
          </div>
        </CardContent>
        <CaptureDialog
          open={showCheckIn}
          onOpenChange={setShowCheckIn}
          title="Check in"
          description="Take a selfie and share your location to start your shift."
          actionLabel="Check in"
          onCapture={handleCheckIn}
        />
      </Card>
    );
  }

  // ---- ACTIVE or ON_BREAK ----
  const onBreak = session.status === 'on_break';
  const elapsed = formatElapsed(session.check_in_at, tick);
  const breakElapsed = activeBreakStart ? formatElapsed(activeBreakStart, tick) : null;

  return (
    <Card className="rounded-2xl shadow-card border-0 bg-gradient-to-br from-primary/10 to-transparent">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                    onBreak ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                />
                <span
                  className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                    onBreak ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                />
              </span>
              <h3 className="font-semibold">
                {onBreak ? 'On break' : 'On shift'}
              </h3>
              <Badge variant="secondary" className="text-[10px]">
                Started {formatTime(session.check_in_at)}
              </Badge>
            </div>
            <div className="mt-3 flex items-baseline gap-3">
              <p className="font-mono text-3xl font-bold tabular-nums">{elapsed}</p>
              {onBreak && breakElapsed && (
                <p className="text-sm text-amber-600">
                  Break: <span className="font-mono font-semibold">{breakElapsed}</span>
                </p>
              )}
            </div>
            {session.total_break_minutes > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Total break so far: {formatMinutes(session.total_break_minutes)}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                Couldn't refresh — this may be out of date.{' '}
                <button type="button" onClick={retry} disabled={retrying} className="font-medium underline">
                  Retry
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          {!onBreak ? (
            <Button
              variant="outline"
              onClick={handleStartBreak}
              disabled={breakLoading}
              className="w-full"
            >
              {breakLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Coffee className="mr-2 h-4 w-4" />
              )}
              Start Break
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={handleEndBreak}
              disabled={breakLoading}
              className="w-full"
            >
              {breakLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              End Break
            </Button>
          )}
          <Button
            onClick={() => setShowCheckOut(true)}
            variant="destructive"
            className="w-full"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Check Out
          </Button>
        </div>
      </CardContent>

      <CaptureDialog
        open={showCheckOut}
        onOpenChange={setShowCheckOut}
        title="Check out"
        description="Take a selfie and share your location to end your shift."
        actionLabel="Check out"
        onCapture={handleCheckOut}
      />
    </Card>
  );
}
