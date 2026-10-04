import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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

export interface PenaltyTarget extends DisciplineLogRow {
  staff_name?: string;
  staff_phone?: string | null;
}

export type PenaltyAction = 'cancel' | 'restore';

interface Props {
  target: PenaltyTarget | null;
  mode: PenaltyAction;
  onClose: () => void;
  /** Called after a successful cancel or restore, e.g. to reload the list. */
  onDone: () => void | Promise<void>;
}

/**
 * Cancel (waive) or restore a single penalty. Shared by the Penalties page and
 * Attendance → Manage Penalties. A cancellation needs a reason, notifies the staff member
 * on WhatsApp when a phone number is known, and is written to the audit log by a database
 * trigger. Only owners and admins can change penalties (enforced by RLS).
 */
export function PenaltyActionDialog({ target, mode, onClose, onDone }: Props) {
  const { user, staffData } = useAuth();
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setReason('');
  }, [target, mode]);

  const submit = async () => {
    if (!target) return;
    if (mode === 'cancel' && !reason.trim()) {
      toast.error('Please enter a reason');
      return;
    }
    setWorking(true);
    try {
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
          toast.success('Penalty cancelled');
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
          <DialogTitle>{mode === 'cancel' ? 'Cancel penalty' : 'Restore penalty'}</DialogTitle>
          <DialogDescription>
            {target && (
              <span>
                {target.staff_name} • {format(new Date(target.work_date), 'dd MMM yyyy')} • ₹
                {Number(target.fine_amount).toFixed(0)}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        {mode === 'cancel' ? (
          <div className="space-y-2">
            <Label className="text-xs">Reason (required)</Label>
            <Textarea
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
            {mode === 'cancel' ? 'Confirm cancellation' : 'Restore penalty'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
