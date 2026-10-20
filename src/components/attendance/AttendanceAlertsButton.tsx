import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { disablePush, enablePush, getPushStatus, sendTestPush, type PushStatus } from '@/lib/push';

/** Owner-only: turn instant check-in / check-out phone alerts on or off for this phone. */
export function AttendanceAlertsButton() {
  const { user, isOwner } = useAuth();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    getPushStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, [isOwner]);

  if (!isOwner || status === null) return null;

  const turnOn = async () => {
    if (status === 'needs-install') {
      toast.info('On iPhone: tap Share → "Add to Home Screen", open Smokzy from the home screen, then turn alerts on.', { duration: 9000 });
      return;
    }
    if (status === 'denied') {
      toast.error('Notifications are blocked for this site. Allow them in your phone/browser settings, then try again.', { duration: 9000 });
      return;
    }
    if (status === 'unsupported') {
      toast.error('This browser cannot show notifications. Please use Chrome, or the installed Smokzy app.');
      return;
    }
    if (!user) return;
    setBusy(true);
    try {
      const next = await enablePush(user.id);
      setStatus(next);
      if (next === 'on') {
        const sent = await sendTestPush().catch(() => 0);
        toast.success(sent > 0 ? 'Alerts are on — a test notification was sent.' : 'Alerts are on for this phone.');
      } else if (next === 'denied') {
        toast.error('Notifications were blocked. Allow them in your phone settings to get alerts.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not turn on alerts');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const sent = await sendTestPush();
      toast.success(sent > 0 ? 'Test notification sent.' : 'No phone is set up for alerts yet.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send a test');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disablePush();
      setStatus('off');
      toast.success('Alerts turned off for this phone.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not turn off alerts');
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'on') {
    return (
      <Button size="sm" onClick={turnOn} disabled={busy} className="gap-1.5">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
        Get alerts
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy} className="gap-1.5 border-success/50 text-success">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          Alerts on
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          You get a notification on this phone when staff check in or out.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={test}>
          <Bell className="mr-2 h-4 w-4" />Send a test
        </DropdownMenuItem>
        <DropdownMenuItem onClick={turnOff} className="text-destructive">
          <BellOff className="mr-2 h-4 w-4" />Turn off on this phone
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
