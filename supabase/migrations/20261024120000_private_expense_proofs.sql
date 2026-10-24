-- Expense bill photos were readable by every signed-in user ("Authenticated users can view
-- expense proofs"), so any staff member could open everyone else's bills.
-- Now: owners, admins, accountants and CA see all of them (they review and approve expenses);
-- anyone else sees only files in their own upload folder or attached to their own expenses
-- (e.g. a bill a manager uploaded for them).

DROP POLICY IF EXISTS "Authenticated users can view expense proofs" ON storage.objects;

DROP POLICY IF EXISTS "View expense proofs: own expenses, or expense reviewers" ON storage.objects;
CREATE POLICY "View expense proofs: own expenses, or expense reviewers"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'expense-proofs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'accountant'::public.app_role)
      OR public.has_role(auth.uid(), 'ca'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.expenses e
        WHERE e.staff_id = public.get_user_staff_id(auth.uid())
          AND storage.objects.name = ANY (string_to_array(replace(e.proof_url, ' ', ''), ','))
      )
    )
  );
