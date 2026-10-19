// Sends an instant phone notification (Web Push) to every owner when a staff member checks in
// or checks out. Called by the attendance_push_notify database trigger with
// { session_id, event: 'check_in' | 'check_out' }. The message is built from the saved record,
// so callers cannot inject text, and events older than a few minutes are ignored.
//
// { test: true } with a signed-in user's token sends a test notification to that user's phones.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const RECENT_MS = 15 * 60_000;
const TZ = 'Asia/Kolkata';

const timeIST = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const dateIST = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // yyyy-MM-dd
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

interface Sub { id: string; endpoint: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return respond({ skipped: 'VAPID keys not configured' });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'https://snug-salary-safe.vercel.app', publicKey, privateKey);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));

  const send = async (subs: Sub[], payload: Record<string, unknown>) => {
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 3600, urgency: 'high' },
        );
        sent += 1;
        await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // The phone unsubscribed or the browser data was cleared: forget this subscription.
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
        else console.error('push failed', code, (e as Error).message);
      }
    }));
    return sent;
  };

  try {
    if (body.test) {
      const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return respond({ error: 'Sign in first' }, 401);
      const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', user.id);
      const sent = await send((subs as Sub[]) ?? [], {
        title: '🔔 Smokzy alerts are on',
        body: 'You will get a notification here whenever staff check in or out.',
        url: '/dashboard',
        tag: 'smokzy-test',
      });
      return respond({ sent });
    }

    const sessionId = String(body.session_id ?? '');
    const event = body.event === 'check_out' ? 'check_out' : body.event === 'check_in' ? 'check_in' : null;
    if (!sessionId || !event) return respond({ error: 'session_id and event are required' }, 400);

    const { data: session } = await admin.from('attendance_sessions').select('*').eq('id', sessionId).maybeSingle();
    if (!session) return respond({ skipped: 'no such session' });
    const at = event === 'check_in' ? session.check_in_at : session.check_out_at;
    if (!at || Date.now() - new Date(at).getTime() > RECENT_MS) return respond({ skipped: 'not recent' });

    const staffQuery = admin.from('staff').select('id, full_name');
    const { data: staff } = session.staff_id
      ? await staffQuery.eq('id', session.staff_id).maybeSingle()
      : await staffQuery.eq('user_id', session.user_id).maybeSingle();
    const name = staff?.full_name ?? 'A staff member';

    let title: string;
    let text: string;
    if (event === 'check_in') {
      // Late by how much, against the person's shift start plus the grace minutes.
      let late = '';
      if (staff?.id) {
        const [{ data: a }, { data: rules }] = await Promise.all([
          admin.from('staff_shift_assignments').select('shift_id, override_check_in').eq('staff_id', staff.id).maybeSingle(),
          admin.from('discipline_rules').select('grace_minutes_in').limit(1).maybeSingle(),
        ]);
        let start: string | null = a?.override_check_in ?? null;
        if (!start && a?.shift_id) {
          const { data: shift } = await admin.from('shifts').select('check_in_time').eq('id', a.shift_id).maybeSingle();
          start = shift?.check_in_time ?? null;
        }
        if (start) {
          const due = new Date(`${dateIST(new Date(at))}T${start.slice(0, 5)}:00+05:30`);
          const diff = Math.round((new Date(at).getTime() - due.getTime()) / 60_000);
          if (diff > (rules?.grace_minutes_in ?? 0)) late = ` · late ${mins(diff)}`;
        }
      }
      title = `✅ ${name} checked in`;
      text = `${timeIST(at)}${late}`;
    } else {
      const worked = session.worked_minutes != null ? ` · ${mins(session.worked_minutes)} worked` : '';
      title = session.auto_closed ? `⏱️ ${name} was checked out automatically` : `👋 ${name} checked out`;
      text = `${timeIST(at)}${worked}`;
    }

    const { data: owners } = await admin.from('user_roles').select('user_id').eq('role', 'owner');
    const ownerIds = (owners ?? []).map((o: { user_id: string }) => o.user_id);
    if (ownerIds.length === 0) return respond({ sent: 0 });
    const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ownerIds);
    const sent = await send((subs as Sub[]) ?? [], { title, body: text, url: '/dashboard', tag: `${sessionId}-${event}` });
    return respond({ sent });
  } catch (e) {
    console.error('notify-attendance error', e);
    return respond({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
