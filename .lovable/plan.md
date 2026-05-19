## Goals
1. **Master penalty on/off switch** — Owner/Admin can turn the whole penalty system off so no fines/half-day/full-day deductions are computed and only on-time WhatsApp greetings go out.
2. **Cancel a specific penalty** — Owner/Admin can soft-cancel any single system-charged penalty (with mandatory reason) so it stops contributing to the staff's settlement.
3. Make the recently-added attendance settings (Discipline Rules, Attendance Coverage) usable by **both Admin and Owner**, not just Owner.

## 1. Database migration

`discipline_rules`
- Add `penalties_enabled boolean NOT NULL DEFAULT true`.

`attendance_discipline_log`
- Add `is_cancelled boolean NOT NULL DEFAULT false`
- Add `cancelled_by uuid`, `cancelled_by_name text`, `cancelled_at timestamptz`, `cancellation_reason text`

RLS additions:
- `discipline_rules`: add policy "Admins manage discipline rules" (`has_role(auth.uid(),'admin')`) for ALL.
- `attendance_discipline_log`: add policy "Admins manage discipline log" for ALL (owner policy already exists).
- `staff`: allow Admin to update `attendance_tracked`. Add an ALL-columns Admin UPDATE policy plus a BEFORE UPDATE trigger that raises if a non-owner changes any column other than `attendance_tracked` / `updated_at`. Keeps salary safe.

## 2. Backend logic (`src/lib/discipline.ts`)

`computeAndLogDiscipline()`
- Read `penalties_enabled`. If `false`, do NOT compute slabs — write/upsert a log row with `fine_amount = 0`, `is_absent = false`, blank reason. Return slab `on_time` so check-in still triggers an on-time WhatsApp greeting.

`getMonthlyDisciplineFine()`
- Treat `is_cancelled = true` rows as `fine_amount = 0` in the sum (still return them in `logs` for UI display).

`src/lib/attendance-whatsapp.ts`
- Before slab calculation, read `penalties_enabled`. If false: on check-in send `on_time` template only; on check-out send nothing. Never send `late_level_1/2`, `half_day`, `full_day`.

No salary-settlement code changes needed — `system_deduction_days` already derives from the (now adjusted) sum.

## 3. UI

### DisciplineRulesCard
- Replace `if (!isOwner) return null` with `if (!isOwner && !isAdmin) return null`.
- Add a prominent **Switch at the top**: "Apply penalties for late / early / absent" bound to `rules.penalties_enabled`.
- When OFF: dim the rest of the card and show a banner "Penalties are disabled — no fines or half/full-day deductions will be applied. Only on-time WhatsApp greetings will be sent."
- Include `penalties_enabled` in the save payload.

### AttendanceCoverageCard
- Replace owner-only guards with `isOwner || isAdmin`.

### MyDisciplineTab (staff view)
- For `is_cancelled` rows: strike-through the amount, show green "Cancelled" badge with tooltip (reason + who cancelled + when).

### Owner/Admin penalty management (new)
- Add a "Penalties" panel inside `StaffAttendanceSection` (or a tab on the Attendance page) listing discipline_log rows for the selected staff/date range.
- Each non-cancelled row with `fine_amount > 0` or `is_absent = true` shows a **"Cancel penalty"** button (visible only if `isOwner || isAdmin`).
- Clicking opens a confirm dialog with mandatory reason textarea.
- On confirm: update row with `is_cancelled=true`, `cancelled_by=auth.uid()`, `cancelled_by_name`, `cancelled_at=now()`, `cancellation_reason`.
- Already-cancelled rows show a small **"Restore"** action (owner/admin) that clears the cancellation fields.
- Re-fetch and toast on success.

## 4. Memory updates

- `mem://features/penalty-system` — Master on/off switch (Owner+Admin) plus per-day cancel/restore with mandatory reason. Cancelled rows contribute ₹0 to settlement; remain visible with audit info.

## Out of scope
- Editing fine amounts manually (only full cancel/restore).
- Retroactively changing already-settled months: cancellation is allowed on the row, but the settled `system_deduction_days` snapshot is immutable; the change only affects future settlements.
