import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ChevronDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import {
  PAYOUT_MODES,
  PayoutMode,
  PayrollBase,
  PayrollRow,
  computeSettlement,
  fetchPayrollStaff,
  monthEndOf,
  paySalary,
  settleSalary,
} from '@/lib/payroll';

interface Props {
  row: PayrollRow | null;
  month: string;
  /** Whether this user can also pay the salary (owner or admin). */
  canPay: boolean;
  onClose: () => void;
  onSettled: () => void;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const inr2 = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const asNumber = (v: string) => (v === '' ? 0 : Number(v));

type Section = 'leave' | 'bonus' | 'deduction' | 'advance' | 'left' | 'note';

/** One optional adjustment: a tappable row that shows its current value and opens to edit. */
function AdjustRow({
  id,
  title,
  value,
  open,
  onToggle,
  highlight,
  children,
}: {
  id: Section;
  title: string;
  value: string;
  open: boolean;
  onToggle: (id: Section) => void;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border', highlight && 'border-amber-500/50 bg-amber-500/5')}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <span className="text-sm font-medium">{title}</span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="truncate">{value}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
}

export function SettleSalarySheet({ row, month, canPay, onClose, onSettled }: Props) {
  const isMobile = useIsMobile();
  const monthEnd = monthEndOf(month);
  const monthLabel = format(parseISO(month + '-01'), 'MMMM yyyy');

  const [base, setBase] = useState<PayrollBase | null>(null);
  const [loadingBase, setLoadingBase] = useState(false);
  const [open, setOpen] = useState<Set<Section>>(new Set());
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
  const [confirming, setConfirming] = useState<null | 'settle' | 'settle-pay'>(null);
  const [saving, setSaving] = useState(false);

  // Fresh form for every staff member opened.
  useEffect(() => {
    if (!row) return;
    setBase(row);
    setOpen(new Set());
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
    setConfirming(null);
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
  const net = result ? Math.max(0, result.net) : 0;
  const blocked = !result || result.errors.length > 0 || loadingBase || saving;
  const toggle = (id: Section) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const modeLabel = PAYOUT_MODES.find((m) => m.value === paymentMode)?.label ?? paymentMode;

  const submit = async (payNow: boolean) => {
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
      const amount = Number(res.net_payable);
      if (amount === 0) {
        toast.success(`${row.full_name}: settled — nothing to pay this month`);
      } else if (payNow) {
        try {
          await paySalary(res.settlement_id, paymentMode);
          toast.success(`${row.full_name}: settled and paid ${inr2(amount)} by ${modeLabel}`);
        } catch (e) {
          toast.error(
            `${row.full_name} is settled, but the payment was not recorded: ${e instanceof Error ? e.message : 'error'}. Tap Pay on their row to try again.`,
            { duration: 10000 },
          );
        }
      } else if (canPay) {
        toast.success(`${row.full_name}: settled — tap Pay when you hand over ${inr2(amount)}`);
      } else {
        toast.success(`${row.full_name}: settled — ${inr2(amount)} is waiting to be paid`);
      }
      setConfirming(null);
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
        className={cn('flex flex-col gap-0 p-0', isMobile ? 'max-h-[94vh] rounded-t-2xl' : 'w-full sm:max-w-lg')}
      >
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-5 sm:px-6">
          <SheetHeader className="text-left">
            <SheetTitle>
              {row.full_name} · {monthLabel}
            </SheetTitle>
            <SheetDescription>
              {inr(b.monthly_salary)}/month · {inr2(b.daily_rate)} per day
            </SheetDescription>
          </SheetHeader>

          {/* The answer first: what this person gets. */}
          {result && (
            <section className="mt-4 rounded-2xl bg-primary/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Salary to pay</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-primary">
                {inr2(net)}
                {loadingBase && <Loader2 className="ml-2 inline h-5 w-5 animate-spin align-middle" />}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {inr2(result.basePay)} for {result.payableDays} of {b.days_in_month} days
                {joinedThisMonth && ` (joined ${format(parseISO(b.period_start), 'd MMM')})`}
                {leftThisMonth && ` (last day ${format(parseISO(lastWorkingDate), 'd MMM')})`}
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {result.leaveDeduction > 0 && (
                  <li className="flex justify-between"><span className="text-muted-foreground">Leave ({inputs.leaveDays} {inputs.leaveDays === 1 ? 'day' : 'days'})</span><span className="text-destructive">− {inr2(result.leaveDeduction)}</span></li>
                )}
                {result.fine > 0 && (
                  <li className="flex justify-between"><span className="text-muted-foreground">Penalties</span><span className="text-destructive">− {inr2(result.fine)}</span></li>
                )}
                {result.bonus > 0 && (
                  <li className="flex justify-between"><span className="text-muted-foreground">Bonus / extra</span><span className="text-emerald-700">+ {inr2(result.bonus)}</span></li>
                )}
                {result.otherDeduction > 0 && (
                  <li className="flex justify-between"><span className="text-muted-foreground">Other deduction</span><span className="text-destructive">− {inr2(result.otherDeduction)}</span></li>
                )}
                {result.advanceRecovery > 0 && (
                  <li className="flex justify-between"><span className="text-muted-foreground">Advance recovered</span><span className="text-destructive">− {inr2(result.advanceRecovery)}</span></li>
                )}
              </ul>
              {b.advance_outstanding > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">Advance left after this: {inr2(result.advanceLeft)}</p>
              )}
            </section>
          )}

          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Change anything? (optional)
          </p>
          <div className="space-y-2">
            <AdjustRow
              id="leave"
              title="Unpaid leave"
              value={`${inputs.leaveDays} ${inputs.leaveDays === 1 ? 'day' : 'days'}${leaveChanged ? ' (changed)' : ''}`}
              open={open.has('leave') || (leaveChanged && !leaveReason.trim())}
              onToggle={toggle}
            >
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
              <p className="text-xs text-muted-foreground">From leave records: {b.system_leave_days} days</p>
              {leaveChanged && (
                <Textarea
                  rows={2}
                  aria-label="Reason the leave days differ from records"
                  placeholder="Why are the leave days different? (required)"
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                />
              )}
            </AdjustRow>

            <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">Penalties</p>
                <p className="text-xs text-muted-foreground">Waive one on the Penalties page, then refresh.</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
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
            </div>

            {b.advance_outstanding > 0 && (
              <AdjustRow
                id="advance"
                title="Recover advance"
                value={inputs.advanceRecovery > 0 ? inr2(inputs.advanceRecovery) : `${inr(b.advance_outstanding)} due`}
                open={open.has('advance')}
                onToggle={toggle}
                highlight
              >
                <Label htmlFor="advance-recovery">Recover from advance</Label>
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
              </AdjustRow>
            )}

            <AdjustRow
              id="bonus"
              title="Bonus / extra pay"
              value={inputs.bonus > 0 ? `+ ${inr2(inputs.bonus)}` : 'None'}
              open={open.has('bonus') || (inputs.bonus > 0 && !bonusNote.trim())}
              onToggle={toggle}
            >
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
              {inputs.bonus > 0 && (
                <Input
                  aria-label="What the bonus is for"
                  placeholder="What is it for? (required)"
                  value={bonusNote}
                  onChange={(e) => setBonusNote(e.target.value)}
                />
              )}
            </AdjustRow>

            <AdjustRow
              id="deduction"
              title="Other deduction"
              value={inputs.otherDeduction > 0 ? `− ${inr2(inputs.otherDeduction)}` : 'None'}
              open={open.has('deduction') || (inputs.otherDeduction > 0 && !otherDeductionNote.trim())}
              onToggle={toggle}
            >
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
              {inputs.otherDeduction > 0 && (
                <Input
                  aria-label="Reason for the other deduction"
                  placeholder="e.g. damage, uniform (required)"
                  value={otherDeductionNote}
                  onChange={(e) => setOtherDeductionNote(e.target.value)}
                />
              )}
            </AdjustRow>

            <AdjustRow
              id="left"
              title="Left the job this month"
              value={leftThisMonth ? `Last day ${format(parseISO(lastWorkingDate), 'd MMM')}` : 'No'}
              open={open.has('left')}
              onToggle={toggle}
            >
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="left-this-month">Left the job this month</Label>
                <Switch id="left-this-month" checked={leftThisMonth} onCheckedChange={setLeftThisMonth} />
              </div>
              {leftThisMonth && (
                <div className="space-y-1">
                  <Label htmlFor="last-working-day" className="text-xs text-muted-foreground">Last working day</Label>
                  <Input
                    id="last-working-day"
                    type="date"
                    value={lastWorkingDate}
                    min={b.period_start}
                    max={monthEnd}
                    onChange={(e) => e.target.value && setLastWorkingDate(e.target.value)}
                  />
                </div>
              )}
            </AdjustRow>

            <AdjustRow id="note" title="Note" value={notes.trim() ? 'Added' : 'None'} open={open.has('note')} onToggle={toggle}>
              <Label htmlFor="settle-notes">Note (optional)</Label>
              <Input id="settle-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember" />
            </AdjustRow>
          </div>

          {result && result.errors.length > 0 && (
            <ul className="mt-3 list-disc space-y-0.5 pl-4 text-xs text-destructive">
              {result.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Always-visible action bar */}
        <div className="border-t bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">
          {canPay && net > 0 && (
            <div className="mb-2 flex items-center gap-2">
              <Label htmlFor="settle-pay-by" className="shrink-0 text-sm text-muted-foreground">Pay by</Label>
              <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as PayoutMode)}>
                <SelectTrigger id="settle-pay-by" className="h-9">
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
          )}
          {canPay && net > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" disabled={blocked} onClick={() => setConfirming('settle')}>
                Settle only
              </Button>
              <Button size="lg" disabled={blocked} onClick={() => setConfirming('settle-pay')}>
                Settle & pay
              </Button>
            </div>
          ) : (
            <Button className="w-full" size="lg" disabled={blocked} onClick={() => setConfirming('settle')}>
              {net > 0 ? `Settle ${inr(net)}` : 'Settle (nothing to pay)'}
            </Button>
          )}
        </div>

        <AlertDialog open={confirming !== null} onOpenChange={(o) => !saving && !o && setConfirming(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirming === 'settle-pay'
                  ? `Pay ${inr2(net)} to ${row.full_name} by ${modeLabel}?`
                  : net > 0
                    ? `Settle ${inr2(net)} for ${row.full_name}?`
                    : `Settle ${row.full_name} with nothing to pay?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {monthLabel} salary will be locked and recorded in the books.
                {confirming === 'settle-pay'
                  ? ' The payment is recorded straight away and the staff member is notified.'
                  : net > 0
                    ? canPay
                      ? ' Tap Pay on their row when you hand over the money.'
                      : ' The owner or an admin pays it from Salary Settlement or Payouts.'
                    : ''}
                {confirming !== 'settle-pay' && ' You can undo it until the salary is paid.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Back</AlertDialogCancel>
              <AlertDialogAction
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  submit(confirming === 'settle-pay');
                }}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {confirming === 'settle-pay' ? 'Settle & pay' : 'Settle salary'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
