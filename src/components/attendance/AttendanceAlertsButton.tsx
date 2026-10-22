import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { disablePush, enablePush, getPushStatus, sendTestPush, type PushStatus } from '@/lib/push';

/**
 * Shared state + actions for phone notifications on this phone: the owner's check-in / check-out
 * alerts, or a staff member's late check-in reminders (`noun` is used in the messages).
 */
function usePushAlerts(enabled: boolean, noun: 'Alerts' | 'Reminders' = 'Alerts') {
  const { user } = useAuth();
  // Assume "off" until checked, so the control shows straight away.
  const [status, setStatus] = useState<PushStatus>('off');
  const [busy, setBusy] = useState(false);
  const lower = noun.toLowerCase();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getPushStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus('unsupported'));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const turnOn = useCallback(async () => {
    if (status === 'needs-install') {
      toast.info(`On iPhone: in Safari tap Share → "Add to Home Screen". Then open Smokzy from the home screen and turn ${lower} on there.`, { duration: 10000 });
      return;
    }
    if (status === 'denied') {
      toast.error('Notifications are blocked for this app. Allow them in your phone settings (Settings → Notifications), then try again.', { duration: 10000 });
      return;
    }
    if (status === 'unsupported') {
      toast.error('This browser cannot show notifications. Please use Chrome, or the Smokzy app on your home screen.');
      return;
    }
    if (!user) return;
    setBusy(true);
    try {
      const next = await enablePush(user.id);
      setStatus(next);
      if (next === 'on') {
        const sent = await sendTestPush().catch(() => 0);
        toast.success(sent > 0 ? `${noun} are on — a test notification was sent.` : `${noun} are on for this phone.`);
      } else if (next === 'denied') {
        toast.error(`Notifications were blocked. Allow them in your phone settings to get ${lower}.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not turn on ${lower}`);
    } finally {
      setBusy(false);
    }
  }, [status, user, noun, lower]);

  const test = useCallback(async () => {
    setBusy(true);
    try {
      const sent = await sendTestPush();
      toast.success(sent > 0 ? 'Test notification sent.' : `No phone is set up for ${lower} yet.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send a test');
    } finally {
      setBusy(false);
    }
  }, [lower]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush();
      setStatus('off');
      toast.success(`${noun} turned off for this phone.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not turn off ${lower}`);
    } finally {
      setBusy(false);
    }
  }, [noun, lower]);

  return { status, busy, turnOn, test, turnOff };
}

function OnMenu({
  busy,
  test,
  turnOff,
  size = 'sm',
  label = 'Alerts on',
  hint = 'You get a notification on this phone when staff check in or out.',
}: {
  busy: boolean;
  test: () => void;
  turnOff: () => void;
  size?: 'sm' | 'default';
  label?: string;
  hint?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant="outline" disabled={busy} className="gap-1.5 border-success/50 text-success">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {hint}
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

/** Owner-only compact control (Today's attendance header). */
export function AttendanceAlertsButton() {
  const { isOwner } = useAuth();
  const { status, busy, turnOn, test, turnOff } = usePushAlerts(isOwner);
  if (!isOwner) return null;
  if (status === 'on') return <OnMenu busy={busy} test={test} turnOff={turnOff} />;
  return (
    <Button size="sm" onClick={turnOn} disabled={busy} className="gap-1.5">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
      Get alerts
    </Button>
  );
}

/**
 * Owner-only card. `hideWhenOn` makes it a prompt banner (dashboard) that disappears once alerts
 * are on; without it, it is the permanent Settings control.
 */
export function AttendanceAlertsCard({ hideWhenOn = false }: { hideWhenOn?: boolean }) {
  const { isOwner } = useAuth();
  const { status, busy, turnOn, test, turnOff } = usePushAlerts(isOwner);
  if (!isOwner || (hideWhenOn && status === 'on')) return null;
  const on = status === 'on';
  return (
    <Card className={on ? 'rounded-2xl border-success/40' : 'rounded-2xl border-primary/40 bg-primary/5'}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}>
            {on ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold">{on ? 'Check-in alerts are on' : 'Get check-in alerts on this phone'}</p>
            <p className="text-sm text-muted-foreground">
              {status === 'needs-install'
                ? 'On iPhone, first add Smokzy to your Home Screen (Safari → Share → Add to Home Screen), then open it from there.'
                : status === 'denied'
                  ? 'Notifications are blocked. Allow them for this app in your phone settings, then tap Turn on.'
                  : 'A notification pops up the moment any staff member checks in or checks out.'}
            </p>
          </div>
        </div>
        {on ? (
          <OnMenu busy={busy} test={test} turnOff={turnOff} size="default" />
        ) : (
          <Button onClick={turnOn} disabled={busy} className="w-full gap-2 sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Turn on alerts
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Staff card: turn on the "you are late, check in fast" reminder on this phone. It is sent by the
 * late-checkin-reminder function 15 minutes after the shift start if there is still no check-in.
 */
export function LateReminderCard() {
  const { staffData } = useAuth();
  const { t } = useLanguage();
  const tracked = (staffData as unknown as { attendance_tracked?: boolean } | null)?.attendance_tracked !== false;
  const enabled = !!staffData?.id && tracked;
  const { status, busy, turnOn, test, turnOff } = usePushAlerts(enabled, 'Reminders');
  if (!enabled) return null;
  const on = status === 'on';
  return (
    <Card className={on ? 'rounded-2xl border-success/40' : 'rounded-2xl border-primary/40 bg-primary/5'}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}>
            {on ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{on ? t('rem_on') : t('rem_title')}</p>
            <p className="text-sm text-muted-foreground">
              {status === 'needs-install'
                ? 'On iPhone, first add Smokzy to your Home Screen (Safari → Share → Add to Home Screen), then open it from there.'
                : status === 'denied'
                  ? 'Notifications are blocked. Allow them for this app in your phone settings.'
                  : t('rem_desc')}
            </p>
          </div>
        </div>
        {on ? (
          <div className="self-end sm:self-auto">
            <OnMenu busy={busy} test={test} turnOff={turnOff} label={t('rem_on')} hint={t('rem_desc')} />
          </div>
        ) : (
          <Button onClick={turnOn} disabled={busy} className="w-full shrink-0 gap-1.5 sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            {t('rem_turn_on')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
