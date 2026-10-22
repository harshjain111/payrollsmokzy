import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, ChevronRight, PartyPopper, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchMyDeductions, fetchTodayLateFine, type DeductionItem } from '@/lib/deductions';
import { cn } from '@/lib/utils';

const REFRESH_MS = 60_000;
const SHOW_FIRST = 4;

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Staff dashboard: what has been cut from this month's salary so far (late, left early, absent,
 * unpaid leave), with a nudge to improve. Refreshes every minute and when the app comes back to
 * the foreground; today's late check-in shows straight away, before it is saved at check-out.
 */
export function MyDeductionsCard() {
  const { staffData } = useAuth();
  const { t } = useLanguage();
  const staffId = staffData?.id;
  const tracked = (staffData as unknown as { attendance_tracked?: boolean } | null)?.attendance_tracked !== false;

  const [items, setItems] = useState<DeductionItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!staffId) return;
    const now = new Date();
    const month = format(now, 'yyyy-MM');
    const today = format(now, 'yyyy-MM-dd');
    try {
      const data = await fetchMyDeductions(month);
      let list = data.items;
      if (tracked && !list.some((i) => i.date === today && i.kind !== 'leave')) {
        const todayLate = await fetchTodayLateFine(staffId, today, data.daily_rate).catch(() => null);
        if (todayLate) list = [todayLate, ...list];
      }
      setItems(list);
      setFailed(false);
    } catch (e) {
      console.error('Deductions load failed', e);
      setFailed(true);
    }
  }, [staffId, tracked]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const active = useMemo(() => (items ?? []).filter((i) => !i.waived), [items]);
  const total = active.reduce((s, i) => s + i.amount, 0);
  const counts = useMemo(() => {
    const c = { late: 0, absent: 0, leave: 0 };
    for (const i of active) {
      if (i.kind === 'absent') c.absent += 1;
      else if (i.kind === 'leave') c.leave += 1;
      else c.late += 1;
    }
    return c;
  }, [active]);

  if (!staffId) return null;
  if (failed && items === null) return null;
  if (items === null) return <Skeleton className="h-28 w-full rounded-2xl" />;

  const good = total <= 0;
  const visible = expanded ? items : items.slice(0, SHOW_FIRST);
  const days = (n?: number | null) => (n ? `${n} ${n === 1 ? t('ded_day') : t('ded_days')}` : '');

  const label = (i: DeductionItem) => {
    switch (i.kind) {
      case 'absent':
        return [i.reason?.includes('check-out') ? t('ded_absent_no_checkout') : t('ded_absent'), days(i.days)]
          .filter(Boolean)
          .join(' · ');
      case 'leave':
        return [t('ded_leave'), days(i.days)].filter(Boolean).join(' · ');
      case 'early':
        return `${t('ded_early')} ${i.early_minutes ?? 0} ${t('ded_min')}`;
      case 'late_early':
        return `${t('ded_late_early')} (${i.late_minutes ?? 0} + ${i.early_minutes ?? 0} ${t('ded_min')})`;
      default:
        return `${t('ded_late')} ${i.late_minutes ?? 0} ${t('ded_min')}`;
    }
  };

  return (
    <Card className={cn('rounded-2xl', good ? 'border-success/40' : 'border-destructive/30')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{t('ded_title')}</p>
            <p className={cn('text-2xl font-bold', good ? 'text-success' : 'text-destructive')}>{rupees(total)}</p>
          </div>
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              good ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
            )}
          >
            {good ? <PartyPopper className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          </div>
        </div>

        <div
          role="status"
          className={cn(
            'flex items-start gap-2 rounded-xl p-3 text-sm font-medium',
            good ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
          )}
        >
          {good ? <PartyPopper className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{good ? t('ded_good') : t('ded_improve')}</span>
        </div>

        {!good && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {counts.late > 0 && <span className="rounded-full bg-muted px-2.5 py-1">{t('ded_late')} × {counts.late}</span>}
            {counts.absent > 0 && <span className="rounded-full bg-muted px-2.5 py-1">{t('ded_absent')} × {counts.absent}</span>}
            {counts.leave > 0 && <span className="rounded-full bg-muted px-2.5 py-1">{t('ded_leave')} × {counts.leave}</span>}
          </div>
        )}

        {items.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {visible.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className={cn('text-sm', i.waived && 'text-muted-foreground line-through')}>{label(i)}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.provisional ? `${t('ded_today')} · ${t('ded_until_checkout')}` : format(parseISO(i.date), 'EEE, dd MMM')}
                    {i.waived && ` · ${t('ded_waived')}${i.waive_reason ? ` (${i.waive_reason})` : ''}`}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold',
                    i.waived ? 'text-muted-foreground line-through' : 'text-destructive',
                  )}
                >
                  −{rupees(i.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2">
          {items.length > SHOW_FIRST ? (
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t('ded_show_less') : `${t('ded_show_all')} (${items.length})`}
            </Button>
          ) : (
            <span />
          )}
          <Button asChild variant="ghost" size="sm" className="-mr-2 gap-1">
            <Link to="/my-attendance">
              {t('ded_details')} <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
