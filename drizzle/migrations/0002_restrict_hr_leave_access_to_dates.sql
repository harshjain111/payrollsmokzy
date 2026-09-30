CREATE OR REPLACE VIEW public.attendance_leave_dates
WITH (security_invoker = false)
AS
SELECT staff_id, leave_date
FROM public.leave_records
WHERE status = 'approved'::public.leave_status;

GRANT SELECT ON public.attendance_leave_dates TO authenticated;
GRANT ALL ON public.attendance_leave_dates TO service_role;

DROP POLICY IF EXISTS "HR can view approved leave dates" ON public.leave_records;