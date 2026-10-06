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

import { StatCard } from '@/components/ui/stat-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AttendanceSession, formatMinutes, formatTime } from '@/lib/attendance';
import { SessionDetailsDrawer } from '@/components/attendance/SessionDetailsDrawer';
import { EditAttendanceDialog, AttendanceEditTarget } from '@/components/attendance/EditAttendanceDialog';
import { PenaltiesPanel } from '@/components/attendance/PenaltiesPanel';
import { format, eachDayOfInterval, startOfMonth, parseISO } from 'date-fns';
import {
  CalendarClock,
  Coffee,
  CheckCircle2,
  Users,
  Loader2,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportToPDF, downloadPDF } from '@/lib/pdf-export';
import { toast } from 'sonner';

interface StaffRow {
  id: string;
  user_id: string | null;
  employee_id: string;
  full_name: string;
  department: string | null;
  designation: string | null;
  is_active: boolean;
  attendance_tracked: boolean;
}

type Status = 'FD' | 'HD' | 'P' | 'Absent' | 'Leave';

interface DayCell {
  date: string;
  sessions: AttendanceSession[];
  firstIn: string | null;
  lastOut: string | null;
  worked: number;
  brk: number;
  status: Status;
  onLeave: boolean;
  late: boolean;
}

const FD_THRESHOLD = 8 * 60; // 8h
const HD_THRESHOLD = 4 * 60; // 4h

function deriveStatus(worked: number, hasSession: boolean, onLeave: boolean): Status {
  if (onLeave) return 'Leave';
  if (!hasSession) return 'Absent';
  if (worked >= FD_THRESHOLD) return 'FD';
  if (worked >= HD_THRESHOLD) return 'HD';
  return 'P';
}

function statusBadge(status: Status, late?: boolean) {
  const colors: Record<Status, string> = {
    FD: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    HD: 'bg-amber-100 text-amber-800 border-amber-200',
    P: 'bg-blue-100 text-blue-800 border-blue-200',
    Absent: 'bg-rose-100 text-rose-800 border-rose-200',
    Leave: 'bg-violet-100 text-violet-800 border-violet-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status}
      {late && <AlertTriangle className="h-3 w-3 text-amber-600" />}
    </span>
  );
}

const fmtTime = (iso: string | null): string => formatTime(iso);

export default function Attendance() {
  const { isOwner, isAdmin, isCA, isHR } = useAuth();
  const canView = isOwner || isAdmin || isCA || isHR;
  // Owners and admins can correct attendance; CA and HR only view (enforced in the database too).
  const canEdit = isOwner || isAdmin;

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayStr);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState<string>('all');
  

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [leaveDates, setLeaveDates] = useState<Set<string>>(new Set()); // `${staffId}|${date}`
  const [loading, setLoading] = useState(true);

  // All sessions of the tapped day cell; the drawer shows one at a time with previous/next.
  const [selectedDay, setSelectedDay] = useState<AttendanceSession[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selected = selectedDay[selectedIdx] ?? null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AttendanceEditTarget | null>(null);

  useEffect(() => {
    if (!canView) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [staffRes, sessRes, leaveRes] = await Promise.all([
        supabase.rpc('get_attendance_staff'),
        supabase
          .from('attendance_sessions' as never)
          .select('*')
          .gte('work_date', from)
          .lte('work_date', to)
          .order('check_in_at', { ascending: true }),
        supabase.rpc('get_attendance_leave_dates', { _date_from: from, _date_to: to }),
      ]);

      if (staffRes.error) throw staffRes.error;
      if (sessRes.error) throw sessRes.error;
      if (leaveRes.error) throw leaveRes.error;

      const activeStaff = ((staffRes.data as StaffRow[]) ?? [])
        .filter((member) => member.is_active && member.attendance_tracked)
        .sort((a, b) => b.employee_id.localeCompare(a.employee_id));
      setStaff(activeStaff);
      setSessions((sessRes.data as AttendanceSession[]) ?? []);
      const set = new Set<string>();
      (leaveRes.data ?? []).forEach((l: { staff_id: string; leave_date: string }) =>
        set.add(`${l.staff_id}|${l.leave_date}`),
      );
      setLeaveDates(set);
    } catch (e) {
      console.error('Attendance fetch error', e);
      toast.error('Failed to load attendance');
    } finally {
      setLoading(false);
    }
  };

  const departments = useMemo(() => {
    const ds = new Set<string>();
    staff.forEach((s) => s.department && ds.add(s.department));
    return Array.from(ds).sort();
  }, [staff]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) => {
      if (department !== 'all' && s.department !== department) return false;
      if (!q) return true;
      return (
        s.full_name.toLowerCase().includes(q) ||
        s.employee_id.toLowerCase().includes(q)
      );
    });
  }, [staff, department, search]);

  const dates = useMemo(() => {
    try {
      return eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map((d) =>
        format(d, 'yyyy-MM-dd'),
      );
    } catch {
      return [];
    }
  }, [from, to]);

  // Build staff×date map of aggregated DayCell
  const grid = useMemo(() => {
    const sessByStaff: Record<string, Record<string, AttendanceSession[]>> = {};
    sessions.forEach((s) => {
      const key = s.staff_id ?? s.user_id;
      if (!key) return;
      sessByStaff[key] ??= {};
      sessByStaff[key][s.work_date] ??= [];
      sessByStaff[key][s.work_date].push(s);
    });

    const out: Record<string, Record<string, DayCell>> = {};
    filteredStaff.forEach((st) => {
      out[st.id] = {};
      dates.forEach((d) => {
        const sList =
          sessByStaff[st.id]?.[d] ??
          (st.user_id ? sessByStaff[st.user_id]?.[d] : undefined) ??
          [];
        const sorted = [...sList].sort(
          (a, b) => new Date(a.check_in_at).getTime() - new Date(b.check_in_at).getTime(),
        );
        const worked = sorted.reduce((sum, s) => sum + (s.worked_minutes || 0), 0);
        const brk = sorted.reduce((sum, s) => sum + (s.total_break_minutes || 0), 0);
        const onLeave = leaveDates.has(`${st.id}|${d}`);
        const firstIn = sorted[0]?.check_in_at ?? null;
        const lastOut = [...sorted].reverse().find((s) => s.check_out_at)?.check_out_at ?? null;
        const late = sorted.some((s) => s.late_checkout);
        out[st.id][d] = {
          date: d,
          sessions: sorted,
          firstIn,
          lastOut,
          worked,
          brk,
          status: deriveStatus(worked, sorted.length > 0, onLeave),
          onLeave,
          late,
        };
      });
    });
    return out;
  }, [filteredStaff, dates, sessions, leaveDates]);

  // Flatten for daily detail view: one row per (staff × date)
  const dailyRows = useMemo(() => {
    const rows: Array<{ staff: StaffRow; cell: DayCell }> = [];
    filteredStaff.forEach((st) => {
      dates.forEach((d) => {
        const cell = grid[st.id]?.[d];
        if (cell) rows.push({ staff: st, cell });
      });
    });
    // Sort: latest date first, then employee id desc
    return rows.sort((a, b) => {
      if (a.cell.date !== b.cell.date) return a.cell.date < b.cell.date ? 1 : -1;
      return a.staff.employee_id < b.staff.employee_id ? 1 : -1;
    });
  }, [filteredStaff, dates, grid]);

  const stats = useMemo(() => {
    const todayRows = sessions.filter((r) => r.work_date === todayStr);
    return {
      checkedIn: todayRows.filter((r) => r.status === 'active').length,
      onBreak: todayRows.filter((r) => r.status === 'on_break').length,
      completed: todayRows.filter((r) => r.status === 'completed').length,
      absentToday: filteredStaff.filter((st) => {
        const c = grid[st.id]?.[todayStr];
        return c && c.status === 'Absent';
      }).length,
    };
  }, [sessions, filteredStaff, grid, todayStr]);

  const staffFor = (s: AttendanceSession) =>
    staff.find((m) => m.id === s.staff_id || (!!m.user_id && m.user_id === s.user_id));
  const staffNameFor = (s: AttendanceSession) => staffFor(s)?.full_name;

  const periodLabel = `${format(parseISO(from), 'dd MMM yyyy')} – ${format(parseISO(to), 'dd MMM yyyy')}`;

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Daily Detail sheet
    const detailHeaders = [
      'Employee ID',
      'Employee Name',
      'Department',
      'Designation',
      'Date',
      'Day',
      'First Punch',
      'Last Punch',
      'Total Working Hours',
      'Total Break Hours',
      'Status',
    ];
    const detailData = dailyRows.map(({ staff: st, cell }) => [
      st.employee_id,
      st.full_name,
      st.department ?? '',
      st.designation ?? '',
      format(parseISO(cell.date), 'dd-MM-yyyy'),
      format(parseISO(cell.date), 'EEEE'),
      fmtTime(cell.firstIn),
      fmtTime(cell.lastOut),
      formatMinutes(cell.worked),
      formatMinutes(cell.brk),
      cell.status + (cell.late ? ' (Forgot to check out)' : ''),
    ]);
    const ws1 = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailData]);
    XLSX.utils.book_append_sheet(wb, ws1, 'Daily Detail');

    // Matrix sheet
    const matrixHeaders = [
      'Employee ID',
      'Employee Name',
      'Department',
      'Designation',
      ...dates.map((d) => format(parseISO(d), 'dd-MM-yyyy')),
    ];
    const matrixData = filteredStaff.map((st) => [
      st.employee_id,
      st.full_name,
      st.department ?? '',
      st.designation ?? '',
      ...dates.map((d) => {
        const c = grid[st.id]?.[d];
        if (!c) return '-';
        if (c.status === 'Leave') return 'Leave';
        if (c.status === 'Absent') return 'A';
        const parts = [fmtTime(c.firstIn)];
        if (c.lastOut) parts.push(fmtTime(c.lastOut));
        return parts.join(' / ');
      }),
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([matrixHeaders, ...matrixData]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Date Matrix');

    XLSX.writeFile(wb, `Attendance_${from}_to_${to}.xlsx`);
    toast.success('Excel exported');
  };

  const handleExportPDF = () => {
    const doc = exportToPDF({
      title: 'Attendance Report — Daily Punch Detail',
      subtitle: department !== 'all' ? `Department: ${department}` : 'All Departments',
      headers: [
        'Emp ID',
        'Name',
        'Department',
        'Designation',
        ...dates.map((d) => format(parseISO(d), 'dd-MM')),
      ],
      data: filteredStaff.map((st) => [
        st.employee_id,
        st.full_name,
        st.department ?? '',
        st.designation ?? '',
        ...dates.map((d) => {
          const c = grid[st.id]?.[d];
          if (!c) return '-';
          if (c.status === 'Leave') return 'L';
          if (c.status === 'Absent') return 'A';
          const parts = [fmtTime(c.firstIn)];
          if (c.lastOut) parts.push(fmtTime(c.lastOut));
          return parts.join(' / ');
        }),
      ]),
      dateRange: { from: parseISO(from), to: parseISO(to) },
    });
    downloadPDF(doc, 'attendance_report');
    toast.success('PDF exported');
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">You don't have access to this page.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6 min-w-0 max-w-full overflow-x-hidden">
        <PageHeader
          title="Attendance"
          description="Analytical attendance report with daily detail and date-matrix views."
        />

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 min-w-0">
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
            title="Absent Today"
            value={stats.absentToday}
            subtitle="No check-in"
            icon={Users}
            color="pink"
          />
        </div>

        <Card className="max-w-full min-w-0 overflow-hidden rounded-2xl border-0 shadow-card">
          <CardContent className="min-w-0 p-4 md:p-6 space-y-4">
            {/* Filter bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3 lg:flex lg:flex-wrap">
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground">From</label>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full lg:w-[160px]"
                />
              </div>
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground">To</label>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full lg:w-[160px]"
                />
              </div>
              <div className="col-span-2 w-full lg:col-span-1 lg:w-[200px]">
                <label className="text-xs text-muted-foreground">Department</label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 min-w-0 flex-1 lg:col-span-1 lg:min-w-[200px]">
                <label className="text-xs text-muted-foreground">Search</label>
                <Input
                  placeholder="Name or Employee ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-2 lg:col-span-1 lg:flex lg:gap-3">
                <Button variant="outline" onClick={fetchAll} className="w-full gap-1.5 px-2 lg:w-auto lg:px-4">
                  <RefreshCw className="h-4 w-4 lg:hidden" /> Refresh
                </Button>
                <Button variant="outline" onClick={handleExportExcel} className="w-full gap-1.5 px-2 lg:w-auto lg:gap-2 lg:px-4">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span className="lg:hidden">Excel</span>
                  <span className="hidden lg:inline">Export Excel</span>
                </Button>
                <Button variant="outline" onClick={handleExportPDF} className="w-full gap-1.5 px-2 lg:w-auto lg:gap-2 lg:px-4">
                  <FileText className="h-4 w-4" />
                  <span className="lg:hidden">PDF</span>
                  <span className="hidden lg:inline">Export PDF</span>
                </Button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs">
              {(
                [
                  ['FD', 'Full Day (≥8h)'],
                  ['HD', 'Half Day (≥4h)'],
                  ['P', 'Present (<4h)'],
                  ['Absent', 'No check-in'],
                  ['Leave', 'Approved leave'],
                ] as const
              ).map(([st, label]) => (
                <span key={st} className="inline-flex items-center gap-1.5">
                  {statusBadge(st)}
                  <span className="text-muted-foreground">{label}</span>
                </span>
              ))}
              <span className="inline-flex items-center gap-1 self-center text-muted-foreground">
                <AlertTriangle className="h-3 w-3 text-amber-600" /> Forgot to check out
              </span>
            </div>

            <AttendanceMatrix
              loading={loading}
              staff={filteredStaff}
              dates={dates}
              grid={grid}
              onSelectSessions={(list) => {
                setSelectedDay(list);
                setSelectedIdx(0);
                setDrawerOpen(true);
              }}
              onAddAttendance={
                canEdit
                  ? (st, date) =>
                      setEditTarget({ staffId: st.id, staffName: st.full_name, workDate: date, session: null })
                  : undefined
              }
            />
            {canEdit && (
              <p className="mt-2 text-xs text-muted-foreground">
                Tap a time to see or edit a record. Tap an empty or "A" day to add attendance someone missed.
              </p>
            )}
          </CardContent>
        </Card>

        {!isHR && <PenaltiesPanel />}

        <SessionDetailsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          session={selected}
          staffName={selected ? staffNameFor(selected) : undefined}
          position={{
            index: selectedIdx,
            total: selectedDay.length,
            onPrev: () => setSelectedIdx((i) => Math.max(0, i - 1)),
            onNext: () => setSelectedIdx((i) => Math.min(selectedDay.length - 1, i + 1)),
          }}
          canEdit={canEdit}
          onEdit={(s) => {
            const st = staffFor(s);
            setDrawerOpen(false);
            setEditTarget({
              staffId: s.staff_id ?? st?.id ?? '',
              staffName: st?.full_name ?? 'Staff',
              workDate: s.work_date,
              session: s,
            });
          }}
          onDeleted={fetchAll}
        />

        <EditAttendanceDialog target={editTarget} onClose={() => setEditTarget(null)} onSaved={fetchAll} />
      </div>
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrix view (employees × dates) — image-1 layout, paginated 10 / page
// ─────────────────────────────────────────────────────────────────────────────

interface MatrixProps {
  loading: boolean;
  staff: StaffRow[];
  dates: string[];
  grid: Record<string, Record<string, DayCell>>;
  /** Called with every session of the tapped day (usually one). */
  onSelectSessions: (sessions: AttendanceSession[]) => void;
  /** Present for owners/admins: add attendance on an empty or absent day. */
  onAddAttendance?: (staff: StaffRow, date: string) => void;
}

function AttendanceMatrix({ loading, staff, dates, grid, onSelectSessions, onAddAttendance }: MatrixProps) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(staff.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = staff.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (staff.length === 0 || dates.length === 0) {
    return <div className="py-12 text-center text-muted-foreground">No records found.</div>;
  }

  const start = (safePage - 1) * PAGE_SIZE + 1;
  const end = Math.min(safePage * PAGE_SIZE, staff.length);

  return (
    <div className="space-y-3 min-w-0">
      <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border bg-card">
        <Table className="min-w-max table-auto">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="hidden w-[150px] min-w-[150px] whitespace-nowrap md:table-cell">Employee ID</TableHead>
              {/* Phones: name column stays pinned while the days scroll sideways. */}
              <TableHead className="sticky left-0 z-10 w-[124px] min-w-[124px] bg-muted shadow-[1px_0_0_hsl(var(--border))] md:static md:w-[180px] md:min-w-[180px] md:bg-transparent md:shadow-none whitespace-nowrap">
                <span className="md:hidden">Name</span>
                <span className="hidden md:inline">Employee Name</span>
              </TableHead>
              <TableHead className="hidden w-[150px] min-w-[150px] whitespace-nowrap md:table-cell">Department</TableHead>
              <TableHead className="hidden w-[160px] min-w-[160px] whitespace-nowrap md:table-cell">Designation</TableHead>
              {dates.map((d) => (
                <TableHead key={d} className="w-[110px] min-w-[110px] text-center whitespace-nowrap">
                  <div className="font-semibold">{format(parseISO(d), 'dd-MM-yyyy')}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {format(parseISO(d), 'EEEE')}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((st) => (
              <TableRow key={st.id} className="align-top">
                <TableCell className="hidden w-[150px] min-w-[150px] whitespace-nowrap font-medium md:table-cell">
                  {st.employee_id}
                </TableCell>
                <TableCell className="sticky left-0 z-10 w-[124px] min-w-[124px] bg-card shadow-[1px_0_0_hsl(var(--border))] md:static md:w-[180px] md:min-w-[180px] md:bg-transparent md:shadow-none md:whitespace-nowrap">
                  <div className="break-words font-medium md:font-normal">{st.full_name}</div>
                  <div className="text-xs text-muted-foreground md:hidden">{st.employee_id}</div>
                </TableCell>
                <TableCell className="hidden w-[150px] min-w-[150px] whitespace-nowrap text-muted-foreground md:table-cell">
                  {st.department ?? '—'}
                </TableCell>
                <TableCell className="hidden w-[160px] min-w-[160px] whitespace-nowrap text-muted-foreground md:table-cell">
                  {st.designation ?? '—'}
                </TableCell>
                {dates.map((d) => {
                  const c = grid[st.id]?.[d];
                  if (!c) {
                    return (
                      <TableCell key={d} className="w-[110px] min-w-[110px] text-center text-muted-foreground">
                        —
                      </TableCell>
                    );
                  }
                  const cellBg =
                    c.status === 'Absent'
                      ? 'bg-rose-50/60'
                      : c.status === 'Leave'
                        ? 'bg-violet-50/60'
                        : c.status === 'FD'
                          ? 'bg-emerald-50/60'
                          : c.status === 'HD'
                            ? 'bg-amber-50/60'
                            : c.sessions.length > 0
                              ? 'bg-amber-50/40'
                              : '';
                  const canAdd = !!onAddAttendance && c.sessions.length === 0 && d <= today;
                  const clickable = c.sessions.length > 0 || canAdd;
                  return (
                    <TableCell key={d} className={`w-[110px] min-w-[110px] text-center text-xs ${cellBg}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => {
                              if (c.sessions.length > 0) onSelectSessions(c.sessions);
                              else if (canAdd) onAddAttendance?.(st, d);
                            }}
                            className="w-full inline-flex flex-col items-center justify-center gap-0.5 disabled:cursor-default"
                          >
                            {c.status === 'Absent' ? (
                              <span className="font-semibold text-rose-700">A</span>
                            ) : c.status === 'Leave' ? (
                              <span className="font-semibold text-violet-700">L</span>
                            ) : (
                              <>
                                <span className="font-medium underline decoration-dotted underline-offset-2">
                                  {fmtTime(c.firstIn)}
                                </span>
                                {c.lastOut && (
                                  <span className="text-muted-foreground underline decoration-dotted underline-offset-2">
                                    {fmtTime(c.lastOut)}
                                  </span>
                                )}
                              </>
                            )}
                            {c.late && (
                              <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5" />
                            )}
                            {c.sessions.length > 1 && (
                              <span className="text-[10px] text-muted-foreground">
                                {c.sessions.length} sessions
                              </span>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            <div className="font-semibold">
                              {c.status}
                              {c.late && ' • Forgot to check out'}
                            </div>
                            {c.worked > 0 && <div>Worked: {formatMinutes(c.worked)}</div>}
                            {c.brk > 0 && <div>Break: {formatMinutes(c.brk)}</div>}
                            {c.sessions.length > 1 && (
                              <div>{c.sessions.length} sessions</div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="text-sm text-muted-foreground">
          Showing <span className="font-medium text-foreground">{start}</span> to{' '}
          <span className="font-medium text-foreground">{end}</span> of{' '}
          <span className="font-medium text-foreground">{staff.length}</span> Employees
        </div>
        <Pagination className="m-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={(e) => {
                  e.preventDefault();
                  setPage((p) => Math.max(1, p - 1));
                }}
                aria-disabled={safePage === 1}
                className={safePage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
              .map((p) => (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === safePage}
                    onClick={(e) => {
                      e.preventDefault();
                      setPage(p);
                    }}
                    className="cursor-pointer"
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ))}
            <PaginationItem>
              <PaginationNext
                onClick={(e) => {
                  e.preventDefault();
                  setPage((p) => Math.min(totalPages, p + 1));
                }}
                aria-disabled={safePage === totalPages}
                className={
                  safePage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}

