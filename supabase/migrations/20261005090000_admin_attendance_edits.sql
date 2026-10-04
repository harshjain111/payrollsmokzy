-- Owners and admins can correct attendance (fix times, add a missed day, delete a wrong record).
--
-- Previously nobody had a screen for this; the database let owners change sessions directly
-- and admins could only read them. Edits now go through two functions that:
--   * allow owner or admin only (HR and staff stay read-only, as before)
--   * require a reason, stamp the record with who/when/why, and write audit_log
--   * keep worked minutes consistent (check-out − check-in − breaks)
--   * refuse changes in a month whose salary is already settled for that staff member

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_by uuid,
  ADD COLUMN IF NOT EXISTS edited_by_name text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edit_reason text;

CREATE OR REPLACE FUNCTION public.attendance_actor_name(_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT full_name FROM public.staff WHERE user_id = _uid LIMIT 1),
    (SELECT raw_user_meta_data ->> 'full_name' FROM auth.users WHERE id = _uid),
    (SELECT email FROM auth.users WHERE id = _uid),
    'Admin'
  );
$$;
REVOKE ALL ON FUNCTION public.attendance_actor_name(uuid) FROM PUBLIC, anon, authenticated;

-- Add (_session_id NULL) or edit (_session_id set) one attendance record. Returns the session id.
CREATE OR REPLACE FUNCTION public.save_attendance_record(
  _session_id uuid,
  _staff_id uuid,
  _work_date date,
  _check_in timestamptz,
  _check_out timestamptz,
  _break_minutes integer,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _old public.attendance_sessions%ROWTYPE;
  _new public.attendance_sessions%ROWTYPE;
  _staff public.staff%ROWTYPE;
  _span integer;
  _worked integer;
  _id uuid;
BEGIN
  IF NOT (public.has_role(_uid, 'owner'::public.app_role) OR public.has_role(_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Only owners and admins can change attendance' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for the change';
  END IF;

  IF _session_id IS NOT NULL THEN
    SELECT * INTO _old FROM public.attendance_sessions WHERE id = _session_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attendance record not found';
    END IF;
    _staff_id := _old.staff_id;
    _work_date := _old.work_date;
  END IF;

  SELECT * INTO _staff FROM public.staff WHERE id = _staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff not found';
  END IF;
  IF _session_id IS NULL AND _staff.user_id IS NULL THEN
    RAISE EXCEPTION '% has no app login yet, so attendance cannot be recorded for them', _staff.full_name;
  END IF;

  IF _work_date IS NULL OR _work_date > _today THEN
    RAISE EXCEPTION 'Attendance cannot be recorded for a future date';
  END IF;
  IF _check_in IS NULL THEN
    RAISE EXCEPTION 'Check-in time is required';
  END IF;
  IF (_check_in AT TIME ZONE 'Asia/Kolkata')::date NOT BETWEEN _work_date - 1 AND _work_date + 1 THEN
    RAISE EXCEPTION 'Check-in must be on % (or within a day of it)', _work_date;
  END IF;
  IF _check_out IS NOT NULL AND _check_out <= _check_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;
  IF _check_out IS NOT NULL AND _check_out - _check_in > interval '24 hours' THEN
    RAISE EXCEPTION 'A single attendance record cannot be longer than 24 hours';
  END IF;
  IF _check_out IS NULL AND _session_id IS NULL THEN
    RAISE EXCEPTION 'Check-out time is required when adding a missed day';
  END IF;

  _break_minutes := COALESCE(_break_minutes, 0);
  _span := CASE WHEN _check_out IS NULL THEN NULL
                ELSE round(extract(epoch FROM (_check_out - _check_in)) / 60)::integer END;
  IF _break_minutes < 0 OR (_span IS NOT NULL AND _break_minutes > _span) THEN
    RAISE EXCEPTION 'Break minutes must be between 0 and the time between check-in and check-out';
  END IF;
  _worked := CASE WHEN _span IS NULL THEN NULL ELSE GREATEST(0, _span - _break_minutes) END;

  IF EXISTS (
    SELECT 1 FROM public.salary_settlements
    WHERE staff_id = _staff_id
      AND settlement_month = to_char(_work_date, 'YYYY-MM')
      AND status = 'settled'::public.settlement_status
  ) THEN
    RAISE EXCEPTION 'Salary for % is already settled for this month. Undo the settlement first.', _staff.full_name;
  END IF;

  IF _session_id IS NULL THEN
    INSERT INTO public.attendance_sessions (
      user_id, staff_id, work_date, check_in_at, check_in_photo_url, check_out_at,
      total_break_minutes, worked_minutes, status, is_manual,
      edited_by, edited_by_name, edited_at, edit_reason
    ) VALUES (
      _staff.user_id, _staff_id, _work_date, _check_in, '', _check_out,
      _break_minutes, _worked, 'completed', true,
      _uid, public.attendance_actor_name(_uid), now(), btrim(_reason)
    )
    RETURNING * INTO _new;
  ELSE
    -- A break left open is closed at the new check-out time.
    IF _check_out IS NOT NULL THEN
      UPDATE public.attendance_breaks
      SET end_at = _check_out,
          duration_minutes = GREATEST(0, round(extract(epoch FROM (_check_out - start_at)) / 60)::integer)
      WHERE session_id = _session_id AND end_at IS NULL;
    END IF;

    UPDATE public.attendance_sessions
    SET check_in_at = _check_in,
        check_out_at = _check_out,
        total_break_minutes = _break_minutes,
        worked_minutes = _worked,
        status = CASE WHEN _check_out IS NOT NULL THEN 'completed'
                      WHEN status = 'completed' THEN 'active'
                      ELSE status END,
        auto_closed = CASE WHEN _check_out IS DISTINCT FROM _old.check_out_at THEN false ELSE auto_closed END,
        edited_by = _uid,
        edited_by_name = public.attendance_actor_name(_uid),
        edited_at = now(),
        edit_reason = btrim(_reason)
    WHERE id = _session_id
    RETURNING * INTO _new;
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, performed_by)
  VALUES (
    'attendance_sessions', _new.id,
    CASE WHEN _session_id IS NULL THEN 'ATTENDANCE_ADDED' ELSE 'ATTENDANCE_EDITED' END,
    CASE WHEN _session_id IS NULL THEN NULL ELSE to_jsonb(_old) END,
    to_jsonb(_new) || jsonb_build_object('reason', btrim(_reason)),
    _uid
  );

  RETURN _new.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_attendance_record(_session_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _old public.attendance_sessions%ROWTYPE;
BEGIN
  IF NOT (public.has_role(_uid, 'owner'::public.app_role) OR public.has_role(_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Only owners and admins can change attendance' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for deleting this record';
  END IF;

  SELECT * INTO _old FROM public.attendance_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.salary_settlements
    WHERE staff_id = _old.staff_id
      AND settlement_month = to_char(_old.work_date, 'YYYY-MM')
      AND status = 'settled'::public.settlement_status
  ) THEN
    RAISE EXCEPTION 'Salary for this month is already settled. Undo the settlement first.';
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, performed_by)
  VALUES (
    'attendance_sessions', _old.id, 'ATTENDANCE_DELETED',
    to_jsonb(_old) || jsonb_build_object(
      'breaks', COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM public.attendance_breaks b WHERE b.session_id = _old.id), '[]'::jsonb)
    ),
    jsonb_build_object('reason', btrim(_reason)),
    _uid
  );

  DELETE FROM public.attendance_breaks WHERE session_id = _session_id;
  -- The discipline log keeps its own session link for history; detach it.
  UPDATE public.attendance_discipline_log SET session_id = NULL WHERE session_id = _session_id;
  DELETE FROM public.attendance_sessions WHERE id = _session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_attendance_record(uuid, uuid, date, timestamptz, timestamptz, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_attendance_record(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_record(uuid, uuid, date, timestamptz, timestamptz, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_attendance_record(uuid, text) TO authenticated;
