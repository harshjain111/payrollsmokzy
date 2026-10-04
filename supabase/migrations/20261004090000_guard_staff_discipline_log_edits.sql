-- Staff could update their own attendance_discipline_log rows with no column limits
-- ("Users update own discipline log" had no WITH CHECK), so a staff member could cancel
-- their own penalty, rewrite the waiver, move a row to another person or date, or edit
-- old months through the REST API.
--
-- Staff devices legitimately insert/update their own row at check-in/check-out
-- (computeAndLogDiscipline in src/lib/discipline.ts). That flow only writes the fine
-- fields for the current work date, so it keeps working under the rules below.
--
-- Rules for callers who are not owner/admin (backend jobs with no auth.uid() are exempt):
--   * cancellation fields can never be set or changed
--   * staff_id and work_date cannot be changed
--   * only work dates from the last 2 days (IST) can be written
--   * nothing can be written for a month whose salary settlement is already 'settled'

CREATE OR REPLACE FUNCTION public.guard_discipline_log_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _check_date date;
BEGIN
  -- Backend jobs (service role, cron) and privileged roles are not restricted.
  IF _uid IS NULL
     OR public.has_role(_uid, 'owner'::public.app_role)
     OR public.has_role(_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- New rows from staff devices never start out waived.
    NEW.is_cancelled := false;
    NEW.cancelled_by := NULL;
    NEW.cancelled_by_name := NULL;
    NEW.cancelled_at := NULL;
    NEW.cancellation_reason := NULL;
    _check_date := NEW.work_date;
  ELSE
    IF COALESCE(NEW.is_cancelled, false) IS DISTINCT FROM COALESCE(OLD.is_cancelled, false)
       OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancelled_by_name IS DISTINCT FROM OLD.cancelled_by_name
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason THEN
      RAISE EXCEPTION 'Only owners and admins can cancel or restore penalties'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.staff_id IS DISTINCT FROM OLD.staff_id OR NEW.work_date IS DISTINCT FROM OLD.work_date THEN
      RAISE EXCEPTION 'A penalty cannot be moved to another staff member or date'
        USING ERRCODE = '42501';
    END IF;
    _check_date := OLD.work_date;
  END IF;

  IF _check_date < _today - 2 THEN
    RAISE EXCEPTION 'Penalties older than 2 days can only be changed by an owner or admin'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.salary_settlements ss
    WHERE ss.staff_id = COALESCE(NEW.staff_id, OLD.staff_id)
      AND ss.settlement_month = to_char(_check_date, 'YYYY-MM')
      AND ss.status = 'settled'::public.settlement_status
  ) THEN
    RAISE EXCEPTION 'Salary for this month is already settled'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_discipline_log_write ON public.attendance_discipline_log;
CREATE TRIGGER trg_guard_discipline_log_write
BEFORE INSERT OR UPDATE ON public.attendance_discipline_log
FOR EACH ROW
EXECUTE FUNCTION public.guard_discipline_log_write();

-- The update policy had no WITH CHECK, so a row could be re-pointed at another staff member.
DROP POLICY IF EXISTS "Users update own discipline log" ON public.attendance_discipline_log;
CREATE POLICY "Users update own discipline log"
  ON public.attendance_discipline_log
  FOR UPDATE
  TO authenticated
  USING (staff_id = public.get_user_staff_id(auth.uid()))
  WITH CHECK (staff_id = public.get_user_staff_id(auth.uid()));
