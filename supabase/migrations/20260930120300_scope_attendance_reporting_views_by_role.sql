-- Ported from drizzle/migrations/0003_scope_attendance_reporting_views_by_role.sql.
CREATE OR REPLACE VIEW public.staff_attendance_public
WITH (security_invoker = false)
AS
SELECT id, user_id, employee_id, full_name, department, designation, is_active, attendance_tracked
FROM public.staff
WHERE public.has_role(auth.uid(), 'owner'::public.app_role)
   OR public.has_role(auth.uid(), 'admin'::public.app_role)
   OR public.has_role(auth.uid(), 'ca'::public.app_role)
   OR public.has_role(auth.uid(), 'hr'::public.app_role);

CREATE OR REPLACE VIEW public.attendance_leave_dates
WITH (security_invoker = false)
AS
SELECT staff_id, leave_date
FROM public.leave_records
WHERE status = 'approved'::public.leave_status
  AND (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'ca'::public.app_role)
    OR public.has_role(auth.uid(), 'hr'::public.app_role)
  );
