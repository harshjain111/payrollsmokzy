import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { format } from 'date-fns';
import { Ban, Loader2, RotateCcw, ShieldAlert, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

interface Row extends DisciplineLogRow {
  staff_name?: string;
}

export function PenaltiesPanel() {
  const { isOwner, isAdmin, user, staffData } = useAuth();
  const canManage = isOwner || isAdmin;

  const today = format(new Date(), 'yyyy-MM-dd');
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const [from, setFrom] = useState(format(start, 'yyyy-MM-dd'));
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [unscheduledStaff, setUnscheduledStaff] = useState<string[]>([]);

  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [mode, setMode] = useState<'cancel' | 'restore'>('cancel');

  const load = async () => {
    if (!canManage) return;
    setLoading(true);
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
      const nameMap: Record<string, string> = {};
      if (staffIds.length) {
        const { data: staff } = await supabase
          .from('staff')
          .select('id, full_name')
          .in('id', staffIds);
        (staff ?? []).forEach((s: { id: string; full_name: string }) => {
          nameMap[s.id] = s.full_name;
        });
      }
      setRows(
        logs
          .filter((l) => l.fine_amount > 0 || l.is_absent)
          .map((l) => ({ ...l, staff_name: nameMap[l.staff_id] || 'Unknown' })),
      );
    } catch (e) {
      console.error('Penalties load failed', e);
      toast.error('Failed to load penalties');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.staff_name ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const openCancel = (r: Row) => {
    setTarget(r);
    setReason('');
    setMode('cancel');
  };
  const openRestore = (r: Row) => {
    setTarget(r);
    setReason('');
    setMode('restore');
  };

  const submit = async () => {
    if (!target) return;
    if (mode === 'cancel' && !reason.trim()) {
      toast.error('Please enter a reason');
      return;
    }
    setWorking(true);
    try {
      const actorName =
        staffData?.full_name || user?.user_metadata?.full_name || user?.email || 'Unknown';
      const payload =
        mode === 'cancel'
          ? {
              is_cancelled: true,
              cancelled_by: user?.id ?? null,
              cancelled_by_name: actorName,
              cancelled_at: new Date().toISOString(),
              cancellation_reason: reason.trim(),
            }
          : {
              is_cancelled: false,
              cancelled_by: null,
              cancelled_by_name: null,
              cancelled_at: null,
              cancellation_reason: null,
            };
      const { error } = await supabase
        .from('attendance_discipline_log' as never)
        .update(payload as never)
        .eq('id', target.id);
      if (error) throw error;
      toast.success(mode === 'cancel' ? 'Penalty cancelled' : 'Penalty restored');
      setTarget(null);
      await load();
    } catch (e) {
      console.error('Penalty update failed', e);
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setWorking(false);
    }
  };

  if (!canManage) return null;

  return (
    <Card className="rounded-2xl border-0 shadow-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <CardTitle>Manage Penalties</CardTitle>
        </div>
        <CardDescription>
          Cancel any system-charged penalty for a staff member. Cancelled penalties won't be
          deducted at salary settlement. The original entry stays for audit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs text-muted-foreground">Search staff</Label>
            <Input
              placeholder="Name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No penalties charged in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
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
                          Cancelled by {r.cancelled_by_name || 'system'} —{' '}
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
                          Cancelled
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
                          <Ban className="h-3.5 w-3.5" /> Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === 'cancel' ? 'Cancel penalty' : 'Restore penalty'}
            </DialogTitle>
            <DialogDescription>
              {target && (
                <span>
                  {target.staff_name} • {format(new Date(target.work_date), 'dd MMM yyyy')} •
                  ₹{Number(target.fine_amount).toFixed(0)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {mode === 'cancel' ? (
            <div className="space-y-2">
              <Label className="text-xs">Reason (required)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Traffic jam acknowledged by manager"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                The penalty will be excluded from this month's settlement. The record stays
                visible for audit.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This will restore the penalty so it counts toward the salary deduction again.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={working}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={working}>
              {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'cancel' ? 'Confirm cancellation' : 'Restore penalty'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
