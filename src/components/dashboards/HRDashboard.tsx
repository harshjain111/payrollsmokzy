import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, CheckCircle2, Coffee, Search, ShieldAlert, UserPlus, Users } from 'lucide-react';
import type { AttendanceSession } from '@/lib/attendance';

interface StaffRow {
  id: string;
  user_id: string | null;
  employee_id: string;
  full_name: string;
  department: string | null;
  is_active: boolean;
  attendance_tracked: boolean;
}

type AttendanceGroup = 'checked-in' | 'break' | 'completed' | 'absent' | 'leave';

interface StatusTile {
  key: AttendanceGroup;
  title: string;
  subtitle: string;
  icon: typeof Users;
  tone: string;
}

const tiles: StatusTile[] = [
  { key: 'checked-in', title: 'Checked In', subtitle: 'Working now', icon: CalendarClock, tone: 'text-success bg-success/10' },
  { key: 'break', title: 'On Break', subtitle: 'Away temporarily', icon: Coffee, tone: 'text-warning bg-warning/10' },
  { key: 'completed', title: 'Checked Out', subtitle: 'Shift completed', icon: CheckCircle2, tone: 'text-info bg-info/10' },
  { key: 'absent', title: 'Absent', subtitle: 'No attendance today', icon: Users, tone: 'text-destructive bg-destructive/10' },
  { key: 'leave', title: 'On Leave', subtitle: 'Approved leave', icon: ShieldAlert, tone: 'text-primary bg-primary/10' },
];

export function HRDashboard() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [leaveIds, setLeaveIds] = useState<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState<AttendanceGroup | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [staffResult, sessionResult, leaveResult] = await Promise.all([
        supabase.rpc('get_attendance_staff'),
        supabase.from('attendance_sessions').select('*').eq('work_date', today),
        supabase.rpc('get_attendance_leave_dates', { _date_from: today, _date_to: today }),
      ]);
      if (!staffResult.error) {
        setStaff(((staffResult.data as StaffRow[]) ?? []).filter((member) => member.is_active && member.attendance_tracked));
      }
      if (!sessionResult.error) setSessions((sessionResult.data as AttendanceSession[]) ?? []);
      if (!leaveResult.error) {
        setLeaveIds(new Set((leaveResult.data ?? []).map((row: { staff_id: string }) => row.staff_id)));
      }
      setLoading(false);
    };
    load();
  }, [today]);

  const grouped = useMemo(() => {
    const latest = new Map<string, AttendanceSession>();
    const staffByUser = new Map(staff.filter((member) => member.user_id).map((member) => [member.user_id, member.id]));
    sessions.forEach((session) => {
      const key = session.staff_id ?? staffByUser.get(session.user_id);
      if (!key) return;
      const previous = latest.get(key);
      if (!previous || new Date(session.check_in_at) > new Date(previous.check_in_at)) latest.set(key, session);
    });
    const result: Record<AttendanceGroup, StaffRow[]> = {
      'checked-in': [], break: [], completed: [], absent: [], leave: [],
    };
    staff.forEach((member) => {
      if (leaveIds.has(member.id)) {
        result.leave.push(member);
        return;
      }
      const session = latest.get(member.id);
      if (!session) result.absent.push(member);
      else if (session.status === 'on_break') result.break.push(member);
      else if (session.status === 'completed') result.completed.push(member);
      else result['checked-in'].push(member);
    });
    return result;
  }, [leaveIds, sessions, staff]);

  const selectedTile = tiles.find((tile) => tile.key === selectedGroup);
  const visiblePeople = (selectedGroup ? grouped[selectedGroup] : []).filter((member) => {
    const query = search.trim().toLowerCase();
    return !query || member.full_name.toLowerCase().includes(query) || member.employee_id.toLowerCase().includes(query);
  });

  return (
    <div className="min-w-0 space-y-5 pb-6">
      <PageHeader title="HR Dashboard" description={`Workforce attendance for ${format(new Date(), 'EEEE, dd MMMM')}`}>
        <Button asChild size="sm"><Link to="/users/new"><UserPlus className="mr-2 h-4 w-4" />Create Staff User</Link></Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Button
              key={tile.key}
              type="button"
              variant="ghost"
              className="h-auto min-w-0 justify-start p-0 text-left"
              onClick={() => { setSelectedGroup(tile.key); setSearch(''); }}
              disabled={loading}
            >
              <Card className="h-full w-full border-border/70 shadow-card transition-shadow hover:shadow-card-hover">
                <CardContent className="p-4">
                  <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${tile.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="truncate text-xs font-medium text-muted-foreground">{tile.title}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{loading ? '—' : grouped[tile.key].length}</p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">{tile.subtitle}</p>
                </CardContent>
              </Card>
            </Button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button asChild variant="outline" className="h-12 justify-start"><Link to="/attendance"><CalendarClock className="mr-2 h-4 w-4" />Attendance Report</Link></Button>
        <Button asChild variant="outline" className="h-12 justify-start"><Link to="/penalties"><ShieldAlert className="mr-2 h-4 w-4" />View Penalties</Link></Button>
        <Button asChild variant="outline" className="h-12 justify-start"><Link to="/my-attendance"><Users className="mr-2 h-4 w-4" />My Attendance</Link></Button>
        <Button asChild variant="outline" className="h-12 justify-start"><Link to="/users/new"><UserPlus className="mr-2 h-4 w-4" />Create Staff User</Link></Button>
      </div>

      <Dialog open={selectedGroup !== null} onOpenChange={(open) => !open && setSelectedGroup(null)}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{selectedTile?.title ?? 'Attendance'} — {selectedGroup ? grouped[selectedGroup].length : 0}</DialogTitle>
            <DialogDescription>{selectedTile?.subtitle}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or employee ID" className="pl-9" />
          </div>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {visiblePeople.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No staff found.</p>
            ) : visiblePeople.map((member) => (
              <div key={member.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.employee_id}{member.department ? ` · ${member.department}` : ''}</p>
                </div>
                <Badge variant="secondary" className="shrink-0">{selectedTile?.title}</Badge>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}