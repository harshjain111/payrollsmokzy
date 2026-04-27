import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { AttendanceSession, formatMinutes } from '@/lib/attendance';
import { SessionDetailsDrawer } from '@/components/attendance/SessionDetailsDrawer';
import { format } from 'date-fns';
import { CalendarClock, Coffee, CheckCircle2, Users, Loader2 } from 'lucide-react';

interface Row extends AttendanceSession {
  staff_name?: string;
}

export default function Attendance() {
  const { isOwner, isAdmin, isCA } = useAuth();
  const canView = isOwner || isAdmin || isCA;

  const today = format(new Date(), 'yyyy-MM-dd');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AttendanceSession | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!canView) return;
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('attendance_sessions' as never)
        .select('*')
        .gte('work_date', from)
        .lte('work_date', to)
        .order('check_in_at', { ascending: false });
      if (error) throw error;
      const sessions = (data as AttendanceSession[]) ?? [];

      // Fetch staff names
      const staffIds = Array.from(new Set(sessions.map((s) => s.staff_id).filter(Boolean))) as string[];
      const userIds = Array.from(new Set(sessions.map((s) => s.user_id))) as string[];
      let nameMap: Record<string, string> = {};
      if (staffIds.length || userIds.length) {
        const { data: staff } = await supabase
          .from('staff')
          .select('id, user_id, full_name')
          .or(
            [
              staffIds.length ? `id.in.(${staffIds.join(',')})` : '',
              userIds.length ? `user_id.in.(${userIds.join(',')})` : '',
            ]
              .filter(Boolean)
              .join(','),
          );
        (staff ?? []).forEach((s: { id: string; user_id: string | null; full_name: string }) => {
          nameMap[s.id] = s.full_name;
          if (s.user_id) nameMap[s.user_id] = s.full_name;
        });
      }

      setRows(
        sessions.map((s) => ({
          ...s,
          staff_name: nameMap[s.staff_id ?? ''] || nameMap[s.user_id] || 'Unknown',
        })),
      );
    } catch (e) {
      console.error('Attendance fetch error', e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => (r.staff_name ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    const todayRows = rows.filter((r) => r.work_date === today);
    return {
      checkedIn: todayRows.filter((r) => r.status === 'active').length,
      onBreak: todayRows.filter((r) => r.status === 'on_break').length,
      completed: todayRows.filter((r) => r.status === 'completed').length,
      total: todayRows.length,
    };
  }, [rows, today]);

  if (!canView) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">You don't have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Live check-in / check-out records with photos and locations."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Checked In Today"
          value={stats.checkedIn}
          subtitle="Currently on shift"
          icon={CalendarClock}
          color="green"
        />
        <StatCard
          title="On Break"
          value={stats.onBreak}
          subtitle="Right now"
          icon={Coffee}
          color="orange"
        />
        <StatCard
          title="Completed Today"
          value={stats.completed}
          subtitle="Shifts finished"
          icon={CheckCircle2}
          color="blue"
        />
        <StatCard
          title="Total Sessions Today"
          value={stats.total}
          subtitle="Across all staff"
          icon={Users}
          color="purple"
        />
      </div>

      <Card className="rounded-2xl border-0 shadow-card">
        <CardContent className="p-4 md:p-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Search staff</label>
              <Input
                placeholder="Name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={fetchRows}>
              Refresh
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No sessions found.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead>Work date</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Worked</TableHead>
                    <TableHead>Break</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelected(r);
                        setDrawerOpen(true);
                      }}
                    >
                      <TableCell className="font-medium">{r.staff_name}</TableCell>
                      <TableCell>{format(new Date(r.work_date), 'dd MMM yyyy')}</TableCell>
                      <TableCell>{format(new Date(r.check_in_at), 'hh:mm a')}</TableCell>
                      <TableCell>
                        {r.check_out_at ? format(new Date(r.check_out_at), 'hh:mm a') : '—'}
                      </TableCell>
                      <TableCell>{formatMinutes(r.worked_minutes)}</TableCell>
                      <TableCell>{formatMinutes(r.total_break_minutes)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === 'completed'
                              ? 'secondary'
                              : r.status === 'on_break'
                              ? 'outline'
                              : 'default'
                          }
                        >
                          {r.status}
                        </Badge>
                        {r.late_checkout && (
                          <Badge variant="destructive" className="ml-1">
                            late
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <SessionDetailsDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        session={selected}
      />
    </div>
  );
}
