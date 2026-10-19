import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Coffee, Loader2, RefreshCw, Search, ShieldAlert, UserX } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AttendanceSession } from '@/lib/attendance';
import { formatMinutes, formatTime, localDateString } from '@/lib/attendance';
import type { Shift, ShiftAssignment } from '@/lib/discipline';

interface StaffRow {
  id: string;
  user_id: string | null;
  employee_id: string;
  full_name: string;
  department: string | null;
  is_active: boolean;
  attendance_tracked: boolean;
}

/** One person on today's board. `due` is the shift start today (if a shift is assigned). */
export interface BoardPerson {
  staff: StaffRow;
  session: AttendanceSession | null;
  due: Date | null;
  onLeave: boolean;
}

export type BoardGroup = 'late' | 'working' | 'break' | 'done' | 'upcoming' | 'leave';

const GROUPS: { key: BoardGroup; label: string; icon: typeof Clock; tone: string }[] = [
  { key: 'late', label: 'Not in – late', icon: AlertTriangle, tone: 'border-destructive/40 bg-destructive/10 text-destructive' },
  { key: 'working', label: 'Working now', icon: Clock, tone: 'border-success/40 bg-success/10 text-success' },
  { key: 'break', label: 'On break', icon: Coffee, tone: 'border-warning/40 bg-warning/10 text-warning' },
  { key: 'done', label: 'Checked out', icon: CheckCircle2, tone: 'border-info/40 bg-info/10 text-info' },
  { key: 'upcoming', label: 'Not in yet', icon: UserX, tone: 'border-border bg-muted text-muted-foreground' },
  { key: 'leave', label: 'On leave', icon: ShieldAlert, tone: 'border-primary/40 bg-primary/10 text-primary' },
];

const toDateAt = (day: string, hhmm: string) => new Date(`${day}T${hhmm.slice(0, 5)}:00`);

/** Which group a person belongs to right now. Exported for tests. */
export function groupOf(p: BoardPerson, now: Date, graceMinutes: number): BoardGroup {
  if (p.session) {
    if (p.session.status === 'on_break') return 'break';
    if (p.session.status === 'completed') return 'done';
    return 'working';
  }
  if (p.onLeave) return 'leave';
  if (p.due && now.getTime() > p.due.getTime() + graceMinutes * 60_000) return 'late';
  return 'upcoming';
}

/** Minutes between the shift start (plus nothing) and check-in, if positive. Exported for tests. */
export function lateByMinutes(p: BoardPerson, graceMinutes: number): number {
  if (!p.session || !p.due) return 0;
  const mins = Math.round((new Date(p.session.check_in_at).getTime() - p.due.getTime()) / 60_000);
  return mins > graceMinutes ? mins : 0;
}

const initials = (name: string) =>
  name.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const REFRESH_MS = 60_000;

/** Live list of who is in, who is late and who is not in yet today — for quick decisions. */
export function TodayAttendanceBoard({ className }: { className?: string }) {
  const [people, setPeople] = useState<BoardPerson[]>([]);
  const [grace, setGrace] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [filter, setFilter] = useState<BoardGroup | 'all'>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const today = localDateString();
    try {
      const [staffRes, sessRes, openRes, leaveRes, shiftRes, assignRes, rulesRes] = await Promise.all([
        supabase.rpc('get_attendance_staff'),
        supabase.from('attendance_sessions' as never).select('*').eq('work_date', today),
        // Night shifts that started yesterday and are still open count as "working now".
        supabase.from('attendance_sessions' as never).select('*').in('status', ['active', 'on_break']).lt('work_date', today),
        supabase.rpc('get_attendance_leave_dates', { _date_from: today, _date_to: today }),
        supabase.from('shifts' as never).select('*'),
        supabase.from('staff_shift_assignments' as never).select('*'),
        supabase.from('discipline_rules' as never).select('grace_minutes_in').limit(1).maybeSingle(),
      ]);
      if (staffRes.error) throw staffRes.error;
      if (sessRes.error) throw sessRes.error;

      const staff = ((staffRes.data as StaffRow[]) ?? []).filter((s) => s.is_active && s.attendance_tracked);
      const sessions = [
        ...((sessRes.data as AttendanceSession[]) ?? []),
        ...((openRes.error ? [] : (openRes.data as AttendanceSession[])) ?? []),
      ];
      const leaveIds = new Set(((leaveRes.error ? [] : leaveRes.data) ?? []).map((r: { staff_id: string }) => r.staff_id));
      const shifts = new Map(((shiftRes.error ? [] : (shiftRes.data as Shift[])) ?? []).map((s) => [s.id, s]));
      const assignments = new Map(
        ((assignRes.error ? [] : (assignRes.data as ShiftAssignment[])) ?? []).map((a) => [a.staff_id, a]),
      );
      const g = (rulesRes.data as { grace_minutes_in?: number } | null)?.grace_minutes_in;
      if (typeof g === 'number') setGrace(g);

      // Latest session per person (a second shift the same day replaces the first).
      const byUser = new Map(staff.filter((s) => s.user_id).map((s) => [s.user_id as string, s.id]));
      const latest = new Map<string, AttendanceSession>();
      for (const s of sessions) {
        const key = s.staff_id ?? byUser.get(s.user_id);
        if (!key) continue;
        const prev = latest.get(key);
        if (!prev || new Date(s.check_in_at) > new Date(prev.check_in_at)) latest.set(key, s);
      }

      setPeople(
        staff.map((member) => {
          const a = assignments.get(member.id);
          const start = a?.override_check_in || (a?.shift_id ? shifts.get(a.shift_id)?.check_in_time : null);
          return {
            staff: member,
            session: latest.get(member.id) ?? null,
            due: start ? toDateAt(today, start) : null,
            onLeave: leaveIds.has(member.id),
          };
        }),
      );
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load today’s attendance');
    } finally {
      setLoading(false);
      setNow(new Date());
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(() => load(true), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && load(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const grouped = useMemo(() => {
    const out: Record<BoardGroup, BoardPerson[]> = { late: [], working: [], break: [], done: [], upcoming: [], leave: [] };
    for (const p of people) out[groupOf(p, now, grace)].push(p);
    out.late.sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
    out.upcoming.sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));
    for (const k of ['working', 'break', 'done'] as const) {
      out[k].sort((a, b) => new Date(a.session!.check_in_at).getTime() - new Date(b.session!.check_in_at).getTime());
    }
    return out;
  }, [people, now, grace]);

  const query = search.trim().toLowerCase();
  const matches = (p: BoardPerson) =>
    !query || p.staff.full_name.toLowerCase().includes(query) || p.staff.employee_id.toLowerCase().includes(query);
  const visibleGroups = GROUPS.filter((g) => filter === 'all' || filter === g.key);
  const lateArrivals = [...grouped.working, ...grouped.break, ...grouped.done].filter((p) => lateByMinutes(p, grace) > 0).length;

  const detail = (p: BoardPerson, group: BoardGroup) => {
    const s = p.session;
    if (group === 'late') return `Shift ${format(p.due!, 'h:mm a')} · ${formatMinutes(Math.round((now.getTime() - p.due!.getTime()) / 60_000))} late`;
    if (group === 'upcoming') return p.due ? `Shift starts ${format(p.due, 'h:mm a')}` : 'No shift set';
    if (group === 'leave') return 'Approved leave';
    if (!s) return '';
    if (group === 'done') return `${formatTime(s.check_in_at)} – ${formatTime(s.check_out_at)} · ${formatMinutes(s.worked_minutes)}`;
    const since = Math.round((now.getTime() - new Date(s.check_in_at).getTime()) / 60_000);
    return `In ${formatTime(s.check_in_at)} · ${formatMinutes(Math.max(0, since))} so far`;
  };

  return (
    <Card className={cn('rounded-2xl border-0 shadow-card', className)}>
      <CardHeader className="space-y-3 px-4 pb-2 sm:px-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold sm:text-lg">Today’s attendance</CardTitle>
            <p className="text-xs text-muted-foreground">
              {format(new Date(), 'EEE, dd MMM')}
              {updatedAt && ` · updated ${format(updatedAt, 'h:mm a')}`}
              {lateArrivals > 0 && ` · ${lateArrivals} came in late`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading} aria-label="Refresh attendance">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {/* Tap a chip to show only that group; tap again to show everyone. */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {GROUPS.map((g) => {
            const Icon = g.icon;
            const active = filter === g.key;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setFilter(active ? 'all' : g.key)}
                aria-pressed={active}
                className={cn(
                  'min-w-0 rounded-xl border p-2 text-left transition',
                  g.tone,
                  active ? 'ring-2 ring-primary ring-offset-1' : 'opacity-90 hover:opacity-100',
                )}
              >
                <div className="flex items-center gap-1">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-lg font-bold tabular-nums leading-none">{loading && !updatedAt ? '—' : grouped[g.key].length}</span>
                </div>
                <p className="mt-1 truncate text-[11px] font-medium">{g.label}</p>
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or employee ID"
            className="h-9 pl-9"
            aria-label="Search staff"
          />
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 sm:px-6">
        {error ? (
          <div className="rounded-lg border border-destructive/40 p-4 text-center text-sm">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => load()}>Retry</Button>
          </div>
        ) : loading && !updatedAt ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading…
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {visibleGroups.map((g) => {
              const list = grouped[g.key].filter(matches);
              if (list.length === 0) return null;
              return (
                <section key={g.key}>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.label} ({list.length})
                  </h3>
                  <ul className="divide-y rounded-xl border">
                    {list.map((p) => {
                      const late = lateByMinutes(p, grace);
                      return (
                        <li key={p.staff.id} className="flex items-center gap-3 px-3 py-2.5">
                          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold', g.tone)}>
                            {initials(p.staff.full_name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{p.staff.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{detail(p, g.key)}</p>
                          </div>
                          {late > 0 && (
                            <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                              Late {formatMinutes(late)}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {visibleGroups.every((g) => grouped[g.key].filter(matches).length === 0) && (
              <p className="py-6 text-center text-sm text-muted-foreground">Nobody here.</p>
            )}
          </div>
        )}
        <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0">
          <Link to="/attendance">Open full attendance report →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
