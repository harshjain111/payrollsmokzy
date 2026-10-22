-- Admins can pay settled salaries (Payouts), not only the owner.
--
-- Paying a salary posts the payout journal entry and marks the payment request paid (admins
-- could already do both for advances). The last step marks the settlement itself as paid; owners
-- did that with a direct table update, which admins may not do. Instead of opening the whole
-- table to admins, this function records only the payment details, never amounts.

CREATE OR REPLACE FUNCTION public.mark_salary_settlement_paid(
  _settlement_id uuid,
  _payment_mode text,
  _payout_journal_entry_id uuid,
  _paid_by uuid,
  _paid_by_user_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_payroll_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners and admins can pay salaries' USING ERRCODE = '42501';
  END IF;

  UPDATE public.salary_settlements
  SET paid_at = now(),
      paid_by = COALESCE(_paid_by, auth.uid()),
      paid_by_user_name = _paid_by_user_name,
      payment_mode = _payment_mode,
      payout_journal_entry_id = _payout_journal_entry_id
  WHERE id = _settlement_id
    AND status = 'settled'::public.settlement_status
    AND paid_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This salary is not settled or is already paid';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_salary_settlement_paid(uuid, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_salary_settlement_paid(uuid, text, uuid, uuid, text) TO authenticated;
