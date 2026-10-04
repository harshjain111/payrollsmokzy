import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addMonths, format, parseISO, subMonths } from 'date-fns';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Loader2, ShieldX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettleSalarySheet } from '@/components/settlements/SettleSalarySheet';
import { SettlementDetailsSheet } from '@/components/settlements/SettlementDetailsSheet';
import { PayrollRow, fetchPayrollMonth, payrollStatus } from '@/lib/payroll';

type Filter = 'all' | 'pending' | 'settled';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const thisMonth = () => format(new Date(), 'yyyy-MM');

function StatusBadge({ row }: { row: PayrollRow }) {
  switch (payrollStatus(row)) {
    case 'pending':
      return <Badge variant="outline">To settle</Badge>;
    case 'awaiting_payment':
      return <Badge variant="secondary">Settled · to pay</Badge>;
    case 'paid':
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">Paid</Badge>;
    case 'nothing_to_pay':
      return <Badge variant="secondary">Settled · ₹0</Badge>;
  }
}

export default function Settlements() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canAccessSettlements, isOwner } = useAuth();

  const [month, setMonth] = useState(
    searchParams.get('month') || format(subMonths(new Date(), 1), 'yyyy-MM'),
  );
  const [filter, setFilter] = useState<Filter>(
    searchParams.get('status') === 'pending' ? 'pending' : 'all',
  );
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [settleRow, setSettleRow] = useState<PayrollRow | null>(null);
  const [detailsRow, setDetailsRow] = useState<PayrollRow | null>(null);

  const load = async (opts?: { openStaffId?: string | null }) => {
    setLoading(true);
    try {
      const data = await fetchPayrollMonth(month);
      setRows(data);
      const target = opts?.openStaffId && data.find((r) => r.staff_id === opts.openStaffId);
      if (target) (target.settlement_id ? setDetailsRow : setSettleRow)(target);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load payroll');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canAccessSettlements) return;
    // Links like /settlements?staff=<id>&month=YYYY-MM open that person straight away.
    const staffParam = searchParams.get('staff');
    load({ openStaffId: staffParam });
    if (staffParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('staff');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, canAccessSettlements]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'pending' && r.settlement_id) return false;
      if (filter === 'settled' && !r.settlement_id) return false;
      return !q || r.full_name.toLowerCase().includes(q) || (r.employee_id ?? '').toLowerCase().includes(q);
    });
  }, [rows, filter, search]);

  const pending = rows.filter((r) => !r.settlement_id);
  const settledCount = rows.length - pending.length;
  const pendingEstimate = pending.reduce((s, r) => s + r.estimated_net, 0);
  const awaitingPayment = rows
    .filter((r) => payrollStatus(r) === 'awaiting_payment')
    .reduce((s, r) => s + Number(r.settled_balance_payable || 0), 0);

  if (!canAccessSettlements) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4 px-4">
        <ShieldX className="h-16 w-16 text-destructive" />
        <h2 className="text-xl font-semibold">Access denied</h2>
        <p className="max-w-md text-center text-muted-foreground">
          Salary settlements are restricted to the owner and admins.
        </p>
        <Button onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const monthLabel = format(parseISO(month + '-01'), 'MMMM yyyy');
  const atCurrentMonth = month >= thisMonth();

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Salary Settlement"
        description="Settle each staff member's salary for the month. Settled salaries go to Payouts to be paid."
      />

      <Card className="rounded-2xl border-0 shadow-card">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => setMonth(format(subMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="month"
              value={month}
              max={thisMonth()}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="min-w-0 flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              disabled={atCurrentMonth}
              onClick={() => setMonth(format(addMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted/50 p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Settled</p>
              <p className="text-lg font-bold">
                {settledCount}/{rows.length}
              </p>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">To settle (est.)</p>
              <p className="text-lg font-bold">{inr(pendingEstimate)}</p>
            </div>
            <div className="rounded-xl bg-primary/10 p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Waiting to pay</p>
              <p className="text-lg font-bold">{inr(awaitingPayment)}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="grid w-full grid-cols-3 sm:w-auto">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="pending">To settle ({pending.length})</TabsTrigger>
                <TabsTrigger value="settled">Settled</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input
              placeholder="Search staff…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading {monthLabel}…
        </div>
      ) : visible.length === 0 ? (
        filter === 'pending' && rows.length > 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={`Everyone is settled for ${monthLabel}`}
            description="Nothing left to settle this month."
          />
        ) : (
          <EmptyState icon={Users} title="No staff to show" description="Try another month or filter." />
        )
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((r) => {
            const settled = !!r.settlement_id;
            const joinedThisMonth = r.period_start > `${month}-01`;
            return (
              <Card key={r.staff_id} className="rounded-2xl border-0 shadow-card">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.employee_id} · {inr(r.monthly_salary)}/month
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold">
                        {inr(settled ? Number(r.settled_balance_payable) : r.estimated_net)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {settled ? 'to pay' : 'estimate'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge row={r} />
                    {!r.is_active && <Badge variant="destructive">Inactive</Badge>}
                    {joinedThisMonth && (
                      <Badge variant="outline">Joined {format(parseISO(r.period_start), 'd MMM')}</Badge>
                    )}
                    {!settled && r.system_leave_days > 0 && (
                      <Badge variant="outline">{r.system_leave_days} leave days</Badge>
                    )}
                    {!settled && r.discipline_fine > 0 && (
                      <Badge variant="outline">Fines {inr(r.discipline_fine)}</Badge>
                    )}
                    {r.advance_outstanding > 0 && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-700">
                        Advance {inr(r.advance_outstanding)}
                      </Badge>
                    )}
                  </div>

                  <Button
                    className="w-full"
                    variant={settled ? 'outline' : 'default'}
                    onClick={() => (settled ? setDetailsRow(r) : setSettleRow(r))}
                  >
                    {settled ? 'View settlement' : 'Settle salary'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SettleSalarySheet
        row={settleRow}
        month={month}
        isOwner={isOwner}
        onClose={() => setSettleRow(null)}
        onSettled={() => load()}
      />
      <SettlementDetailsSheet
        row={detailsRow}
        month={month}
        onClose={() => setDetailsRow(null)}
        onChanged={() => load()}
      />
    </div>
  );
}
