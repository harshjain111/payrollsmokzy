import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AttendanceSession,
  formatMinutes,
  recomputeDisciplineForSession,
  saveAttendanceRecord,
} from '@/lib/attendance';

export interface AttendanceEditTarget {
  staffId: string;
  staffName: string;
  workDate: string;
  /** Existing record to correct; null adds a missed day. */
  session: AttendanceSession | null;
}

interface Props {
  target: AttendanceEditTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

/** 'yyyy-MM-ddTHH:mm' in the device's local time, for <input type="datetime-local">. */
const toLocalInput = (iso: string | null | undefined) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '');
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function EditAttendanceDialog({ target, onClose, onSaved }: Props) {
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  // Validation messages appear only once the user has changed something, not on open.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!target) return;
    setTouched(false);
    const s = target.session;
    setCheckIn(s ? toLocalInput(s.check_in_at) : `${target.workDate}T10:00`);
    setCheckOut(s ? toLocalInput(s.check_out_at) : `${target.workDate}T19:00`);
    setBreakMinutes(String(s?.total_break_minutes ?? 0));
    setReason('');
  }, [target]);

  if (!target) return null;
  const isAdd = !target.session;

  const inIso = fromLocalInput(checkIn);
  const outIso = fromLocalInput(checkOut);
  const brk = breakMinutes === '' ? 0 : Number(breakMinutes);
  const span = inIso && outIso ? Math.round((Date.parse(outIso) - Date.parse(inIso)) / 60000) : null;

  const errors: string[] = [];
  if (!inIso) errors.push('Enter the check-in time.');
  if (isAdd && !outIso) errors.push('Enter the check-out time.');
  if (span !== null && span <= 0) errors.push('Check-out must be after check-in.');
  if (span !== null && span > 24 * 60) errors.push('A record cannot be longer than 24 hours.');
  if (!Number.isFinite(brk) || brk < 0 || (span !== null && span > 0 && brk > span)) {
    errors.push('Break minutes must fit between check-in and check-out.');
  }
  if (!reason.trim()) errors.push('Give a reason for the change.');

  const edit = (set: (v: string) => void, value: string) => {
    set(value);
    setTouched(true);
  };

  const save = async () => {
    setTouched(true);
    if (!inIso || errors.length) return;
    setSaving(true);
    try {
      const sessionId = await saveAttendanceRecord({
        sessionId: target.session?.id ?? null,
        staffId: target.staffId,
        workDate: target.workDate,
        checkInIso: inIso,
        checkOutIso: outIso,
        breakMinutes: brk,
        reason: reason.trim(),
      });
      // Keep the day's late / early penalty in line with the corrected times.
      if (outIso) {
        await recomputeDisciplineForSession({
          staffId: target.staffId,
          userId: target.session?.user_id ?? '',
          sessionId,
          workDate: target.workDate,
          checkInIso: inIso,
          checkOutIso: outIso,
        });
      }
      toast.success(isAdd ? `Attendance added for ${target.staffName}` : `Attendance updated for ${target.staffName}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save attendance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isAdd ? 'Add attendance' : 'Edit attendance'}</DialogTitle>
          <DialogDescription>
            {target.staffName} · {format(parseISO(target.workDate), 'EEE, dd MMM yyyy')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="att-in">Check-in</Label>
              <Input id="att-in" type="datetime-local" value={checkIn} onChange={(e) => edit(setCheckIn, e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="att-out">Check-out</Label>
              <Input id="att-out" type="datetime-local" value={checkOut} onChange={(e) => edit(setCheckOut, e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="att-break">Break (minutes)</Label>
            <Input
              id="att-break"
              type="number"
              inputMode="numeric"
              min={0}
              value={breakMinutes}
              onChange={(e) => edit(setBreakMinutes, e.target.value)}
            />
          </div>
          {span !== null && span > 0 && brk >= 0 && brk <= span && (
            <p className="text-sm">
              Worked: <span className="font-semibold">{formatMinutes(span - brk)}</span>
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="att-reason">Reason (required)</Label>
            <Textarea
              id="att-reason"
              rows={2}
              placeholder={isAdd ? 'e.g. Phone was not working, confirmed by manager' : 'e.g. Forgot to check out'}
              value={reason}
              onChange={(e) => edit(setReason, e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The record will show who changed it and why, and the change is saved in the audit log.
            Late / early penalties for the day are recalculated.
          </p>
          {errors.length > 0 && touched && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-destructive">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Back
          </Button>
          <Button onClick={save} disabled={saving || errors.length > 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isAdd ? 'Add attendance' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
