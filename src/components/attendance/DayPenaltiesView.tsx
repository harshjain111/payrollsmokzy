import { useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { Ban, CalendarDays, ChevronLeft, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Amount } from '@/components/ui/amount';
import { EmptyState } from '@/components/layout/EmptyState';
import { supabase } from '@/integrations/supabase/client';
import { DisciplineLogRow, formatScheduleRange } from '@/lib/discipline';
import { PenaltyAction, PenaltyActionDialog, PenaltyTarget } from './PenaltyActionDialog';
import { LoadError } from './LoadError';

interface Props {
  /** Owners and admins can waive or restore; everyone else (HR) only views. */
  canManage: boolean;
}

const todayStr = () => format(new Date(), 'yyyy-MM-dd');

/** Every penalty charged on one day, with waive/restore right on each row. */
export function DayPenaltiesView({ canManage }: Props) {
  const [date, setDate] = useState(todayStr());
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PenaltyTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [target, setTarget] = useState<PenaltyTarget | null>(null);
  const [mode, setMode] = useState<PenaltyAction>('cancel');

  const isToday = date === todayStr();

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const { data, error } = await supabase
        .from('attendance_discipline_log' as never)
        .select('*')
        .eq('work_date', date);
      if (error) throw error;
      const logs = ((data as DisciplineLogRow[]) ?? []).filter(
        (l) => Number(l.fine_amount) > 0 || l.is_absent,
      );

      const info: Record<string, { name: string; phone: string | null }> = {};
      const ids = Array.from(new Set(logs.map((l) => l.staff_id)));
      if (ids.length) {
        if (canManage) {
          // Owners/admins can read phone numbers, used for the WhatsApp waiver message.
          const { data: staff } = await supabase
            .from('staff')
            .select('id, full_name, phone')
            .in('id', ids);
          (staff ?? []).forEach((s: { id: string; full_name: string; phone: string | null }) => {
            info[s.id] = { name: s.full_name, phone: s.phone };
          });
        } else {
          const { data: staff } = await supabase.rpc('get_attendance_staff');
          (staff ?? []).forEach((s: { id: string; full_name: string }) => {
            if (ids.includes(s.id)) info[s.id] = { name: s.full_name, phone: null };
          });
        }
      }

      setRows(
        logs
          .map((l) => ({
            ...l,
            staff_name: info[l.staff_id]?.name || 'Unknown',
            staff_phone: info[l.staff_id]?.phone ?? null,
          }))
          .sort((a, b) => (a.staff_name ?? '').localeCompare(b.staff_name ?? '')),
      );
    } catch (e) {
      console.error('Day penalties load failed', e);
      toast.error('Failed to load penalties');
      setRows([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, canManage]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => (r.staff_name ?? '').toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const activeTotal = visible
    .filter((r) => !r.is_cancelled)
    .reduce((sum, r) => sum + Number(r.fine_amount || 0), 0);
  const waivedTotal = visible
    .filter((r) => r.is_cancelled)
    .reduce((sum, r) => sum + Number(r.fine_amount || 0), 0);

  const shiftDay = (delta: number) => {
    const next = format(addDays(parseISO(date), delta), 'yyyy-MM-dd');
    if (next <= todayStr()) setDate(next);
  };

  const open = (row: PenaltyTarget, action: PenaltyAction) => {
    setMode(action);
    setTarget(row);
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-0 shadow-card">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftDay(-1)}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="min-w-0 flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftDay(1)}
              disabled={isToday}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {isToday ? 'Today, ' : ''}
              {format(parseISO(date), 'EEEE, dd MMM yyyy')}
            </p>
            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => setDate(todayStr())}>
                Back to today
              </Button>
            )}
          </div>
          <Input
            placeholder="Search staff…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted/50 p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Penalties</p>
              <p className="text-lg font-bold">{visible.length}</p>
            </div>
            <div className="rounded-xl bg-destructive/10 p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">To deduct</p>
              <Amount value={activeTotal} className="font-bold text-destructive" />
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Waived</p>
              <Amount value={waivedTotal} className="font-bold text-emerald-700" />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <LoadError onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No penalties on this day"
          description="Nobody was charged a penalty on this date."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <Card key={r.id} className="rounded-2xl border-0 shadow-card">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.staff_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Shift {formatScheduleRange(r.scheduled_check_in, r.scheduled_check_out)}
                    </p>
                  </div>
                  <span
                    className={
                      r.is_cancelled
                        ? 'shrink-0 text-sm text-muted-foreground line-through'
                        : 'shrink-0 text-sm font-semibold text-destructive'
                    }
                  >
                    ₹{Number(r.fine_amount).toFixed(0)}
                  </span>
                </div>
                <p
                  className={
                    r.is_cancelled
                      ? 'break-words text-xs text-muted-foreground line-through'
                      : 'break-words text-xs'
                  }
                >
                  {r.is_absent ? r.absent_reason || 'Marked absent' : r.fine_reason || '—'}
                </p>
                {r.is_cancelled && (
                  <p className="break-words text-[11px] text-emerald-700">
                    Waived by {r.cancelled_by_name || 'admin'}
                    {r.cancellation_reason ? ` — ${r.cancellation_reason}` : ''}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-1.5">
                    <Badge variant={r.is_cancelled ? 'secondary' : 'destructive'}>
                      {r.is_cancelled ? 'Waived' : 'Active'}
                    </Badge>
                    {r.is_absent && <Badge variant="outline">Absent</Badge>}
                  </div>
                  {canManage &&
                    (r.is_cancelled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => open(r, 'restore')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => open(r, 'cancel')}
                      >
                        <Ban className="h-3.5 w-3.5" /> Waive penalty
                      </Button>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {canManage && (
        <PenaltyActionDialog
          target={target}
          mode={mode}
          onClose={() => setTarget(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
