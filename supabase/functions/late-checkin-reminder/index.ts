// Phone reminder (Web Push) to a staff member who has not checked in 15 minutes after their
// shift start: "You are late — check in fast to avoid further penalties."
// Runs every 5 minutes from pg_cron. Each person gets at most one reminder a day
// (late_checkin_reminders), and only on phones where they turned reminders on.
// Skipped for: staff on approved leave, staff already checked in (or still on an open session),
// staff without a shift, and anyone more than 3 hours past their start time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const TZ = 'Asia/Kolkata';
const REMIND_AFTER_MIN = 15;
const GIVE_UP_AFTER_MIN = 180;

const dateIST = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // yyyy-MM-dd
const minutesIST = (d: Date) => {
  const [h, m] = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
  return (h % 24) * 60 + m;
};
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const time12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

interface Sub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return respond({ skipped: 'VAPID keys not configured' });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'https://snug-salary-safe.vercel.app', publicKey, privateKey);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const now = new Date();
    const today = dateIST(now);
    const nowMin = minutesIST(now);

    const [{ data: tracked }, { data: owners }] = await Promise.all([
      admin.from('staff').select('id, user_id').eq('is_active', true).eq('attendance_tracked', true).not('user_id', 'is', null),
      admin.from('user_roles').select('user_id').eq('role', 'owner'),
    ]);
    // An owner's phone is subscribed for check-in alerts, not for reminders about their own shift.
    const ownerIds = new Set((owners ?? []).map((o: { user_id: string }) => o.user_id));
    const staff = (tracked ?? []).filter((s: { user_id: string }) => !ownerIds.has(s.user_id));
    if (!staff.length) return respond({ sent: 0 });

    // Only people who turned reminders on can be reached; stop early when nobody has.
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', staff.map((s) => s.user_id));
    if (!subs?.length) return respond({ sent: 0, reason: 'no staff phones subscribed' });
    const subsByUser = new Map<string, Sub[]>();
    for (const s of subs as Sub[]) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);

    const reachable = staff.filter((s) => subsByUser.has(s.user_id));
    const ids = reachable.map((s) => s.id);
    const [{ data: assigns }, { data: shifts }, { data: leaves }, { data: sessions }, { data: open }, { data: done }, { data: rules }] =
      await Promise.all([
        admin.from('staff_shift_assignments').select('staff_id, shift_id, override_check_in').in('staff_id', ids),
        admin.from('shifts').select('id, check_in_time'),
        admin.from('leave_records').select('staff_id').eq('leave_date', today).eq('status', 'approved').in('staff_id', ids),
        admin.from('attendance_sessions').select('staff_id').eq('work_date', today).in('staff_id', ids),
        admin.from('attendance_sessions').select('staff_id').is('check_out_at', null).in('status', ['active', 'on_break']).in('staff_id', ids),
        admin.from('late_checkin_reminders').select('staff_id').eq('work_date', today).in('staff_id', ids),
        admin.from('discipline_rules').select('penalties_enabled').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ]);

    const shiftStart = new Map((shifts ?? []).map((s: { id: string; check_in_time: string }) => [s.id, s.check_in_time]));
    const skip = new Set<string>([
      ...(leaves ?? []).map((r: { staff_id: string }) => r.staff_id),
      ...(sessions ?? []).map((r: { staff_id: string }) => r.staff_id),
      ...(open ?? []).map((r: { staff_id: string }) => r.staff_id),
      ...(done ?? []).map((r: { staff_id: string }) => r.staff_id),
    ]);
    const startOf = new Map<string, string>();
    for (const a of (assigns ?? []) as { staff_id: string; shift_id: string | null; override_check_in: string | null }[]) {
      const start = a.override_check_in ?? (a.shift_id ? shiftStart.get(a.shift_id) : null);
      if (start) startOf.set(a.staff_id, start);
    }

    let sent = 0;
    let reminded = 0;
    for (const s of reachable) {
      const start = startOf.get(s.id);
      if (!start || skip.has(s.id)) continue;
      const late = nowMin - toMinutes(start);
      if (late < REMIND_AFTER_MIN || late > GIVE_UP_AFTER_MIN) continue;

      // Claim today's reminder first, so overlapping runs never send it twice.
      const { data: claimed } = await admin
        .from('late_checkin_reminders')
        .upsert({ staff_id: s.id, work_date: today }, { onConflict: 'staff_id,work_date', ignoreDuplicates: true })
        .select('staff_id');
      if (!claimed?.length) continue;
      reminded += 1;

      const payload = JSON.stringify({
        title: '⏰ You are late!',
        body: rules?.penalties_enabled === false
          ? `Your shift started at ${time12(start)}. Please check in now.`
          : `Your shift started at ${time12(start)}. Check in fast to avoid further penalties.`,
        url: '/dashboard',
        tag: `late-${today}`,
      });
      await Promise.all((subsByUser.get(s.user_id) ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 1800, urgency: 'high' },
          );
          sent += 1;
          await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', sub.id);
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          // The phone unsubscribed or the browser data was cleared: forget this subscription.
          if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', sub.id);
          else console.error('late reminder push failed', code, (e as Error).message);
        }
      }));
    }
    return respond({ reminded, sent });
  } catch (e) {
    console.error('late-checkin-reminder error', e);
    return respond({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
