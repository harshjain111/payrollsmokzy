-- Ported from drizzle/migrations/0005_grant_hr_read_only_discipline_access.sql.
GRANT SELECT ON public.attendance_discipline_log TO authenticated;

DROP POLICY IF EXISTS "HR can view all discipline logs" ON public.attendance_discipline_log;
CREATE POLICY "HR can view all discipline logs"
ON public.attendance_discipline_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'hr'::public.app_role));
