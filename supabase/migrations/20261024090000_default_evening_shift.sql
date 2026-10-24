-- Default shift for everyone without one: 4 PM – 11 PM, and 4 PM – 12 AM on weekends.
--
-- 1. Shifts can end later on weekend days: weekend_check_out_time applies on the days in
--    weekend_days (0 = Sunday … 6 = Saturday, the day the shift starts). A per-person
--    "override out" still wins.
-- 2. One shift can be the default (is_default). New staff are put on it automatically, so nobody
--    is left without a check-in time (staff without a shift are never marked late or absent).
-- 3. Every active staff member without a shift is put on the new default shift now.

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS weekend_check_out_time time,
  ADD COLUMN IF NOT EXISTS weekend_days smallint[] NOT NULL DEFAULT '{0,6}',
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_default ON public.shifts (is_default) WHERE is_default;

INSERT INTO public.shifts (name, check_in_time, check_out_time, weekend_check_out_time, weekend_days, is_default)
SELECT 'Evening (12 AM on weekends)', '16:00', '23:00', '00:00', '{0,6}', true
WHERE NOT EXISTS (SELECT 1 FROM public.shifts WHERE is_default);

-- Put new staff on the default shift.
CREATE OR REPLACE FUNCTION public.assign_default_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _shift uuid;
BEGIN
  SELECT id INTO _shift FROM public.shifts WHERE is_default AND is_active LIMIT 1;
  IF _shift IS NOT NULL THEN
    INSERT INTO public.staff_shift_assignments (staff_id, shift_id)
    VALUES (NEW.id, _shift)
    ON CONFLICT (staff_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_default_shift() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assign_default_shift ON public.staff;
CREATE TRIGGER trg_assign_default_shift
AFTER INSERT ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.assign_default_shift();

-- Everyone active without a shift goes on the default shift now.
INSERT INTO public.staff_shift_assignments (staff_id, shift_id)
SELECT s.id, d.id
FROM public.staff s
CROSS JOIN (SELECT id FROM public.shifts WHERE is_default LIMIT 1) d
WHERE s.is_active
  AND NOT EXISTS (SELECT 1 FROM public.staff_shift_assignments a WHERE a.staff_id = s.id)
ON CONFLICT (staff_id) DO NOTHING;

UPDATE public.staff_shift_assignments a
SET shift_id = (SELECT id FROM public.shifts WHERE is_default LIMIT 1)
FROM public.staff s
WHERE s.id = a.staff_id
  AND s.is_active
  AND a.shift_id IS NULL
  AND a.override_check_in IS NULL;
