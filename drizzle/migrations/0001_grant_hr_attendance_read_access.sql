CREATE OR REPLACE VIEW public.staff_attendance_public
WITH (security_invoker = false)
AS
SELECT id, user_id, employee_id, full_name, department, designation, is_active, attendance_tracked
FROM public.staff;

GRANT SELECT ON public.staff_attendance_public TO authenticated;
GRANT ALL ON public.staff_attendance_public TO service_role;

CREATE POLICY "HR can view all attendance sessions"
ON public.attendance_sessions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'hr'::public.app_role));

CREATE POLICY "HR can view all attendance breaks"
ON public.attendance_breaks
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'hr'::public.app_role));

CREATE POLICY "HR can view approved leave dates"
ON public.leave_records
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'hr'::public.app_role)
  AND status = 'approved'::public.leave_status
);

CREATE POLICY "HR can view attendance photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'attendance-photos'
  AND public.has_role(auth.uid(), 'hr'::public.app_role)
);