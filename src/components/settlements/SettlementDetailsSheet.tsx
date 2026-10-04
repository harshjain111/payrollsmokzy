import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import { PAYOUT_MODES, PayrollRow, payrollStatus, undoSettlement } from '@/lib/payroll';

interface SettlementRecord {
  id: string;
  base_salary: number;
  payable_days: number | null;
  leave_days: number | null;
  leave_deduction: number | null;
  deduction_adjustment_reason: string | null;
  discipline_fine: number;
  bonus_amount: number;
  bonus_note: string | null;
  other_deduction: number;
  other_deduction_note: string | null;
  net_salary: number;
  advances_adjusted: number | null;
  closing_advance_balance: number | null;
  balance_payable: number;
  payment_mode: string | null;
  notes: string | null;
  settled_at: string | null;
  paid_at: string | null;
}

interface Props {
  row: PayrollRow | null;
  month: string;
  onClose: () => void;
  onChanged: () => void;
}

const inr2 = (n: number | null | undefined) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function Line({ label, value, note, tone }: { label: string; value: string; note?: string | null; tone?: 'minus' | 'plus' }) {
  return (
    <div className="text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className={tone === 'minus' ? 'text-destructive' : tone === 'plus' ? 'text-emerald-700' : undefined}>
          {tone === 'minus' ? '− ' : tone === 'plus' ? '+ ' : ''}
          {value}
        </span>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export function SettlementDetailsSheet({ row, month, onClose, onChanged }: Props) {
  const isMobile = useIsMobile();
  const [record, setRecord] = useState<SettlementRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setRecord(null);
    setShowUndo(false);
    setReason('');
    if (!row?.settlement_id) return;
    setLoading(true);
    supabase
      .from('salary_settlements')
      .select('*')
      .eq('id', row.settlement_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error('Could not load the settlement');
        setRecord(data as unknown as SettlementRecord | null);
        setLoading(false);
      });
  }, [row]);

  if (!row) return null;
  const status = payrollStatus(row);
  const canUndo = status === 'awaiting_payment' || (status === 'nothing_to_pay' && !record?.paid_at);

  const undo = async () => {
    if (!row.settlement_id) return;
    setUndoing(true);
    try {
      await undoSettlement(row.settlement_id, reason.trim());
      toast.success(`${row.full_name}: settlement undone — you can settle again`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not undo');
    } finally {
      setUndoing(false);
    }
  };

  const modeLabel = PAYOUT_MODES.find((m) => m.value === record?.payment_mode)?.label;

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && !undoing && onClose()}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={isMobile ? 'max-h-[92vh] overflow-y-auto rounded-t-2xl' : 'w-full overflow-y-auto sm:max-w-lg'}
      >
        <SheetHeader className="text-left">
          <SheetTitle>
            {row.full_name} · {format(parseISO(month + '-01'), 'MMMM yyyy')}
          </SheetTitle>
          <SheetDescription>
            {record?.settled_at && `Settled on ${format(parseISO(record.settled_at), 'd MMM yyyy')}`}
            {modeLabel && ` · ${modeLabel}`}
          </SheetDescription>
        </SheetHeader>

        {loading || !record ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              {status === 'paid' && <Badge className="bg-emerald-600">Paid</Badge>}
              {status === 'awaiting_payment' && <Badge variant="secondary">Waiting for payment in Payouts</Badge>}
              {status === 'nothing_to_pay' && <Badge variant="outline">Nothing to pay</Badge>}
            </div>

            <section className="space-y-2 rounded-xl bg-muted/40 p-4">
              <Line
                label={`Salary${record.payable_days ? ` for ${record.payable_days} days` : ''}`}
                value={inr2(record.base_salary)}
              />
              {Number(record.leave_deduction) > 0 && (
                <Line
                  label={`Leave (${record.leave_days} days)`}
                  value={inr2(record.leave_deduction)}
                  note={record.deduction_adjustment_reason}
                  tone="minus"
                />
              )}
              {Number(record.discipline_fine) > 0 && (
                <Line label="Penalties" value={inr2(record.discipline_fine)} tone="minus" />
              )}
              {Number(record.bonus_amount) > 0 && (
                <Line label="Bonus / incentive" value={inr2(record.bonus_amount)} note={record.bonus_note} tone="plus" />
              )}
              {Number(record.other_deduction) > 0 && (
                <Line
                  label="Other deduction"
                  value={inr2(record.other_deduction)}
                  note={record.other_deduction_note}
                  tone="minus"
                />
              )}
              <Separator />
              <Line label="Salary earned" value={inr2(record.net_salary)} />
              {Number(record.advances_adjusted) > 0 && (
                <Line label="Advance recovered" value={inr2(record.advances_adjusted)} tone="minus" />
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="font-semibold">{status === 'paid' ? 'Paid' : 'To pay'}</span>
                <span className="text-lg font-bold text-primary">{inr2(record.balance_payable)}</span>
              </div>
              {Number(record.closing_advance_balance) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Advance still outstanding: {inr2(record.closing_advance_balance)}
                </p>
              )}
              {record.notes && <p className="text-xs text-muted-foreground">Note: {record.notes}</p>}
            </section>

            {canUndo && !showUndo && (
              <Button variant="outline" className="w-full gap-2" onClick={() => setShowUndo(true)}>
                <Undo2 className="h-4 w-4" /> Undo settlement
              </Button>
            )}
            {canUndo && showUndo && (
              <section className="space-y-2 rounded-xl border border-destructive/30 p-4">
                <Label>Why undo? (required)</Label>
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Forgot the overtime bonus"
                />
                <p className="text-xs text-muted-foreground">
                  The payout is withdrawn, the accounting entry is reversed, and the month's leave
                  records can be edited again. Then settle again.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={() => setShowUndo(false)} disabled={undoing}>
                    Back
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={!reason.trim() || undoing}
                    onClick={undo}
                  >
                    {undoing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Undo settlement
                  </Button>
                </div>
              </section>
            )}
            {status === 'paid' && (
              <p className="text-xs text-muted-foreground">
                This salary has been paid, so the settlement can no longer be undone.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
