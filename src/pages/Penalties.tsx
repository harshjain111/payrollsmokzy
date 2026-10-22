import { useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Amount } from '@/components/ui/amount';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DayPenaltiesView } from '@/components/attendance/DayPenaltiesView';
import { LoadError } from '@/components/attendance/LoadError';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DisciplineLogRow, formatScheduleRange, penaltyReason } from '@/lib/discipline';
import { ShieldAlert, Loader2, ExternalLink, Calendar as CalendarIcon } from 'lucide-react';

interface StaffSummary {
  staff_id: string;
  staff_name: string;
  rows: DisciplineLogRow[];
  totalFine: number;
  lateCount: number;
  earlyCount: number;
  absentCount: number;
  cancelledFine: number;
}

export default function Penalties() {
  const { isOwner, isAdmin, isHR } = useAuth();
  const canView = isOwner || isAdmin || isHR;
  // Owners and admins can waive/restore; HR is read-only (also enforced by RLS).
  const canManage = isOwner || isAdmin;

  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<DisciplineLogRow[]>([]);
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = async () => {
    if (!canView) return;
    setLoading(true);
    setLoadError(false);
    try {
      const monthStart = format(startOfMonth(new Date(month + '-01')), 'yyyy-MM-dd');
      const monthEnd = format(endOfMonth(new Date(month + '-01')), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('attendance_discipline_log' as never)
        .select('*')
        .gte('work_date', monthStart)
        .lte('work_date', monthEnd)
        .order('work_date', { ascending: false });
      if (error) throw error;
      const logs = ((data as DisciplineLogRow[]) ?? []).filter(
        (l) => l.fine_amount > 0 || l.is_absent,
      );
      const ids = Array.from(new Set(logs.map((l) => l.staff_id)));
      const map: Record<string, string> = {};
      if (ids.length) {
        const { data: staff } = await supabase.rpc('get_attendance_staff');
        (staff ?? []).forEach((s: { id: string; full_name: string }) => {
          if (ids.includes(s.id)) map[s.id] = s.full_name;
        });
      }
      setStaffMap(map);
      setRows(logs);
    } catch (e) {
      console.error('Penalties load failed', e);
      setRows([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, canView]);

  const summaries = useMemo<StaffSummary[]>(() => {
    const byStaff: Record<string, StaffSummary> = {};
    for (const r of rows) {
      const name = staffMap[r.staff_id] || 'Unknown';
      if (!byStaff[r.staff_id]) {
        byStaff[r.staff_id] = {
          staff_id: r.staff_id,
          staff_name: name,
          rows: [],
          totalFine: 0,
          lateCount: 0,
          earlyCount: 0,
          absentCount: 0,
          cancelledFine: 0,
        };
      }
      const s = byStaff[r.staff_id];
      s.rows.push(r);
      if (r.is_cancelled) {
        s.cancelledFine += Number(r.fine_amount || 0);
      } else {
        s.totalFine += Number(r.fine_amount || 0);
      }
      if (r.is_absent) s.absentCount += 1;
      if (r.late_in_minutes > 0) s.lateCount += 1;
      if (r.early_out_minutes > 0) s.earlyCount += 1;
    }
    let list = Object.values(byStaff);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) => s.staff_name.toLowerCase().includes(q));
    return list.sort((a, b) => b.totalFine - a.totalFine);
  }, [rows, staffMap, search]);

  const grandTotal = summaries.reduce((s, x) => s + x.totalFine, 0);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={ShieldAlert}
          title="Not available"
          description="Only owners, admins, and HR can view penalties."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Penalties & Deductions"
        description="Every penalty for late check-in, early check-out and absence, day by day. Active penalties are deducted automatically at salary settlement."
      />

      <Tabs defaultValue="day" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:inline-grid sm:w-auto">
          <TabsTrigger value="day">Day-wise</TabsTrigger>
          <TabsTrigger value="month">Month summary</TabsTrigger>
        </TabsList>

        <TabsContent value="day">
          <DayPenaltiesView canManage={canManage} />
        </TabsContent>

        <TabsContent value="month" className="space-y-6">
          {/* Filters */}
          <Card className="rounded-2xl border-0 shadow-card">
            <CardContent className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:flex lg:flex-wrap">
              <div className="min-w-0">
                <Label className="text-xs text-muted-foreground">Month</Label>
                <Input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full sm:w-[180px]"
                />
              </div>
              <div className="min-w-0 flex-1 lg:min-w-[180px]">
                <Label className="text-xs text-muted-foreground">Search staff</Label>
                <Input
                  placeholder="Name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="rounded-xl bg-destructive/10 px-4 py-2 text-left sm:col-span-2 lg:ml-auto lg:text-right">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Total this month
                </p>
                <Amount value={grandTotal} className="font-bold text-destructive" size="lg" />
              </div>
            </CardContent>
          </Card>

          {loading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : loadError ? (
            <Card className="rounded-2xl border-0 shadow-card">
              <CardContent className="p-0">
                <LoadError onRetry={load} />
              </CardContent>
            </Card>
          ) : summaries.length === 0 ? (
            <EmptyState
              icon={CalendarIcon}
              title="No penalties this month"
              description="Nothing to deduct. All clear!"
            />
          ) : (
            <Card className="rounded-2xl border-0 shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Staff-wise breakdown</CardTitle>
                <CardDescription>
                  Tap a staff member to see every penalty entry for {format(new Date(month + '-01'), 'MMMM yyyy')}.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Accordion type="multiple" className="w-full">
                  {summaries.map((s) => (
                    <AccordionItem key={s.staff_id} value={s.staff_id}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pr-2 text-left">
                          <div className="min-w-0">
                            <p className="font-medium">{s.staff_name}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {s.lateCount > 0 && (
                                <Badge variant="outline" className="text-[10px]">
                                  {s.lateCount} late
                                </Badge>
                              )}
                              {s.earlyCount > 0 && (
                                <Badge variant="outline" className="text-[10px]">
                                  {s.earlyCount} early
                                </Badge>
                              )}
                              {s.absentCount > 0 && (
                                <Badge variant="destructive" className="text-[10px]">
                                  {s.absentCount} absent
                                </Badge>
                              )}
                              {s.cancelledFine > 0 && (
                                <Badge
                                  variant="secondary"
                                  className="bg-emerald-500/15 text-emerald-700 text-[10px]"
                                >
                                  ₹{s.cancelledFine.toFixed(0)} waived
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Amount
                            value={s.totalFine}
                            className="shrink-0 font-bold text-destructive"
                          />
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 pt-2">
                          {s.rows.map((r) => (
                            <div
                              key={r.id}
                              className="rounded-lg border bg-muted/30 p-3 text-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-medium">
                                    {format(new Date(r.work_date), 'EEE, dd MMM')}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Scheduled: {formatScheduleRange(r.scheduled_check_in, r.scheduled_check_out)}
                                  </p>
                                  <p
                                    className={`mt-1 text-xs ${
                                      r.is_cancelled ? 'line-through opacity-60' : ''
                                    }`}
                                  >
                                    {penaltyReason(r)}
                                  </p>
                                  {r.is_cancelled && (
                                    <p className="mt-1 text-[10px] text-emerald-700">
                                      Waived by {r.cancelled_by_name || 'admin'} —{' '}
                                      {r.cancellation_reason}
                                    </p>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <p
                                    className={`font-semibold ${
                                      r.is_cancelled
                                        ? 'line-through text-muted-foreground'
                                        : 'text-destructive'
                                    }`}
                                  >
                                    ₹{Number(r.fine_amount).toFixed(0)}
                                  </p>
                                  {r.is_absent && (
                                    <Badge variant="destructive" className="mt-1 text-[10px]">
                                      Absent
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                          <div className="flex items-center justify-between pt-2 border-t">
                            <span className="text-xs text-muted-foreground">
                              Net deduction at settlement
                            </span>
                            <Amount value={s.totalFine} className="font-bold text-destructive" />
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>

                 {!isHR && <div className="mt-4 rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
                  <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    These amounts are automatically applied as <strong>Discipline Fine</strong> in the{' '}
                    <Link to="/settlements" className="text-primary hover:underline">
                      Settlements
                    </Link>{' '}
                    page when you settle that month's salary. To waive an individual penalty, open the{' '}
                    <strong>Day-wise</strong> tab and pick its date.
                  </span>
                 </div>}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
