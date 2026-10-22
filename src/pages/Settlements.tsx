import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettleSalarySheet } from '@/components/settlements/SettleSalarySheet';
import { SettlementDetailsSheet } from '@/components/settlements/SettlementDetailsSheet';
import {
  PAYOUT_MODES,
  PayoutMode,
  PayrollRow,
  fetchPayrollMonth,
  paySalary,
  payrollStatus,
  settleSalary,
} from '@/lib/payroll';

type Filter = 'pending' | 'topay' | 'done' | 'all';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const thisMonth = () => format(new Date(), 'yyyy-MM');
const owed = (r: PayrollRow) => Number(r.settled_balance_payable || 0);

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

function ModeSelect({ id, value, onChange }: { id: string; value: PayoutMode; onChange: (m: PayoutMode) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PayoutMode)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAYOUT_MODES.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function Settlements() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canAccessSettlements, canRecordSalaryPayments: canPay } = useAuth();

  const [month, setMonth] = useState(
    searchParams.get('month') || format(subMonths(new Date(), 1), 'yyyy-MM'),
  );
  const [filter, setFilter] = useState<Filter>('pending');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [settleRow, setSettleRow] = useState<PayrollRow | null>(null);
  const [detailsRow, setDetailsRow] = useState<PayrollRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Pay one settled salary.
  const [payRow, setPayRow] = useState<PayrollRow | null>(null);
  const [payMode, setPayMode] = useState<PayoutMode>('cash');
  const [paying, setPaying] = useState(false);

  // Settle (and optionally pay) everyone selected.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPay, setBulkPay] = useState(false);
  const [bulkMode, setBulkMode] = useState<PayoutMode>('cash');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkFailures, setBulkFailures] = useState<string[]>([]);

  // Only the latest request may update the screen (switching months quickly must not
  // show an older month's rows under the new month's title).
  const loadSeq = useRef(0);

  const load = async (opts?: { openStaffId?: string | null; pickFilter?: boolean }) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const data = await fetchPayrollMonth(month);
      if (seq !== loadSeq.current) return;
      setRows(data);
      setSelected((prev) => new Set([...prev].filter((id) => data.some((r) => r.staff_id === id && !r.settlement_id))));
      if (opts?.pickFilter) {
        // Open on the step that still has work: settle first, then pay.
        const status = searchParams.get('status');
        if (status === 'pending') setFilter('pending');
        else if (data.some((r) => !r.settlement_id)) setFilter('pending');
        else if (data.some((r) => payrollStatus(r) === 'awaiting_payment')) setFilter('topay');
        else setFilter('all');
      }
      const target = opts?.openStaffId && data.find((r) => r.staff_id === opts.openStaffId);
      if (target) (target.settlement_id ? setDetailsRow : setSettleRow)(target);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      toast.error(e instanceof Error ? e.message : 'Could not load payroll');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!canAccessSettlements) return;
    // Links like /settlements?staff=<id>&month=YYYY-MM open that person straight away.
    const staffParam = searchParams.get('staff');
    setRows([]); // never show the previous month's rows/totals for the new month
    setSelected(new Set());
    load({ openStaffId: staffParam, pickFilter: true });
    if (staffParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('staff');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, canAccessSettlements]);

  const pending = rows.filter((r) => !r.settlement_id);
  const toPay = rows.filter((r) => payrollStatus(r) === 'awaiting_payment');
  const done = rows.filter((r) => ['paid', 'nothing_to_pay'].includes(payrollStatus(r)));
  const pendingEstimate = pending.reduce((s, r) => s + r.estimated_net, 0);
  const awaitingPayment = toPay.reduce((s, r) => s + owed(r), 0);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = filter === 'pending' ? pending : filter === 'topay' ? toPay : filter === 'done' ? done : rows;
    return list.filter((r) => !q || r.full_name.toLowerCase().includes(q) || (r.employee_id ?? '').toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, search]);

  const visiblePending = visible.filter((r) => !r.settlement_id);
  const allVisibleSelected = visiblePending.length > 0 && visiblePending.every((r) => selected.has(r.staff_id));
  const selectedRows = rows.filter((r) => selected.has(r.staff_id) && !r.settlement_id);
  const selectedTotal = selectedRows.reduce((s, r) => s + r.estimated_net, 0);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visiblePending.forEach((r) => next.delete(r.staff_id));
      else visiblePending.forEach((r) => next.add(r.staff_id));
      return next;
    });

  const payOne = async () => {
    if (!payRow?.settlement_id) return;
    setPaying(true);
    try {
      await paySalary(payRow.settlement_id, payMode);
      toast.success(`Paid ${inr(owed(payRow))} to ${payRow.full_name}`);
      setPayRow(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  const runBulk = async () => {
    setBulkRunning(true);
    setBulkDone(0);
    setBulkFailures([]);
    const failures: string[] = [];
    let ok = 0;
    for (const r of selectedRows) {
      try {
        // Leave from records, penalties applied, no bonus / deduction / advance recovery.
        const res = await settleSalary({
          staffId: r.staff_id,
          month,
          leaveDays: Number(r.system_leave_days),
          leaveReason: '',
          bonus: 0,
          bonusNote: '',
          otherDeduction: 0,
          otherDeductionNote: '',
          advanceRecovery: 0,
          lastWorkingDate: null,
          paymentMode: bulkMode,
          notes: '',
        });
        if (bulkPay && Number(res.net_payable) > 0) {
          try {
            await paySalary(res.settlement_id, bulkMode);
          } catch (e) {
            failures.push(`${r.full_name}: settled, but not paid — ${e instanceof Error ? e.message : 'error'}`);
          }
        }
        ok += 1;
      } catch (e) {
        failures.push(`${r.full_name}: ${e instanceof Error ? e.message : 'could not settle'}`);
      }
      setBulkDone((n) => n + 1);
    }
    setBulkFailures(failures);
    setBulkRunning(false);
    setSelected(new Set());
    await load();
    if (failures.length === 0) {
      toast.success(`${ok} salar${ok === 1 ? 'y' : 'ies'} ${bulkPay ? 'settled and paid' : 'settled'}`);
      setBulkOpen(false);
    } else {
      toast.error(`${failures.length} could not be completed — see the list`);
    }
  };

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
    <div className={`space-y-4 md:space-y-6 ${selectedRows.length > 0 ? 'pb-28' : ''}`}>
      <PageHeader
        title="Salary Settlement"
        description={canPay ? 'Settle each month’s salary, then pay it — all from this page.' : 'Settle each month’s salary.'}
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
              aria-label="Month"
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

          {/* Step 1 → Step 2 → Done */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="min-w-0 rounded-xl bg-amber-500/10 px-1 py-2 sm:p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">1 · To settle</p>
              <p className="whitespace-nowrap text-sm font-bold tabular-nums sm:text-lg">{pending.length}</p>
              <p className="truncate text-[10px] text-muted-foreground">{inr(pendingEstimate)} est.</p>
            </div>
            <div className="min-w-0 rounded-xl bg-primary/10 px-1 py-2 sm:p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">2 · To pay</p>
              <p className="whitespace-nowrap text-sm font-bold tabular-nums sm:text-lg">{toPay.length}</p>
              <p className="truncate text-[10px] text-muted-foreground">{inr(awaitingPayment)}</p>
            </div>
            <div className="min-w-0 rounded-xl bg-emerald-500/10 px-1 py-2 sm:p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Done</p>
              <p className="whitespace-nowrap text-sm font-bold tabular-nums sm:text-lg">
                {done.length}/{rows.length}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">paid or ₹0</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="grid w-full grid-cols-4 sm:w-auto">
                <TabsTrigger value="pending">To settle ({pending.length})</TabsTrigger>
                <TabsTrigger value="topay">To pay ({toPay.length})</TabsTrigger>
                <TabsTrigger value="done">Done</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
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

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading {monthLabel}…
        </div>
      ) : visible.length === 0 ? (
        filter === 'pending' && rows.length > 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={`Everyone is settled for ${monthLabel}`}
            description={toPay.length > 0 ? `${toPay.length} still to pay — open the "To pay" tab.` : 'Nothing left to settle this month.'}
          />
        ) : filter === 'topay' && rows.length > 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing waiting to be paid" description="Settled salaries appear here until they are paid." />
        ) : (
          <EmptyState icon={Users} title="No staff to show" description="Try another month or filter." />
        )
      ) : (
        <Card className="overflow-hidden rounded-2xl border-0 shadow-card">
          {visiblePending.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
              <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} aria-label="Select everyone to settle" />
                Select all to settle ({visiblePending.length})
              </label>
              {selected.size > 0 && (
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              )}
            </div>
          )}
          <ul className="divide-y">
            {visible.map((r) => {
              const status = payrollStatus(r);
              const settled = !!r.settlement_id;
              const joinedThisMonth = r.period_start > `${month}-01`;
              return (
                <li key={r.staff_id} className="flex items-center gap-3 px-4 py-3">
                  {!settled ? (
                    <Checkbox
                      checked={selected.has(r.staff_id)}
                      onCheckedChange={() => toggleOne(r.staff_id)}
                      aria-label={`Select ${r.full_name}`}
                    />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => (settled ? setDetailsRow(r) : setSettleRow(r))}
                  >
                    <p className="truncate font-medium">{r.full_name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <StatusBadge row={r} />
                      {!r.is_active && <Badge variant="destructive">Inactive</Badge>}
                      {joinedThisMonth && (
                        <Badge variant="outline">Joined {format(parseISO(r.period_start), 'd MMM')}</Badge>
                      )}
                      {!settled && r.system_leave_days > 0 && (
                        <Badge variant="outline">{r.system_leave_days} leave {Number(r.system_leave_days) === 1 ? 'day' : 'days'}</Badge>
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
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <p className="text-base font-bold tabular-nums">{inr(settled ? owed(r) : r.estimated_net)}</p>
                    {!settled ? (
                      <Button size="sm" onClick={() => setSettleRow(r)}>
                        Settle salary
                      </Button>
                    ) : status === 'awaiting_payment' && canPay ? (
                      <Button size="sm" onClick={() => { setPayMode('cash'); setPayRow(r); }}>
                        Pay
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setDetailsRow(r)}>
                        View settlement
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Bulk action bar */}
      {selectedRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 md:bottom-4 md:left-auto md:right-6 md:w-[420px] md:px-0">
          <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-lg">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{selectedRows.length} selected</p>
              <p className="text-xs text-muted-foreground">≈ {inr(selectedTotal)} to pay</p>
            </div>
            <Button onClick={() => { setBulkFailures([]); setBulkDone(0); setBulkOpen(true); }}>
              Settle {selectedRows.length}
            </Button>
          </div>
        </div>
      )}

      <SettleSalarySheet
        row={settleRow}
        month={month}
        canPay={canPay}
        onClose={() => setSettleRow(null)}
        onSettled={() => load()}
      />
      <SettlementDetailsSheet
        row={detailsRow}
        month={month}
        onClose={() => setDetailsRow(null)}
        onChanged={() => load()}
      />

      {/* Pay one */}
      <Dialog open={!!payRow} onOpenChange={(o) => !o && !paying && setPayRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay {payRow ? inr(owed(payRow)) : ''} to {payRow?.full_name}</DialogTitle>
            <DialogDescription>{monthLabel} salary. The staff member is notified and the books are updated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="pay-one-mode">Paid by</Label>
            <ModeSelect id="pay-one-mode" value={payMode} onChange={setPayMode} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayRow(null)} disabled={paying}>Back</Button>
            <Button onClick={payOne} disabled={paying}>
              {paying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark as paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settle (and pay) many */}
      <Dialog open={bulkOpen} onOpenChange={(o) => !o && !bulkRunning && setBulkOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Settle {selectedRows.length || bulkDone} salaries for {monthLabel}</DialogTitle>
            <DialogDescription>
              Each uses the leave from records and this month’s penalties, with no bonus, extra deduction or advance
              recovery. To change anything for someone, settle them on their own instead.
            </DialogDescription>
          </DialogHeader>

          {!bulkRunning && bulkFailures.length === 0 && (
            <div className="space-y-3">
              <div className="flex justify-between rounded-xl bg-muted/50 p-3 text-sm">
                <span>Total to pay (approx.)</span>
                <span className="font-bold">{inr(selectedTotal)}</span>
              </div>
              {canPay && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
                  <Checkbox checked={bulkPay} onCheckedChange={(v) => setBulkPay(v === true)} aria-label="Also mark them as paid now" />
                  <span className="text-sm">
                    <span className="font-medium">Also mark them as paid now</span>
                    <span className="block text-xs text-muted-foreground">Only if you are handing over the money today.</span>
                  </span>
                </label>
              )}
              {canPay && bulkPay && (
                <div className="space-y-1">
                  <Label htmlFor="bulk-mode">Paid by</Label>
                  <ModeSelect id="bulk-mode" value={bulkMode} onChange={setBulkMode} />
                </div>
              )}
            </div>
          )}

          {bulkRunning && (
            <div className="flex items-center gap-2 py-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Working… {bulkDone} of {selectedRows.length} done
            </div>
          )}

          {!bulkRunning && bulkFailures.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm">These need attention (open the person to fix):</p>
              <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-destructive">
                {bulkFailures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            {bulkFailures.length > 0 ? (
              <Button onClick={() => setBulkOpen(false)}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkRunning}>Back</Button>
                <Button onClick={runBulk} disabled={bulkRunning || selectedRows.length === 0}>
                  {bulkRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {canPay && bulkPay ? 'Settle & pay all' : 'Settle all'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
