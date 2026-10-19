-- Instant phone notifications to the owner when staff check in or check out.
--
-- * push_subscriptions: one row per phone/browser that turned alerts on (Web Push).
-- * A trigger on attendance_sessions calls the notify-attendance edge function right after a
--   real check-in (insert) or check-out (check_out_at set). Owner/admin corrections and manual
--   records do not notify. A notification problem can never block a check-in.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users read own push subscriptions" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users add own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users add own push subscriptions" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users update own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users update own push subscriptions" ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users remove own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users remove own push subscriptions" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Calls one of the app's edge functions over HTTP (also used by the scheduled jobs).
-- Uses the public anon key; only the database itself may call this helper.
CREATE OR REPLACE FUNCTION public.call_edge_function(_fn text, _body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT net.http_post(
    url := 'https://jotpsrmsauypyycdkbhp.supabase.co/functions/v1/' || _fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvdHBzcm1zYXV5cHl5Y2RrYmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4MzYyMjgsImV4cCI6MjEwNjQxMjIyOH0.t0PC80TkbDGYjpaVxm3T_oBD9LJYQIriiBrdMKHNiXY'),
    body := _body,
    timeout_milliseconds := 60000);
$$;
REVOKE ALL ON FUNCTION public.call_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_attendance_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' AND NOT COALESCE(NEW.is_manual, false) THEN
      PERFORM public.call_edge_function('notify-attendance',
        jsonb_build_object('session_id', NEW.id, 'event', 'check_in'));
    ELSIF TG_OP = 'UPDATE'
      AND OLD.check_out_at IS NULL AND NEW.check_out_at IS NOT NULL
      AND NEW.edited_at IS NOT DISTINCT FROM OLD.edited_at THEN
      PERFORM public.call_edge_function('notify-attendance',
        jsonb_build_object('session_id', NEW.id, 'event', 'check_out'));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_attendance_event failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_attendance_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS attendance_push_notify ON public.attendance_sessions;
CREATE TRIGGER attendance_push_notify
  AFTER INSERT OR UPDATE OF check_out_at ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.notify_attendance_event();
