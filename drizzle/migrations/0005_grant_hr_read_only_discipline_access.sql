GRANT SELECT ON public.attendance_discipline_log TO authenticated;

CREATE POLICY "HR can view all discipline logs"
ON public.attendance_discipline_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'hr'::public.app_role));