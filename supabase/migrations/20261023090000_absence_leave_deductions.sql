-- Absence and leave deductions.
--
-- 1. Absent without informing (no check-in, no approved leave) now cuts 2 days of salary by
--    default. The cut is stored as days on the penalty row, and an owner or admin can change it
--    later (for example down to 1 day) with adjust_absence_deduction().
-- 2. Leave approved after the day has passed (e.g. agreed verbally) removes that day's
--    penalties automatically: approving a leave waives the day's active penalties, and
--    un-approving or deleting it brings them back. Blocked once that month's salary is settled.
-- 3. get_my_deductions() lets a staff member see their own deductions for a month, with the
--    same numbers the salary settlement uses.
-- 4. late_checkin_reminders records the "you are late" push sent to a staff member, so each
--    person gets at most one reminder per day.

-- ---------------------------------------------------------------- 1. absence cut in days
ALTER TABLE public.attendance_discipline_log
  ADD COLUMN IF NOT EXISTS deduction_days numeric;

-- Absences so far were charged one day's salary.
UPDATE public.attendance_discipline_log
SET deduction_days = 1
WHERE is_absent AND deduction_days IS NULL;

UPDATE public.discipline_rules
SET absent_no_checkin_deduction = '2_days', updated_at = now()
WHERE absent_no_checkin_deduction = 'full_day';

-- Penalty writes made by the leave sync below run as the person approving the leave, who may
-- not be an owner or admin (accountants record leave too). The sync sets this flag for the
-- length of its own statement so the staff-device guard lets it through.
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
  -- Backend jobs (service role, cron), privileged roles and the leave sync are not restricted.
  IF _uid IS NULL
     OR current_setting('app.discipline_sync', true) = 'on'
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

CREATE OR REPLACE FUNCTION public.adjust_absence_deduction(_log_id uuid, _days numeric, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.attendance_discipline_log%ROWTYPE;
  _rate numeric;
  _amount numeric;
  _label text;
BEGIN
  IF NOT public.is_payroll_manager(_uid) THEN
    RAISE EXCEPTION 'Only owners and admins can change an absence cut' USING ERRCODE = '42501';
  END IF;
  IF _days IS NULL OR _days <= 0 OR _days > 10 OR _days * 2 <> trunc(_days * 2) THEN
    RAISE EXCEPTION 'Days to cut must be between 0.5 and 10, in half days';
  END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for changing the cut';
  END IF;

  SELECT * INTO _row FROM public.attendance_discipline_log WHERE id = _log_id FOR UPDATE;
  IF NOT FOUND OR NOT _row.is_absent THEN
    RAISE EXCEPTION 'This is not an absence';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.salary_settlements ss
    WHERE ss.staff_id = _row.staff_id
      AND ss.settlement_month = to_char(_row.work_date, 'YYYY-MM')
      AND ss.status = 'settled'::public.settlement_status
  ) THEN
    RAISE EXCEPTION 'Salary for this month is already settled — undo the settlement first';
  END IF;

  SELECT b.daily_rate INTO _rate FROM public.payroll_base(_row.staff_id, to_char(_row.work_date, 'YYYY-MM')) b;
  _amount := round(COALESCE(_rate, 0) * _days, 2);
  _label := to_char(_days, 'FM990.0');
  _label := regexp_replace(_label, '\.0$', '') || CASE WHEN _days = 1 THEN ' day' ELSE ' days' END;

  UPDATE public.attendance_discipline_log
  SET deduction_days = _days,
      fine_amount = _amount,
      fine_reason = CASE WHEN _row.absent_reason = 'no_checkout' THEN 'Absent — no check-out' ELSE 'Absent — no check-in' END
                    || ' (' || _label || ' salary cut)'
  WHERE id = _log_id;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, performed_by)
  VALUES (
    'attendance_discipline_log', _log_id, 'ABSENCE_CUT_CHANGED',
    jsonb_build_object('deduction_days', _row.deduction_days, 'fine_amount', _row.fine_amount,
                       'work_date', _row.work_date, 'staff_id', _row.staff_id),
    jsonb_build_object('deduction_days', _days, 'fine_amount', _amount, 'reason', btrim(_reason)),
    _uid
  );

  RETURN jsonb_build_object('deduction_days', _days, 'fine_amount', _amount);
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_absence_deduction(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_absence_deduction(uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------- 2. approved leave waives the day
CREATE OR REPLACE FUNCTION public.sync_leave_penalties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _was boolean := TG_OP <> 'INSERT' AND OLD.status = 'approved'::public.leave_status;
  _now boolean := TG_OP <> 'DELETE' AND NEW.status = 'approved'::public.leave_status;
  _moved boolean := TG_OP = 'UPDATE'
    AND (NEW.staff_id IS DISTINCT FROM OLD.staff_id OR NEW.leave_date IS DISTINCT FROM OLD.leave_date);
  _actor text;
BEGIN
  PERFORM set_config('app.discipline_sync', 'on', true);

  -- Leave no longer approved for that day: bring back what it waived.
  IF _was AND (NOT _now OR _moved) THEN
    UPDATE public.attendance_discipline_log
    SET is_cancelled = false, cancelled_by = NULL, cancelled_by_name = NULL,
        cancelled_at = NULL, cancellation_reason = NULL
    WHERE staff_id = OLD.staff_id
      AND work_date = OLD.leave_date
      AND is_cancelled
      AND cancellation_reason LIKE 'On approved leave%';
  END IF;

  -- Newly approved for this day: waive that day's active penalties.
  IF _now AND (NOT _was OR _moved) THEN
    IF EXISTS (
      SELECT 1 FROM public.salary_settlements ss
      WHERE ss.staff_id = NEW.staff_id
        AND ss.settlement_month = to_char(NEW.leave_date, 'YYYY-MM')
        AND ss.status = 'settled'::public.settlement_status
    ) THEN
      RAISE EXCEPTION 'Salary for % is already settled for this person — undo the settlement before approving leave in that month',
        to_char(NEW.leave_date, 'FMMonth YYYY');
    END IF;

    _actor := COALESCE(
      (SELECT full_name FROM public.staff WHERE user_id = _uid LIMIT 1),
      (SELECT raw_user_meta_data ->> 'full_name' FROM auth.users WHERE id = _uid),
      'Leave approval'
    );
    UPDATE public.attendance_discipline_log
    SET is_cancelled = true, cancelled_by = _uid, cancelled_by_name = _actor, cancelled_at = now(),
        cancellation_reason = 'On approved leave' || COALESCE(': ' || NULLIF(btrim(NEW.remarks), ''), '')
    WHERE staff_id = NEW.staff_id
      AND work_date = NEW.leave_date
      AND NOT COALESCE(is_cancelled, false)
      AND (fine_amount > 0 OR is_absent);
  END IF;

  PERFORM set_config('app.discipline_sync', 'off', true);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_leave_penalties() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_leave_penalties ON public.leave_records;
CREATE TRIGGER trg_sync_leave_penalties
AFTER INSERT OR UPDATE OF status, staff_id, leave_date OR DELETE ON public.leave_records
FOR EACH ROW
EXECUTE FUNCTION public.sync_leave_penalties();

-- Leave approved before this change did not waive penalties: waive them now for months that
-- are not settled yet (settled months are left exactly as they were paid).
DO $$
BEGIN
  PERFORM set_config('app.discipline_sync', 'on', true);
  UPDATE public.attendance_discipline_log dl
  SET is_cancelled = true, cancelled_at = now(), cancelled_by_name = 'Leave approval',
      cancellation_reason = 'On approved leave'
  FROM public.leave_records lr
  WHERE lr.staff_id = dl.staff_id
    AND lr.leave_date = dl.work_date
    AND lr.status = 'approved'::public.leave_status
    AND NOT COALESCE(dl.is_cancelled, false)
    AND (dl.fine_amount > 0 OR dl.is_absent)
    AND NOT EXISTS (
      SELECT 1 FROM public.salary_settlements ss
      WHERE ss.staff_id = dl.staff_id
        AND ss.settlement_month = to_char(dl.work_date, 'YYYY-MM')
        AND ss.status = 'settled'::public.settlement_status
    );
  PERFORM set_config('app.discipline_sync', 'off', true);
END;
$$;

-- ---------------------------------------------------------------- 3. staff: my deductions
CREATE OR REPLACE FUNCTION public.get_my_deductions(_month text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _staff_id uuid := public.get_user_staff_id(auth.uid());
  _tracked boolean;
  _b record;
  _items jsonb;
BEGIN
  IF _staff_id IS NULL THEN
    RAISE EXCEPTION 'No staff profile is linked to this login' USING ERRCODE = '42501';
  END IF;
  IF _month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Month must look like 2026-10';
  END IF;

  SELECT COALESCE(attendance_tracked, true) INTO _tracked FROM public.staff WHERE id = _staff_id;
  SELECT * INTO _b FROM public.payroll_base(_staff_id, _month);

  SELECT COALESCE(jsonb_agg(i ORDER BY i ->> 'date' DESC, i ->> 'kind'), '[]'::jsonb) INTO _items
  FROM (
    SELECT jsonb_build_object(
      'id', dl.id,
      'date', dl.work_date,
      'kind', CASE
        WHEN dl.is_absent THEN 'absent'
        WHEN dl.late_in_minutes > 0 AND dl.early_out_minutes > 0 THEN 'late_early'
        WHEN dl.early_out_minutes > 0 THEN 'early'
        ELSE 'late' END,
      'late_minutes', dl.late_in_minutes,
      'early_minutes', dl.early_out_minutes,
      'days', dl.deduction_days,
      'amount', dl.fine_amount,
      'reason', dl.fine_reason,
      'waived', COALESCE(dl.is_cancelled, false),
      'waive_reason', dl.cancellation_reason
    ) AS i
    FROM public.attendance_discipline_log dl
    WHERE _tracked
      AND dl.staff_id = _staff_id
      AND dl.work_date BETWEEN _b.period_start AND _b.period_end
      AND (dl.fine_amount > 0 OR dl.is_absent)
    UNION ALL
    SELECT jsonb_build_object(
      'id', lr.id,
      'date', lr.leave_date,
      'kind', 'leave',
      'days', lr.deduction_days,
      'amount', round(_b.daily_rate * lr.deduction_days, 2),
      'reason', lr.remarks,
      'waived', false
    )
    FROM public.leave_records lr
    WHERE lr.staff_id = _staff_id
      AND lr.status = 'approved'::public.leave_status
      AND lr.deduction_days > 0
      AND lr.leave_date BETWEEN _b.period_start AND _b.period_end
  ) x;

  RETURN jsonb_build_object(
    'month', _month,
    'daily_rate', round(_b.daily_rate, 2),
    'total', COALESCE((
      SELECT round(SUM((i ->> 'amount')::numeric), 2) FROM jsonb_array_elements(_items) i
      WHERE NOT (i ->> 'waived')::boolean
    ), 0),
    'items', _items
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_deductions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_deductions(text) TO authenticated;

-- ---------------------------------------------------------------- 4. late check-in reminders
CREATE TABLE IF NOT EXISTS public.late_checkin_reminders (
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, work_date)
);
-- Written only by the late-checkin-reminder function (service role); no app access.
ALTER TABLE public.late_checkin_reminders ENABLE ROW LEVEL SECURITY;
