import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  PAYOUT_MODES,
  PayoutMode,
  PayrollBase,
  PayrollRow,
  computeSettlement,
  fetchPayrollStaff,
  monthEndOf,
  settleSalary,
} from '@/lib/payroll';

interface Props {
  row: PayrollRow | null;
  month: string;
  /** Owners pay salaries themselves in Payouts; admins hand over to the owner. */
  isOwner: boolean;
  onClose: () => void;
  onSettled: () => void;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const inr2 = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const asNumber = (v: string) => (v === '' ? 0 : Number(v));

function Line({ label, value, tone, bold }: { label: string; value: string; tone?: 'minus' | 'plus'; bold?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span
        className={
          tone === 'minus' ? 'text-destructive' : tone === 'plus' ? 'text-emerald-700' : undefined
        }
      >
        {tone === 'minus' ? '− ' : tone === 'plus' ? '+ ' : ''}
        {value}
      </span>
    </div>
  );
}

export function SettleSalarySheet({ row, month, isOwner, onClose, onSettled }: Props) {
  const isMobile = useIsMobile();
  const monthEnd = monthEndOf(month);
  const monthLabel = format(parseISO(month + '-01'), 'MMMM yyyy');

  const [base, setBase] = useState<PayrollBase | null>(null);
  const [loadingBase, setLoadingBase] = useState(false);
  const [leftThisMonth, setLeftThisMonth] = useState(false);
  const [lastWorkingDate, setLastWorkingDate] = useState(monthEnd);
  const [leaveDays, setLeaveDays] = useState('0');
  const [leaveTouched, setLeaveTouched] = useState(false);
  const [leaveReason, setLeaveReason] = useState('');
  const [bonus, setBonus] = useState('');
  const [bonusNote, setBonusNote] = useState('');
  const [otherDeduction, setOtherDeduction] = useState('');
  const [otherDeductionNote, setOtherDeductionNote] = useState('');
  const [advanceRecovery, setAdvanceRecovery] = useState('');
  const [paymentMode, setPaymentMode] = useState<PayoutMode>('cash');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fresh form for every staff member opened.
  useEffect(() => {
    if (!row) return;
    setBase(row);
    setLeftThisMonth(false);
    setLastWorkingDate(monthEnd);
    setLeaveDays(String(row.system_leave_days));
    setLeaveTouched(false);
    setLeaveReason('');
    setBonus('');
    setBonusNote('');
    setOtherDeduction('');
    setOtherDeductionNote('');
    setAdvanceRecovery('');
    setPaymentMode('cash');
    setNotes('');
    setConfirming(false);
  }, [row, monthEnd]);

  const reloadBase = async (lwd: string | null) => {
    if (!row) return;
    setLoadingBase(true);
    try {
      const fresh = await fetchPayrollStaff(row.staff_id, month, lwd);
      setBase(fresh);
      if (!leaveTouched) setLeaveDays(String(fresh.system_leave_days));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not recalculate');
    } finally {
      setLoadingBase(false);
    }
  };

  // Leaving mid-month changes the days paid, and which leaves and fines count.
  useEffect(() => {
    if (!row) return;
    if (leftThisMonth && lastWorkingDate) reloadBase(lastWorkingDate);
    else if (!leftThisMonth) reloadBase(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftThisMonth, lastWorkingDate]);

  const inputs = {
    leaveDays: asNumber(leaveDays),
    leaveReason,
    bonus: asNumber(bonus),
    bonusNote,
    otherDeduction: asNumber(otherDeduction),
    otherDeductionNote,
    advanceRecovery: asNumber(advanceRecovery),
  };
  const result = useMemo(() => (base ? computeSettlement(base, inputs) : null), [base, leaveDays, leaveReason, bonus, bonusNote, otherDeduction, otherDeductionNote, advanceRecovery]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null;
  const b = base ?? row;
  const joinedThisMonth = b.period_start > `${month}-01`;
  const leaveChanged = inputs.leaveDays !== Number(b.system_leave_days);

  const submit = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const res = await settleSalary({
        staffId: row.staff_id,
        month,
        lastWorkingDate: leftThisMonth ? lastWorkingDate : null,
        paymentMode,
        notes,
        ...inputs,
      });
      const net = Number(res.net_payable);
      if (net === 0) toast.success(`${row.full_name}: settled — nothing to pay this month`);
      else if (isOwner) toast.success(`${row.full_name}: settled — pay ${inr2(net)} from Payouts`);
      else toast.success(`${row.full_name}: settled — ${inr2(net)} is waiting for the owner in Payouts`);
      setConfirming(false);
      onSettled();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Settlement failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && !saving && onClose()}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={isMobile ? 'max-h-[92vh] overflow-y-auto rounded-t-2xl' : 'w-full overflow-y-auto sm:max-w-lg'}
      >
        <SheetHeader className="text-left">
          <SheetTitle>
            Settle {row.full_name} · {monthLabel}
          </SheetTitle>
          <SheetDescription>
            Monthly salary {inr(b.monthly_salary)} · {inr2(b.daily_rate)} per day
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Days */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="left-this-month" className="font-medium">
                Left the job this month
              </Label>
              <Switch id="left-this-month" checked={leftThisMonth} onCheckedChange={setLeftThisMonth} />
            </div>
            {leftThisMonth && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Last working day</Label>
                <Input
                  type="date"
                  value={lastWorkingDate}
                  min={b.period_start}
                  max={monthEnd}
                  onChange={(e) => e.target.value && setLastWorkingDate(e.target.value)}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Paid for {b.payable_days} of {b.days_in_month} days
              {joinedThisMonth && ` (joined ${format(parseISO(b.period_start), 'd MMM')})`}
              {leftThisMonth && ` (last day ${format(parseISO(lastWorkingDate), 'd MMM')})`}
              {loadingBase && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
            </p>
          </section>

          <Separator />

          {/* Leave */}
          <section className="space-y-2">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="leave-days">Unpaid leave days</Label>
                <Input
                  id="leave-days"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  value={leaveDays}
                  onChange={(e) => {
                    setLeaveTouched(true);
                    setLeaveDays(e.target.value);
                  }}
                />
              </div>
              <p className="pb-2 text-xs text-muted-foreground">
                From leave records: {b.system_leave_days}
              </p>
            </div>
            {leaveChanged && (
              <Textarea
                rows={2}
                placeholder="Why are the leave days different? (required)"
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
              />
            )}
          </section>

          {/* Fines */}
          <section className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
            <div>
              <p className="text-sm font-medium">Penalties this month</p>
              <p className="text-xs text-muted-foreground">
                Cancel a penalty on the Penalties page, then refresh.
              </p>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold text-destructive">{inr2(b.discipline_fine)}</span>
              <Button asChild size="icon" variant="ghost" aria-label="Open penalties">
                <a href="/penalties" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Refresh penalties"
                onClick={() => reloadBase(leftThisMonth ? lastWorkingDate : null)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </section>

          {/* Bonus / other deduction */}
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="bonus">Bonus / incentive / overtime</Label>
              <Input
                id="bonus"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="₹0"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
              />
              {asNumber(bonus) > 0 && (
                <Input
                  placeholder="What is it for? (required)"
                  value={bonusNote}
                  onChange={(e) => setBonusNote(e.target.value)}
                />
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="other-deduction">Other deduction</Label>
              <Input
                id="other-deduction"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="₹0"
                value={otherDeduction}
                onChange={(e) => setOtherDeduction(e.target.value)}
              />
              {asNumber(otherDeduction) > 0 && (
                <Input
                  placeholder="e.g. damage, uniform (required)"
                  value={otherDeductionNote}
                  onChange={(e) => setOtherDeductionNote(e.target.value)}
                />
              )}
            </div>
          </section>

          {/* Advance */}
          {b.advance_outstanding > 0 && (
            <section className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="advance-recovery">Recover from advance</Label>
                <span className="text-xs text-muted-foreground">
                  Outstanding {inr2(b.advance_outstanding)}
                </span>
              </div>
              <Input
                id="advance-recovery"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="₹0"
                value={advanceRecovery}
                onChange={(e) => setAdvanceRecovery(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setAdvanceRecovery('')}>
                  None
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!result || result.maxRecovery <= 0}
                  onClick={() => result && setAdvanceRecovery(String(result.maxRecovery))}
                >
                  Maximum {result ? inr(result.maxRecovery) : ''}
                </Button>
              </div>
            </section>
          )}

          {/* Payment */}
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Pay by</Label>
              <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as PayoutMode)}>
                <SelectTrigger>
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
            </div>
            <div className="space-y-1">
              <Label htmlFor="settle-notes">Note (optional)</Label>
              <Input id="settle-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember" />
            </div>
          </section>

          {/* Breakdown */}
          {result && (
            <section className="space-y-2 rounded-xl bg-primary/5 p-4">
              <Line label={`Salary for ${result.payableDays} days`} value={inr2(result.basePay)} />
              {result.leaveDeduction > 0 && (
                <Line label={`Leave (${inputs.leaveDays} days)`} value={inr2(result.leaveDeduction)} tone="minus" />
              )}
              {result.fine > 0 && <Line label="Penalties" value={inr2(result.fine)} tone="minus" />}
              {result.bonus > 0 && <Line label="Bonus / incentive" value={inr2(result.bonus)} tone="plus" />}
              {result.otherDeduction > 0 && (
                <Line label="Other deduction" value={inr2(result.otherDeduction)} tone="minus" />
              )}
              <Separator />
              <Line label="Salary earned" value={inr2(result.gross)} bold />
              {result.advanceRecovery > 0 && (
                <Line label="Advance recovered" value={inr2(result.advanceRecovery)} tone="minus" />
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-base font-semibold">To pay</span>
                <span className="text-xl font-bold text-primary">{inr2(Math.max(0, result.net))}</span>
              </div>
              {b.advance_outstanding > 0 && (
                <p className="text-xs text-muted-foreground">
                  Advance left after this: {inr2(result.advanceLeft)}
                </p>
              )}
              {result.errors.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-destructive">
                  {result.errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={!result || result.errors.length > 0 || loadingBase || saving}
            onClick={() => setConfirming(true)}
          >
            Review & settle
          </Button>
        </div>

        <AlertDialog open={confirming} onOpenChange={(o) => !saving && setConfirming(o)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {result && result.net > 0
                  ? `Settle ${inr2(result.net)} for ${row.full_name}?`
                  : `Settle ${row.full_name} with nothing to pay?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {monthLabel} salary will be locked and recorded in the books.
                {result && result.net > 0 &&
                  (isOwner
                    ? ' The payment then appears in Payouts for you to pay.'
                    : ' The payment then appears in Payouts for the owner to pay.')}{' '}
                You can undo it until the salary is paid.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Back</AlertDialogCancel>
              <AlertDialogAction
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Settle salary
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
