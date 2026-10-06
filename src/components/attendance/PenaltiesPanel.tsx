import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DisciplineLogRow, formatScheduleRange } from '@/lib/discipline';
import { PenaltyActionDialog, PenaltyAction } from './PenaltyActionDialog';
import { LoadError } from './LoadError';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { Ban, Loader2, RotateCcw, ShieldAlert, AlertTriangle, UserX, PlayCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

interface Row extends DisciplineLogRow {
  staff_name?: string;
  staff_phone?: string | null;
}

export function PenaltiesPanel() {
  const { isOwner, isAdmin } = useAuth();
  const canManage = isOwner || isAdmin;

  const today = format(new Date(), 'yyyy-MM-dd');
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const [from, setFrom] = useState(format(start, 'yyyy-MM-dd'));
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [confirmAbsentCheck, setConfirmAbsentCheck] = useState(false);
  const [unscheduledStaff, setUnscheduledStaff] = useState<string[]>([]);
  const [absentToday, setAbsentToday] = useState(0);
  const [runningAbsentCheck, setRunningAbsentCheck] = useState(false);

  const [target, setTarget] = useState<Row | null>(null);
  const [mode, setMode] = useState<PenaltyAction>('cancel');

  const load = async () => {
    if (!canManage) return;
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('attendance_discipline_log' as never)
        .select('*')
        .gte('work_date', from)
        .lte('work_date', to)
        .order('work_date', { ascending: false });
      if (error) throw error;
      const logs = (data as DisciplineLogRow[]) ?? [];
      const staffIds = Array.from(new Set(logs.map((l) => l.staff_id)));
      const infoMap: Record<string, { name: string; phone: string | null }> = {};
      if (staffIds.length) {
        const { data: staff } = await supabase
          .from('staff')
          .select('id, full_name, phone')
          .in('id', staffIds);
        (staff ?? []).forEach((s: { id: string; full_name: string; phone: string | null }) => {
          infoMap[s.id] = { name: s.full_name, phone: s.phone };
        });
      }
      setRows(
        logs
          .filter((l) => l.fine_amount > 0 || l.is_absent)
          .map((l) => ({
            ...l,
            staff_name: infoMap[l.staff_id]?.name || 'Unknown',
            staff_phone: infoMap[l.staff_id]?.phone ?? null,
          })),
      );
    } catch (e) {
      console.error('Penalties load failed', e);
      toast.error('Failed to load penalties');
      setRows([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // Coverage check: tracked + active staff with no shift assignment.
  // Without an assignment, the system has no scheduled in/out time → it
  // cannot decide if a check-in is late, so NO fine is logged and NO
  // WhatsApp message is sent. This is the silent-failure mode that caused
  // today's penalties to be skipped despite rules being enabled.
  useEffect(() => {
    if (!canManage) return;
    (async () => {
      try {
        const { data: staff } = await supabase
          .from('staff')
          .select('id, full_name')
          .eq('is_active', true)
          .eq('attendance_tracked', true);
        const list = (staff ?? []) as { id: string; full_name: string }[];
        if (list.length === 0) {
          setUnscheduledStaff([]);
          return;
        }
        const { data: assigns } = await supabase
          .from('staff_shift_assignments' as never)
          .select('staff_id')
          .in('staff_id', list.map((s) => s.id));
        const assigned = new Set(
          ((assigns as { staff_id: string }[]) ?? []).map((a) => a.staff_id),
        );
        setUnscheduledStaff(
          list.filter((s) => !assigned.has(s.id)).map((s) => s.full_name),
        );
      } catch (e) {
        console.error('Coverage check failed', e);
      }
    })();
  }, [canManage]);

  // Absent-today count derived from current rows
  useEffect(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    setAbsentToday(rows.filter((r) => r.is_absent && r.work_date === todayStr).length);
  }, [rows]);

  const runAbsentCheck = async () => {
    setRunningAbsentCheck(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-absent-staff', { body: {} });
      if (error) throw error;
      const res = data as { total_absent?: number; notifications_sent?: number; failures?: number };
      toast.success(
        `Absent check complete — ${res?.total_absent ?? 0} marked absent, ${res?.notifications_sent ?? 0} WhatsApp sent${res?.failures ? `, ${res.failures} failed` : ''}`,
      );
      await load();
    } catch (e) {
      console.error('Absent check failed', e);
      toast.error(e instanceof Error ? e.message : 'Absent check failed');
    } finally {
      setRunningAbsentCheck(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.staff_name ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const openCancel = (r: Row) => {
    setTarget(r);
    setMode('cancel');
  };
  const openRestore = (r: Row) => {
    setTarget(r);
    setMode('restore');
  };

  if (!canManage) return null;

  return (
    <Card className="rounded-2xl border-0 shadow-card">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            <CardTitle>Manage Penalties</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={absentToday > 0 ? 'destructive' : 'secondary'}
              className="shrink-0 gap-1 whitespace-nowrap"
            >
              <UserX className="h-3.5 w-3.5" />
              {absentToday} absent today
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmAbsentCheck(true)}
              disabled={runningAbsentCheck}
              className="gap-1"
            >
              {runningAbsentCheck ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              Run Absent Check Now
            </Button>
          </div>
        </div>
        <CardDescription>
          Waive any system-charged penalty for a staff member. Waived penalties won't be
          deducted at salary settlement. The original entry stays for audit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {unscheduledStaff.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  {unscheduledStaff.length} tracked staff have no shift assigned — penalties and
                  WhatsApp messages are being SKIPPED for them.
                </p>
                <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
                  Without a scheduled check-in / check-out time, the system can't tell if anyone
                  is late, so no fine is logged and no message is sent. Assign a shift to fix.
                </p>
                <p className="text-xs text-muted-foreground">
                  Missing: {unscheduledStaff.slice(0, 6).join(', ')}
                  {unscheduledStaff.length > 6 ? ` +${unscheduledStaff.length - 6} more` : ''}
                </p>
                <Link
                  to="/shifts"
                  className="inline-block text-xs font-medium text-primary hover:underline mt-1"
                >
                  Go to Shifts →
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 items-end gap-3 lg:flex lg:flex-wrap">
          <div className="min-w-0">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full sm:w-[160px]"
            />
          </div>
          <div className="min-w-0">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full sm:w-[160px]"
            />
          </div>
          <div className="col-span-2 min-w-0 flex-1 lg:col-span-1 lg:min-w-[200px]">
            <Label className="text-xs text-muted-foreground">Search staff</Label>
            <Input
              placeholder="Name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={load} className="col-span-2 w-full lg:col-span-1 lg:w-auto">
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : loadError ? (
          <LoadError onRetry={load} />
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No penalties charged in this period.
          </p>
        ) : (
          <>
          <div className="divide-y md:hidden">
            {filtered.map((row) => (
              <div key={row.id} className="space-y-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate font-medium">{row.staff_name}</p><p className="text-xs text-muted-foreground">{format(new Date(row.work_date), 'dd MMM yyyy')} · {formatScheduleRange(row.scheduled_check_in, row.scheduled_check_out)}</p></div>
                  <span className={row.is_cancelled ? 'shrink-0 text-sm text-muted-foreground line-through' : 'shrink-0 text-sm font-semibold text-destructive'}>₹{Number(row.fine_amount).toFixed(0)}</span>
                </div>
                <p className={row.is_cancelled ? 'break-words text-xs text-muted-foreground line-through' : 'break-words text-xs'}>{row.fine_reason || (row.is_absent ? row.absent_reason || 'Absent' : '—')}</p>
                {row.is_cancelled && <p className="break-words text-[10px] text-success">Waived by {row.cancelled_by_name || 'system'} — {row.cancellation_reason}</p>}
                <div className="flex items-center justify-between gap-3">
                  <Badge variant={row.is_cancelled ? 'secondary' : 'destructive'}>{row.is_cancelled ? 'Waived' : 'Active'}</Badge>
                  <Button size="sm" variant="outline" onClick={() => row.is_cancelled ? openRestore(row) : openCancel(row)} className={!row.is_cancelled ? 'gap-1 border-destructive/30 text-destructive hover:bg-destructive/10' : 'gap-1'}>{row.is_cancelled ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}{row.is_cancelled ? 'Restore' : 'Waive'}</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Fine</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.staff_name}</TableCell>
                    <TableCell>{format(new Date(r.work_date), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatScheduleRange(r.scheduled_check_in, r.scheduled_check_out)}
                    </TableCell>
                    <TableCell className="text-xs max-w-[280px]">
                      <span className={r.is_cancelled ? 'line-through opacity-60' : ''}>
                        {r.fine_reason || (r.is_absent ? r.absent_reason || 'Absent' : '—')}
                      </span>
                      {r.is_cancelled && (
                        <p className="text-[10px] text-emerald-600 mt-0.5">
                          Waived by {r.cancelled_by_name || 'system'} —{' '}
                          {r.cancellation_reason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          r.is_cancelled
                            ? 'line-through text-muted-foreground'
                            : 'font-semibold text-destructive'
                        }
                      >
                        ₹{Number(r.fine_amount).toFixed(0)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.is_cancelled ? (
                        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700">
                          Waived
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.is_cancelled ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRestore(r)}
                          className="gap-1"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openCancel(r)}
                          className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                        >
                          <Ban className="h-3.5 w-3.5" /> Waive
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </>
        )}
      </CardContent>

      <PenaltyActionDialog
        target={target}
        mode={mode}
        onClose={() => setTarget(null)}
        onDone={load}
      />

      <AlertDialog open={confirmAbsentCheck} onOpenChange={setConfirmAbsentCheck}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run the absent check now?</AlertDialogTitle>
            <AlertDialogDescription>
              Every tracked staff member with a shift who has not checked in today (and is not on
              approved leave) will be marked absent, charged the absent penalty, and sent a WhatsApp
              message — including anyone whose shift has not started yet. This runs automatically
              at 11:59 PM; only run it by hand if that check was missed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmAbsentCheck(false);
                runAbsentCheck();
              }}
            >
              Mark absent &amp; notify
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
