# Attendance Discipline & Fines

Owner-configurable late-in / early-out penalty system that auto-deducts from monthly salary at settlement. Shifts assign default timing with per-staff override. Staff can be opted out of the attendance module entirely (e.g. club staff using a different app).

## 1. Data model (new tables)

**`shifts`** — `name`, `check_in_time` (time), `check_out_time` (time), `is_active`.

**`staff_shift_assignments`** — `staff_id`, `shift_id` (nullable), `override_check_in` (time, nullable), `override_check_out` (time, nullable), `effective_from`. Effective timing = override if set, else shift's.

**`discipline_rules`** (singleton, Owner-edited)
- `grace_minutes_in` (default 15)
- `late_in_slabs` jsonb: `[{from_min,to_min,amount}, ...]`
- `late_in_half_day_after_min`, `late_in_full_day_after_min`
- `grace_minutes_out`, `early_out_slabs` jsonb
- `early_out_half_day_after_min`, `early_out_full_day_after_min`
- `absent_no_checkin_deduction`, `absent_no_checkout_deduction`

**`attendance_discipline_log`** — `session_id`, `staff_id`, `work_date`, `late_in_minutes`, `early_out_minutes`, `fine_amount`, `fine_reason`, `is_absent`, `absent_reason`.

**Schema change to `staff`**: add `attendance_tracked` boolean default `true`.
- When `false`: staff is hidden from attendance dashboards, no absent marking, no fines computed, no discipline tab shown to them. Their payroll/ledger behaves exactly as today.

RLS: Owner full access; Admin/Accountant select; Staff see own rows only.

## 2. Pages / UI

### A. Owner Settings → "Discipline & Fines" card
Slab editor (add/remove rows), grace windows, half/full-day thresholds, absent deduction values. Live preview ladder.

### B. Owner Settings → "Attendance Coverage" card (new)
Table of all active staff with a toggle "Tracked in attendance". Bulk select supported. Default ON. Turning OFF for a staff: hides them from Shifts grid, attendance lists, prevents fine computation, and stops their app from showing the check-in widget.

### C. Admin/Owner → "Shifts" page (new sidebar entry)
- List shifts with member counts; create/edit dialog.
- Assign-staff multi-select (only `attendance_tracked=true` staff appear).
- Grid tab: staff × shift + inline-editable override time inputs; bulk-assign by row selection.

### D. Staff → My Attendance → new "Discipline" tab (read-only)
Month summary (scheduled vs actual, late minutes, fine total, absent days) + daily list with reason chips. Tab hidden if `attendance_tracked=false`.

### E. Staff Dashboard
`AttendanceWidget` and "My Attendance" sidebar entry hidden when `attendance_tracked=false`. Their dashboard otherwise unchanged.

### F. Salary Settlement
New line "Discipline Fine — ₹X" summed from `attendance_discipline_log` for the month. Owner can override with reason (existing deduction-adjustment pattern). For untracked staff this line is always ₹0 and hidden.

## 3. Logic

**Compute on checkout** (`src/lib/attendance.ts`):
1. Skip entirely if `staff.attendance_tracked = false`.
2. Look up effective scheduled in/out for staff on `work_date`.
3. `late_in_minutes = max(0, actual_in - scheduled_in - grace)`; same for early out.
4. Walk slabs → tier amount; apply half-day / full-day thresholds.
5. Cap combined fine at one full-day salary.
6. If approved leave exists for that date → skip (no fine, no absent).
7. Upsert `attendance_discipline_log`.

**Daily absent sweep** (new edge function `mark-absent-staff`, cron):
- For each active staff where `attendance_tracked=true`, no session on past `work_date`, no approved leave → insert absent log with `absent_no_checkin_deduction`.
- Sessions still `active`/`on_break` 12h past scheduled checkout → mark `is_absent=true` with `absent_no_checkout_deduction`.

**Settlement integration**: extend settlement creation to SUM `fine_amount` for the month and add as `discipline_fine` deduction (new column on `salary_settlements`, mirrors `leave_deduction`).

**Day salary** = `monthly_salary / get_working_days_in_month(month)` — reuse existing function.

## 4. Files

**New**
- `supabase/migrations/...` — tables, columns, RLS, defaults
- `src/pages/Shifts.tsx`, `src/components/shifts/{ShiftDialog,AssignStaffDialog,ShiftGrid}.tsx`
- `src/components/settings/DisciplineRulesCard.tsx`
- `src/components/settings/AttendanceCoverageCard.tsx`
- `src/components/attendance/MyDisciplineTab.tsx`
- `src/lib/discipline.ts`
- `supabase/functions/mark-absent-staff/index.ts`

**Edited**
- `src/lib/attendance.ts` — guard on `attendance_tracked`; call `computeAndLogDiscipline` in `checkOut`
- `src/pages/Settings.tsx` — embed both new cards (Owner-only)
- `src/components/layout/AppLayout.tsx` — Owner/Admin: add "Shifts"; hide "My Attendance" for untracked staff
- `src/components/dashboards/StaffDashboard.tsx`, `AccountantDashboard.tsx` — hide `AttendanceWidget` when untracked
- `src/components/attendance/AttendanceWidget.tsx` — short-circuit if untracked
- `src/App.tsx` — `/shifts` route
- `src/pages/Settlements.tsx`, `src/components/settlements/EnhancedSettlementConfirmDialog.tsx` — surface fine line + include in net
- `src/pages/MyAttendance.tsx` — add Discipline tab; redirect if untracked
- `src/pages/Attendance.tsx` (all-staff view) — filter to tracked staff only

## 5. Out of scope
- Per-shift rule sets (global only)
- Monetary bonus for early check-in
- Auto-rectification of already-settled months when rules change (manual rectify available)
