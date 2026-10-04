-- Payroll settlement v2
--
-- * Owners AND admins can settle salaries (previously owner only).
-- * Settling is one atomic, server-side operation (settle_salary). Previously the browser ran
--   4-5 separate writes; a dropped connection could leave a journal entry with no settlement,
--   and the journal was never linked back to its settlement (the link was attempted after the
--   entry had already been made immutable, and that error was ignored).
-- * The server recomputes every amount; the client only supplies the owner/admin's choices
--   (leave days, bonus, other deduction, advance recovery, last working day, payment mode).
-- * New real-life fields: bonus/incentive, other deduction (damage, uniform, ...), last working
--   day for leavers (pro-rata), notes, and the preferred payment mode.
-- * A month overview (get_payroll_month) shows every staff member's numbers and status at once.
-- * A settlement can be undone until its salary is paid (undo_salary_settlement), with a
--   reversing journal entry so the books stay complete.
-- * get_staff_salary_for_month no longer reveals any staff member's salary to any logged-in user.

-- ---------------------------------------------------------------- columns
ALTER TABLE public.salary_settlements
  ADD COLUMN IF NOT EXISTS bonus_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_note text,
  ADD COLUMN IF NOT EXISTS other_deduction numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deduction_note text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS payable_days numeric,
  ADD COLUMN IF NOT EXISTS notes text;

-- ---------------------------------------------------------------- access
CREATE OR REPLACE FUNCTION public.is_payroll_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'owner'::public.app_role)
      OR public.has_role(_user_id, 'admin'::public.app_role);
$$;

DROP POLICY IF EXISTS "Admins can view settlements" ON public.salary_settlements;
CREATE POLICY "Admins can view settlements"
  ON public.salary_settlements
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Salary lookup: owner/admin, or a staff member asking about themselves.
CREATE OR REPLACE FUNCTION public.get_staff_salary_for_month(_staff_id uuid, _month text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  month_start DATE;
  month_end DATE;
  salary NUMERIC;
  staff_current_salary NUMERIC;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_payroll_manager(auth.uid())
     AND _staff_id IS DISTINCT FROM public.get_user_staff_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed to view this salary' USING ERRCODE = '42501';
  END IF;

  month_start := (_month || '-01')::DATE;
  month_end := (month_start + INTERVAL '1 month - 1 day')::DATE;

  SELECT monthly_salary INTO staff_current_salary FROM public.staff WHERE id = _staff_id;

  SELECT monthly_salary INTO salary
  FROM public.salary_history
  WHERE staff_id = _staff_id
    AND effective_from <= month_end
  ORDER BY effective_from DESC
  LIMIT 1;

  IF salary IS NULL OR salary = 0 THEN
    salary := staff_current_salary;
  END IF;

  RETURN COALESCE(salary, 0);
END;
$function$;

-- ---------------------------------------------------------------- calculation (internal)
-- One place that turns (staff, month, optional last working day) into the system numbers.
CREATE OR REPLACE FUNCTION public.payroll_base(_staff_id uuid, _month text, _last_working_date date DEFAULT NULL)
RETURNS TABLE (
  monthly_salary numeric,
  days_in_month integer,
  period_start date,
  period_end date,
  payable_days integer,
  daily_rate numeric,
  base_pay numeric,
  system_leave_days numeric,
  discipline_fine numeric,
  advance_outstanding numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s public.staff%ROWTYPE;
  _month_start date := (_month || '-01')::date;
  _month_end date := ((_month || '-01')::date + interval '1 month - 1 day')::date;
BEGIN
  SELECT * INTO _s FROM public.staff WHERE id = _staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff not found';
  END IF;

  -- Same salary rule as get_staff_salary_for_month (without its caller check).
  SELECT sh.monthly_salary INTO monthly_salary
  FROM public.salary_history sh
  WHERE sh.staff_id = _staff_id AND sh.effective_from <= _month_end
  ORDER BY sh.effective_from DESC
  LIMIT 1;
  IF monthly_salary IS NULL OR monthly_salary = 0 THEN
    monthly_salary := COALESCE(_s.monthly_salary, 0);
  END IF;

  days_in_month := (_month_end - _month_start) + 1;
  period_start := GREATEST(_month_start, _s.date_of_joining);
  period_end := _month_end;
  IF _last_working_date IS NOT NULL THEN
    IF _last_working_date < period_start OR _last_working_date > _month_end THEN
      RAISE EXCEPTION 'Last working day must be between % and %', period_start, _month_end;
    END IF;
    period_end := _last_working_date;
  END IF;
  payable_days := GREATEST(0, (period_end - period_start) + 1);
  daily_rate := CASE WHEN days_in_month > 0 THEN monthly_salary / days_in_month ELSE 0 END;
  base_pay := round(daily_rate * payable_days, 2);

  SELECT COALESCE(SUM(lr.deduction_days), 0) INTO system_leave_days
  FROM public.leave_records lr
  WHERE lr.staff_id = _staff_id
    AND lr.status = 'approved'::public.leave_status
    AND lr.leave_date BETWEEN period_start AND period_end;

  IF COALESCE(_s.attendance_tracked, true) THEN
    SELECT COALESCE(round(SUM(dl.fine_amount), 2), 0) INTO discipline_fine
    FROM public.attendance_discipline_log dl
    WHERE dl.staff_id = _staff_id
      AND NOT COALESCE(dl.is_cancelled, false)
      AND dl.work_date BETWEEN period_start AND period_end;
  ELSE
    discipline_fine := 0;
  END IF;

  SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) INTO advance_outstanding
  FROM public.journal_lines jl
  JOIN public.accounts a ON a.id = jl.account_id
  WHERE jl.staff_id = _staff_id AND a.code = '1200';

  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_base(uuid, text, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- month overview
CREATE OR REPLACE FUNCTION public.get_payroll_month(_month text)
RETURNS TABLE (
  staff_id uuid,
  full_name text,
  employee_id text,
  is_active boolean,
  date_of_joining date,
  monthly_salary numeric,
  days_in_month integer,
  period_start date,
  period_end date,
  payable_days integer,
  daily_rate numeric,
  base_pay numeric,
  system_leave_days numeric,
  discipline_fine numeric,
  advance_outstanding numeric,
  estimated_net numeric,
  settlement_id uuid,
  settled_at timestamptz,
  settled_net_salary numeric,
  settled_balance_payable numeric,
  is_paid boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _month_end date := ((_month || '-01')::date + interval '1 month - 1 day')::date;
BEGIN
  IF NOT public.is_payroll_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners and admins can view payroll' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.full_name,
    s.employee_id,
    s.is_active,
    s.date_of_joining,
    b.monthly_salary,
    b.days_in_month,
    COALESCE(ss.period_start, b.period_start),
    COALESCE(ss.period_end, b.period_end),
    b.payable_days,
    b.daily_rate,
    b.base_pay,
    b.system_leave_days,
    b.discipline_fine,
    b.advance_outstanding,
    GREATEST(0, round(b.base_pay - b.daily_rate * b.system_leave_days - b.discipline_fine, 2)),
    ss.id,
    ss.settled_at,
    ss.net_salary,
    ss.balance_payable,
    (ss.id IS NOT NULL AND (ss.paid_at IS NOT NULL OR ss.balance_payable = 0
      OR EXISTS (SELECT 1 FROM public.payment_requests pr
                 WHERE pr.settlement_id = ss.id AND pr.paid_at IS NOT NULL)))
  FROM public.staff s
  LEFT JOIN public.salary_settlements ss
    ON ss.staff_id = s.id AND ss.settlement_month = _month AND ss.status = 'settled'::public.settlement_status
  CROSS JOIN LATERAL public.payroll_base(s.id, _month, ss.period_end) b
  WHERE s.date_of_joining <= _month_end
    AND (s.is_active OR ss.id IS NOT NULL)
  ORDER BY s.full_name;
END;
$$;

-- One staff member's system numbers, e.g. after choosing a last working day in the form.
CREATE OR REPLACE FUNCTION public.get_payroll_staff(_staff_id uuid, _month text, _last_working_date date DEFAULT NULL)
RETURNS TABLE (
  monthly_salary numeric,
  days_in_month integer,
  period_start date,
  period_end date,
  payable_days integer,
  daily_rate numeric,
  base_pay numeric,
  system_leave_days numeric,
  discipline_fine numeric,
  advance_outstanding numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_payroll_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners and admins can view payroll' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.payroll_base(_staff_id, _month, _last_working_date);
END;
$$;

-- ---------------------------------------------------------------- settle
CREATE OR REPLACE FUNCTION public.settle_salary(
  _staff_id uuid,
  _month text,
  _leave_days numeric,
  _leave_reason text DEFAULT NULL,
  _advance_recovery numeric DEFAULT 0,
  _bonus numeric DEFAULT 0,
  _bonus_note text DEFAULT NULL,
  _other_deduction numeric DEFAULT 0,
  _other_deduction_note text DEFAULT NULL,
  _last_working_date date DEFAULT NULL,
  _payment_mode text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _s public.staff%ROWTYPE;
  _b record;
  _month_start date;
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _leave_deduction numeric;
  _earnings numeric;
  _gross numeric;
  _net numeric;
  _settlement_id uuid;
  _journal_id uuid;
  _payout_id uuid;
  _actor_name text;
  _label text;
BEGIN
  IF NOT public.is_payroll_manager(_uid) THEN
    RAISE EXCEPTION 'Only owners and admins can settle salaries' USING ERRCODE = '42501';
  END IF;

  IF _month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Month must look like YYYY-MM';
  END IF;
  _month_start := (_month || '-01')::date;
  IF _month_start > date_trunc('month', _today)::date THEN
    RAISE EXCEPTION 'Cannot settle a future month';
  END IF;

  -- One settlement at a time per staff+month (double clicks, two people at once).
  PERFORM pg_advisory_xact_lock(hashtext('settle:' || _staff_id::text || ':' || _month));

  SELECT * INTO _s FROM public.staff WHERE id = _staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff not found';
  END IF;
  IF _month_start < date_trunc('month', _s.date_of_joining)::date THEN
    RAISE EXCEPTION '% joined on %, after this month', _s.full_name, _s.date_of_joining;
  END IF;
  IF EXISTS (SELECT 1 FROM public.salary_settlements
             WHERE staff_id = _staff_id AND settlement_month = _month) THEN
    RAISE EXCEPTION 'Salary for % is already settled for %', _s.full_name, _month;
  END IF;

  SELECT * INTO _b FROM public.payroll_base(_staff_id, _month, _last_working_date);

  _leave_days := COALESCE(_leave_days, _b.system_leave_days);
  _advance_recovery := COALESCE(_advance_recovery, 0);
  _bonus := COALESCE(_bonus, 0);
  _other_deduction := COALESCE(_other_deduction, 0);

  IF _leave_days < 0 OR _leave_days > _b.payable_days THEN
    RAISE EXCEPTION 'Leave days must be between 0 and % (days worked this month)', _b.payable_days;
  END IF;
  IF _leave_days <> _b.system_leave_days AND COALESCE(btrim(_leave_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for changing leave days from % to %', _b.system_leave_days, _leave_days;
  END IF;
  IF _bonus < 0 OR _other_deduction < 0 OR _advance_recovery < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative';
  END IF;
  IF _bonus > 0 AND COALESCE(btrim(_bonus_note), '') = '' THEN
    RAISE EXCEPTION 'Add a note for the bonus / incentive';
  END IF;
  IF _other_deduction > 0 AND COALESCE(btrim(_other_deduction_note), '') = '' THEN
    RAISE EXCEPTION 'Add a note for the other deduction';
  END IF;
  IF _payment_mode IS NOT NULL AND _payment_mode NOT IN ('cash', 'upi', 'bank_transfer', 'cheque') THEN
    RAISE EXCEPTION 'Unknown payment mode %', _payment_mode;
  END IF;

  _leave_deduction := round(_b.daily_rate * _leave_days, 2);
  _earnings := round(_b.base_pay + _bonus, 2);
  _gross := round(_earnings - _leave_deduction - _b.discipline_fine - _other_deduction, 2);
  IF _gross < 0 THEN
    RAISE EXCEPTION 'Deductions (₹%) are more than the salary earned (₹%). Reduce the deductions.',
      _leave_deduction + _b.discipline_fine + _other_deduction, _earnings;
  END IF;
  IF _advance_recovery > _b.advance_outstanding THEN
    RAISE EXCEPTION 'Advance recovery (₹%) is more than the advance outstanding (₹%)',
      _advance_recovery, _b.advance_outstanding;
  END IF;
  IF _advance_recovery > _gross THEN
    RAISE EXCEPTION 'Advance recovery (₹%) is more than the salary payable (₹%)', _advance_recovery, _gross;
  END IF;
  _net := round(_gross - _advance_recovery, 2);
  _label := to_char(_month_start, 'FMMonth YYYY');

  INSERT INTO public.salary_settlements (
    staff_id, settlement_month, base_salary, leave_days, leave_deduction, net_salary,
    advances_adjusted, opening_advance_balance, closing_advance_balance, balance_payable,
    status, settled_at, settled_by, created_by,
    system_deduction_days, final_deduction_days, deduction_adjustment_reason,
    deduction_adjusted_by, deduction_adjusted_at, discipline_fine,
    bonus_amount, bonus_note, other_deduction, other_deduction_note,
    period_start, period_end, payable_days, payment_mode, notes
  ) VALUES (
    _staff_id, _month, _b.base_pay, _leave_days, _leave_deduction, _gross,
    _advance_recovery, _b.advance_outstanding, _b.advance_outstanding - _advance_recovery, _net,
    'settled'::public.settlement_status, now(), _uid, _uid,
    _b.system_leave_days, _leave_days, NULLIF(btrim(COALESCE(_leave_reason, '')), ''),
    CASE WHEN _leave_days <> _b.system_leave_days THEN _uid END,
    CASE WHEN _leave_days <> _b.system_leave_days THEN now() END,
    _b.discipline_fine,
    _bonus, NULLIF(btrim(COALESCE(_bonus_note, '')), ''),
    _other_deduction, NULLIF(btrim(COALESCE(_other_deduction_note, '')), ''),
    _b.period_start, _b.period_end, _b.payable_days, _payment_mode,
    NULLIF(btrim(COALESCE(_notes, '')), '')
  )
  RETURNING id INTO _settlement_id;

  -- Double entry (accrual, no cash yet):
  --   Salary Expense Dr / Staff Payable Cr   for the salary earned after deductions
  --   Staff Payable Dr / Staff Advances Cr   for advance recovered from this salary
  IF _gross > 0 OR _advance_recovery > 0 THEN
    INSERT INTO public.journal_entries (
      entry_date, reference_no, description, transaction_type, reference_id, reference_type,
      staff_id, is_immutable, created_by
    ) VALUES (
      _today, public.generate_journal_ref('salary_settlement'),
      'Salary settlement for ' || _s.full_name || ' - ' || _label,
      'salary_settlement', _settlement_id, 'settlement', _staff_id, false, _uid
    )
    RETURNING id INTO _journal_id;

    IF _gross > 0 THEN
      INSERT INTO public.journal_lines (journal_entry_id, account_id, staff_id, debit, credit, description)
      SELECT _journal_id, id, NULL, _gross, 0, 'Salary expense for ' || _s.full_name || ' - ' || _label
      FROM public.accounts WHERE code = '5000';
      INSERT INTO public.journal_lines (journal_entry_id, account_id, staff_id, debit, credit, description)
      SELECT _journal_id, id, _staff_id, 0, _gross, 'Salary payable to ' || _s.full_name || ' - ' || _label
      FROM public.accounts WHERE code = '2000';
    END IF;
    IF _advance_recovery > 0 THEN
      INSERT INTO public.journal_lines (journal_entry_id, account_id, staff_id, debit, credit, description)
      SELECT _journal_id, id, _staff_id, _advance_recovery, 0, 'Advance adjustment against ' || _label || ' salary'
      FROM public.accounts WHERE code = '2000';
      INSERT INTO public.journal_lines (journal_entry_id, account_id, staff_id, debit, credit, description)
      SELECT _journal_id, id, _staff_id, 0, _advance_recovery, 'Advance cleared for ' || _s.full_name
      FROM public.accounts WHERE code = '1200';
    END IF;

    -- Locking runs the balanced-entry check (validate_journal_entry_balanced).
    UPDATE public.journal_entries SET is_immutable = true WHERE id = _journal_id;
    UPDATE public.salary_settlements SET journal_entry_id = _journal_id WHERE id = _settlement_id;
  END IF;

  -- Hand the money part to Payouts (owner records the actual payment there).
  IF _net > 0 THEN
    SELECT COALESCE(
      (SELECT full_name FROM public.staff WHERE user_id = _uid LIMIT 1),
      (SELECT raw_user_meta_data ->> 'full_name' FROM auth.users WHERE id = _uid),
      (SELECT email FROM auth.users WHERE id = _uid),
      'Payroll'
    ) INTO _actor_name;

    INSERT INTO public.payment_requests (
      staff_id, requested_by, amount, reason, status, approved_by, approved_at,
      approved_by_user_name, payout_type, settlement_id
    ) VALUES (
      _staff_id, _uid, _net, 'Salary for ' || _label, 'approved'::public.request_status, _uid, now(),
      _actor_name, 'salary', _settlement_id
    )
    RETURNING id INTO _payout_id;
  END IF;

  -- Leave records of a settled month can no longer be edited.
  UPDATE public.leave_records
  SET is_immutable = true
  WHERE staff_id = _staff_id
    AND status = 'approved'::public.leave_status
    AND leave_date BETWEEN _b.period_start AND ((_month || '-01')::date + interval '1 month - 1 day')::date
    AND is_immutable = false;

  RETURN jsonb_build_object(
    'settlement_id', _settlement_id,
    'journal_entry_id', _journal_id,
    'payout_request_id', _payout_id,
    'gross', _gross,
    'net_payable', _net
  );
END;
$$;

-- ---------------------------------------------------------------- undo (before payment)
-- Lets undo_salary_settlement unlock the month's leave records; nothing else sets this flag.
CREATE OR REPLACE FUNCTION public.prevent_leave_modification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.payroll_unlock', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true THEN
      RAISE EXCEPTION 'Cannot modify immutable leave record (ID: %)', OLD.id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_salary_settlement(_settlement_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ss public.salary_settlements%ROWTYPE;
  _staff_name text;
  _reversal_id uuid;
  _month_end date;
BEGIN
  IF NOT public.is_payroll_manager(_uid) THEN
    RAISE EXCEPTION 'Only owners and admins can undo a settlement' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for undoing the settlement';
  END IF;

  SELECT * INTO _ss FROM public.salary_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement not found';
  END IF;
  IF _ss.paid_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.payment_requests WHERE settlement_id = _settlement_id AND paid_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This salary has already been paid, so the settlement cannot be undone. Record a correction instead.';
  END IF;

  SELECT full_name INTO _staff_name FROM public.staff WHERE id = _ss.staff_id;

  -- Reverse the settlement journal so the books show both the entry and its reversal.
  IF _ss.journal_entry_id IS NOT NULL THEN
    INSERT INTO public.journal_entries (
      entry_date, reference_no, description, transaction_type, reference_id, reference_type,
      staff_id, is_immutable, created_by
    ) VALUES (
      (now() AT TIME ZONE 'Asia/Kolkata')::date, public.generate_journal_ref('cancellation'),
      'Reversal of salary settlement for ' || COALESCE(_staff_name, 'staff') || ' - ' || _ss.settlement_month
        || ': ' || btrim(_reason),
      'cancellation', _ss.journal_entry_id, 'journal_entry', _ss.staff_id, false, _uid
    )
    RETURNING id INTO _reversal_id;

    INSERT INTO public.journal_lines (journal_entry_id, account_id, staff_id, debit, credit, description)
    SELECT _reversal_id, account_id, staff_id, credit, debit, 'Reversal: ' || COALESCE(description, '')
    FROM public.journal_lines
    WHERE journal_entry_id = _ss.journal_entry_id;

    UPDATE public.journal_entries SET is_immutable = true WHERE id = _reversal_id;
  END IF;

  -- Withdraw the unpaid payout.
  UPDATE public.payment_requests
  SET status = 'rejected'::public.request_status,
      rejection_reason = 'Salary settlement undone: ' || btrim(_reason),
      settlement_id = NULL
  WHERE settlement_id = _settlement_id;

  -- Let the month's leave records be corrected again.
  _month_end := ((_ss.settlement_month || '-01')::date + interval '1 month - 1 day')::date;
  PERFORM set_config('app.payroll_unlock', 'on', true);
  UPDATE public.leave_records
  SET is_immutable = false
  WHERE staff_id = _ss.staff_id
    AND leave_date BETWEEN (_ss.settlement_month || '-01')::date AND _month_end
    AND is_immutable = true;
  PERFORM set_config('app.payroll_unlock', 'off', true);

  -- The settlement row itself is removed so the month can be settled again;
  -- the audit_salary_settlements trigger keeps a full copy in audit_log.
  DELETE FROM public.salary_settlements WHERE id = _settlement_id;

  RETURN jsonb_build_object('reversal_journal_id', _reversal_id);
END;
$$;

-- ---------------------------------------------------------------- grants
REVOKE ALL ON FUNCTION public.get_payroll_month(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_payroll_staff(uuid, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_salary(uuid, text, numeric, text, numeric, numeric, text, numeric, text, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_salary_settlement(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_payroll_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payroll_month(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_staff(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_salary(uuid, text, numeric, text, numeric, numeric, text, numeric, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_salary_settlement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_payroll_manager(uuid) TO authenticated;
