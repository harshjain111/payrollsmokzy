-- One-step, atomic salary payment (owner or admin).
--
-- Paying a settled salary used to be several separate writes from the browser (payout journal
-- entry, payment request, settlement, notification). pay_salary() does all of it in one
-- transaction on the server, so a payment is either fully recorded or not at all, and the same
-- salary can never be paid twice. Used by Payouts and by "Settle & pay now".
--
--   Staff Payable Dr / Cash or Bank Cr   for the net salary paid

CREATE OR REPLACE FUNCTION public.pay_salary(
  _settlement_id uuid,
  _payment_mode text,
  _paid_by uuid DEFAULT NULL,
  _paid_by_user_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _set public.salary_settlements%ROWTYPE;
  _req public.payment_requests%ROWTYPE;
  _staff public.staff%ROWTYPE;
  _account_code text;
  _journal_id uuid;
  _label text;
  _payer uuid;
  _payer_name text;
BEGIN
  IF NOT public.is_payroll_manager(_uid) THEN
    RAISE EXCEPTION 'Only owners and admins can pay salaries' USING ERRCODE = '42501';
  END IF;

  _account_code := CASE _payment_mode
    WHEN 'cash' THEN '1000'
    WHEN 'upi' THEN '1100'
    WHEN 'bank_transfer' THEN '1100'
    WHEN 'cheque' THEN '1100'
    ELSE NULL END;
  IF _account_code IS NULL THEN
    RAISE EXCEPTION 'Choose how the salary was paid (cash, UPI, bank transfer or cheque)';
  END IF;

  SELECT * INTO _set FROM public.salary_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND OR _set.status <> 'settled'::public.settlement_status THEN
    RAISE EXCEPTION 'This salary is not settled';
  END IF;
  IF _set.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'This salary is already paid';
  END IF;

  SELECT * INTO _req FROM public.payment_requests
  WHERE settlement_id = _settlement_id AND payout_type = 'salary'
  ORDER BY created_at DESC LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR _req.amount <= 0 THEN
    RAISE EXCEPTION 'There is nothing to pay for this salary';
  END IF;
  IF _req.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'This salary is already paid';
  END IF;

  SELECT * INTO _staff FROM public.staff WHERE id = _set.staff_id;
  _label := to_char(to_date(_set.settlement_month || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
  _payer := COALESCE(_paid_by, _uid);
  _payer_name := COALESCE(
    NULLIF(btrim(COALESCE(_paid_by_user_name, '')), ''),
    (SELECT full_name FROM public.staff WHERE user_id = _payer LIMIT 1),
    (SELECT raw_user_meta_data ->> 'full_name' FROM auth.users WHERE id = _payer),
    'Payroll'
  );

  INSERT INTO public.journal_entries (
    entry_date, reference_no, description, transaction_type, reference_id, reference_type,
    staff_id, is_immutable, created_by, paid_by, paid_by_user_name
  ) VALUES (
    (now() AT TIME ZONE 'Asia/Kolkata')::date, public.generate_journal_ref('salary_payout'),
    'Salary paid to ' || _staff.full_name || ' - ' || _label,
    'salary_payout', _req.id, 'payment_request', _set.staff_id, false, _uid, _payer, _payer_name
  )
  RETURNING id INTO _journal_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, staff_id, debit, credit, description)
  SELECT _journal_id, id, _set.staff_id, _req.amount, 0, 'Salary payment to ' || _staff.full_name || ' - ' || _label
  FROM public.accounts WHERE code = '2000';
  INSERT INTO public.journal_lines (journal_entry_id, account_id, staff_id, debit, credit, description)
  SELECT _journal_id, id, NULL, 0, _req.amount, 'Paid via ' || replace(_payment_mode, '_', ' ')
  FROM public.accounts WHERE code = _account_code;

  -- Locking runs the balanced-entry check.
  UPDATE public.journal_entries SET is_immutable = true WHERE id = _journal_id;

  UPDATE public.payment_requests
  SET paid_at = now(), paid_by = _payer, paid_by_user_name = _payer_name
  WHERE id = _req.id;

  UPDATE public.salary_settlements
  SET paid_at = now(), paid_by = _payer, paid_by_user_name = _payer_name,
      payment_mode = _payment_mode, payout_journal_entry_id = _journal_id
  WHERE id = _settlement_id;

  IF _staff.user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, reference_type, reference_id)
    VALUES (_staff.user_id, 'Salary Paid',
            'Your salary of ₹' || to_char(_req.amount, 'FM99,99,99,990.00') || ' for ' || _label || ' has been paid.',
            'success', 'journal_entry', _journal_id);
  END IF;

  RETURN jsonb_build_object('journal_entry_id', _journal_id, 'amount', _req.amount, 'payment_request_id', _req.id);
END;
$$;

REVOKE ALL ON FUNCTION public.pay_salary(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_salary(uuid, text, uuid, text) TO authenticated;
