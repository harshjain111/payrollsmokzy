import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Ban, CalendarCheck, Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DisciplineLogRow } from '@/lib/discipline';
import { adjustAbsenceDeduction, markDayAsLeave } from '@/lib/deductions';

export interface PenaltyTarget extends DisciplineLogRow {
  staff_name?: string;
  staff_phone?: string | null;
}

export type PenaltyAction = 'cancel' | 'restore' | 'leave' | 'days';

const CUT_OPTIONS = ['0.5', '1', '1.5', '2', '3'];

interface Props {
  target: PenaltyTarget | null;
  mode: PenaltyAction;
  onClose: () => void;
  /** Called after a successful waive or restore, e.g. to reload the list. */
  onDone: () => void | Promise<void>;
}

/**
 * Waive or restore a single penalty, mark an absence as approved leave, or change how many days
 * of salary an absence cuts. Shared by the Penalties page and Attendance → Manage Penalties.
 * A waiver needs a reason, notifies the staff member on WhatsApp when a phone number is known,
 * and is written to the audit log by a database trigger. Only owners and admins can change
 * penalties (enforced by RLS and the database functions).
 */
export function PenaltyActionDialog({ target, mode, onClose, onDone }: Props) {
  const { user, staffData } = useAuth();
  const [reason, setReason] = useState('');
  const [leavePaid, setLeavePaid] = useState('paid');
  const [cutDays, setCutDays] = useState('1');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setReason('');
    setLeavePaid('paid');
    setCutDays(target?.deduction_days && Number(target.deduction_days) > 1 ? '1' : '2');
  }, [target, mode]);

  const submit = async () => {
    if (!target) return;
    if ((mode === 'cancel' || mode === 'days') && !reason.trim()) {
      toast.error('Please enter a reason');
      return;
    }
    setWorking(true);
    try {
      if (mode === 'leave') {
        await markDayAsLeave({
          staffId: target.staff_id,
          date: target.work_date,
          paid: leavePaid === 'paid',
          remarks: reason.trim(),
          userId: user?.id ?? null,
        });
        toast.success(
          leavePaid === 'paid'
            ? `${target.staff_name ?? 'Staff'} marked on leave — no salary cut for this day`
            : `${target.staff_name ?? 'Staff'} marked on unpaid leave — 1 day cut instead of the penalty`,
        );
        onClose();
        await onDone();
        return;
      }
      if (mode === 'days') {
        const r = await adjustAbsenceDeduction(target.id, Number(cutDays), reason.trim());
        toast.success(`Salary cut changed to ${cutDays} day${cutDays === '1' ? '' : 's'} (₹${Number(r.fine_amount).toFixed(0)})`);
        onClose();
        await onDone();
        return;
      }

      const actorName =
        staffData?.full_name || user?.user_metadata?.full_name || user?.email || 'Unknown';
      const payload =
        mode === 'cancel'
          ? {
              is_cancelled: true,
              cancelled_by: user?.id ?? null,
              cancelled_by_name: actorName,
              cancelled_at: new Date().toISOString(),
              cancellation_reason: reason.trim(),
            }
          : {
              is_cancelled: false,
              cancelled_by: null,
              cancelled_by_name: null,
              cancelled_at: null,
              cancellation_reason: null,
            };
      const { error } = await supabase
        .from('attendance_discipline_log' as never)
        .update(payload as never)
        .eq('id', target.id);
      if (error) throw error;

      if (mode === 'cancel') {
        const phone = (target.staff_phone || '').replace(/^\+/, '');
        if (phone) {
          try {
            const { data: waData, error: waErr } = await supabase.functions.invoke(
              'send-attendance-whatsapp',
              {
                body: {
                  staff_name: target.staff_name,
                  staff_phone: phone,
                  staff_id: target.staff_id,
                  event_type: 'penalty_waived',
                  actual_time: new Date().toISOString(),
                  scheduled_time: new Date().toISOString(),
                  slab: 'penalty_waived',
                  deduction_amount: Number(target.fine_amount) || 0,
                  penalty_date: target.work_date,
                },
              },
            );
            if (waErr || (waData && waData.success === false)) {
              toast.error('Penalty waived but WhatsApp notification failed');
            } else {
              toast.success(`Penalty waived — WhatsApp notification sent to ${target.staff_name}`);
            }
          } catch (e) {
            console.error('WhatsApp waiver notify failed', e);
            toast.error('Penalty waived but WhatsApp notification failed');
          }
        } else {
          toast.success('Penalty waived');
        }
      } else {
        toast.success('Penalty restored');
      }
      onClose();
      await onDone();
    } catch (e) {
      console.error('Penalty update failed', e);
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !working && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'cancel'
              ? 'Waive penalty'
              : mode === 'restore'
                ? 'Restore penalty'
                : mode === 'leave'
                  ? 'Mark as on leave'
                  : 'Change salary cut'}
          </DialogTitle>
          <DialogDescription>
            {target && (
              <span>
                {target.staff_name} • {format(new Date(target.work_date), 'dd MMM yyyy')} • ₹
                {Number(target.fine_amount).toFixed(0)}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        {mode === 'leave' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this when the leave was agreed, for example on the phone. The absence penalty for
              this day is removed.
            </p>
            <RadioGroup value={leavePaid} onValueChange={setLeavePaid} className="gap-2">
              <Label htmlFor="leave-paid" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal">
                <RadioGroupItem id="leave-paid" value="paid" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Paid leave</span>
                  <span className="text-xs text-muted-foreground">No salary cut for this day</span>
                </span>
              </Label>
              <Label htmlFor="leave-unpaid" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal">
                <RadioGroupItem id="leave-unpaid" value="unpaid" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Unpaid leave</span>
                  <span className="text-xs text-muted-foreground">1 day of salary is cut</span>
                </span>
              </Label>
            </RadioGroup>
            <div className="space-y-2">
              <Label htmlFor="penalty-reason" className="text-xs">Note (optional)</Label>
              <Textarea
                id="penalty-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Asked for leave on the phone"
                rows={2}
              />
            </div>
          </div>
        ) : mode === 'days' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Absent without informing cuts {target?.deduction_days ? `${Number(target.deduction_days)} day${Number(target.deduction_days) === 1 ? '' : 's'}` : 'the set number of days'} of
              salary now. Choose how many days to cut instead.
            </p>
            <div className="space-y-2">
              <Label className="text-xs">Days of salary to cut</Label>
              <div role="radiogroup" aria-label="Days of salary to cut" className="grid grid-cols-5 gap-1.5">
                {CUT_OPTIONS.map((d) => (
                  <Button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={cutDays === d}
                    variant={cutDays === d ? 'default' : 'outline'}
                    onClick={() => setCutDays(d)}
                  >
                    {d}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="penalty-reason" className="text-xs">Reason (required)</Label>
              <Textarea
                id="penalty-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Informed late in the morning"
                rows={2}
              />
            </div>
          </div>
        ) : mode === 'cancel' ? (
          <div className="space-y-2">
            <Label htmlFor="penalty-reason" className="text-xs">Reason (required)</Label>
            <Textarea
              id="penalty-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Traffic jam acknowledged by manager"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              The penalty will be excluded from this month's settlement. The record stays visible
              for audit.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This will restore the penalty so it counts toward the salary deduction again.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>
            Back
          </Button>
          <Button onClick={submit} disabled={working}>
            {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'cancel'
              ? 'Confirm waiver'
              : mode === 'restore'
                ? 'Restore penalty'
                : mode === 'leave'
                  ? 'Mark on leave'
                  : `Cut ${cutDays} day${cutDays === '1' ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The actions for one penalty row. Active absences also get "On leave" (approved leave, e.g.
 * agreed on the phone) and "Change cut" (how many days of salary the absence cuts).
 */
export function PenaltyRowActions({
  row,
  onOpen,
  compact = false,
}: {
  row: PenaltyTarget;
  onOpen: (row: PenaltyTarget, action: PenaltyAction) => void;
  compact?: boolean;
}) {
  if (row.is_cancelled) {
    return (
      <Button size="sm" variant="outline" className="gap-1" onClick={() => onOpen(row, 'restore')}>
        <RotateCcw className="h-3.5 w-3.5" /> Restore
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {row.is_absent && (
        <>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => onOpen(row, 'leave')}>
            <CalendarCheck className="h-3.5 w-3.5" /> On leave
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => onOpen(row, 'days')}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Change cut
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        className="gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
        onClick={() => onOpen(row, 'cancel')}
      >
        <Ban className="h-3.5 w-3.5" /> {compact ? 'Waive' : 'Waive penalty'}
      </Button>
    </div>
  );
}
