-- Ported from drizzle/migrations/0001_grant_hr_attendance_read_access.sql.
-- Written to be idempotent: the live project already has these objects if the
-- Drizzle migrations ran, so re-applying through `supabase db push` is a no-op.
CREATE OR REPLACE VIEW public.staff_attendance_public
WITH (security_invoker = false)
AS
SELECT id, user_id, employee_id, full_name, department, designation, is_active, attendance_tracked
FROM public.staff;

GRANT SELECT ON public.staff_attendance_public TO authenticated;
GRANT ALL ON public.staff_attendance_public TO service_role;

DROP POLICY IF EXISTS "HR can view all attendance sessions" ON public.attendance_sessions;
CREATE POLICY "HR can view all attendance sessions"
ON public.attendance_sessions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'hr'::public.app_role));

DROP POLICY IF EXISTS "HR can view all attendance breaks" ON public.attendance_breaks;
CREATE POLICY "HR can view all attendance breaks"
ON public.attendance_breaks
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'hr'::public.app_role));

DROP POLICY IF EXISTS "HR can view attendance photos" ON storage.objects;
CREATE POLICY "HR can view attendance photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'attendance-photos'
  AND public.has_role(auth.uid(), 'hr'::public.app_role)
);
