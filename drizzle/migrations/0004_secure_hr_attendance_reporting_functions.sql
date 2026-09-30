CREATE OR REPLACE FUNCTION public.get_attendance_staff()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  employee_id text,
  full_name text,
  department text,
  designation text,
  is_active boolean,
  attendance_tracked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.user_id, s.employee_id, s.full_name, s.department, s.designation, s.is_active, s.attendance_tracked
  FROM public.staff s
  WHERE (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'ca'::public.app_role)
    OR public.has_role(auth.uid(), 'hr'::public.app_role)
  );
$$;

REVOKE ALL ON FUNCTION public.get_attendance_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_staff() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_attendance_leave_dates(_date_from date, _date_to date)
RETURNS TABLE (staff_id uuid, leave_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lr.staff_id, lr.leave_date
  FROM public.leave_records lr
  WHERE lr.status = 'approved'::public.leave_status
    AND lr.leave_date BETWEEN _date_from AND _date_to
    AND (
      public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'ca'::public.app_role)
      OR public.has_role(auth.uid(), 'hr'::public.app_role)
    );
$$;

REVOKE ALL ON FUNCTION public.get_attendance_leave_dates(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_leave_dates(date, date) TO authenticated, service_role;

ALTER VIEW public.staff_attendance_public SET (security_invoker = true);
ALTER VIEW public.attendance_leave_dates SET (security_invoker = true);