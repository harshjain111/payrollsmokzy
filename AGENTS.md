## Access architecture

- Role-aware routing is deny-by-default for HR: only `/attendance` and `/users/new` are allowed, because hidden navigation is not a security boundary.
- HR access uses explicit personal/workforce allow-lists; personal records are staff-linked and penalties are read-only, preserving salary and finance isolation.
- App installation state and prompting are centralized in the shared install hook so Settings and the global prompt stay synchronized.
- Auth data refreshes on tab return must run in the background without toggling global loading, so active pages and unsaved input remain mounted.
- Salary settlement is server-side: `settle_salary` / `undo_salary_settlement` / `get_payroll_month` (owner or admin) recompute every amount atomically; the client only sends choices. Salary payouts are owner or admin; the settlement is marked paid through `mark_salary_settlement_paid`.
- Attendance corrections go through `save_attendance_record` / `delete_attendance_record` (owner or admin, reason required, stamped and written to audit_log, blocked for settled months); HR and CA stay read-only.
- Attendance capture rechecks open sessions before insert-only photo uploads and displays SDK object errors; this prevents stale-card repeat submissions without weakening storage permissions.
- Attendance retries only transient reads and fresh-path photo uploads; uncertain writes reconcile by session ID and checkout updates only open sessions, preventing duplicate punches after lost responses.
- PWA caches app assets only; authenticated API requests are network-only so stale cached attendance cannot be mistaken for a confirmed server state.
- Absence cuts are stored in days on the penalty row (`deduction_days`, default rule `2_days`); owners/admins change one with `adjust_absence_deduction`. Approving a leave, even after the day, waives that day's penalties through the `trg_sync_leave_penalties` trigger, and un-approving it restores them; both are blocked for settled months. Staff see their own cuts through `get_my_deductions`, which uses the same numbers as payroll.
- Auth counts as loading until the signed-in user's role and staff record are loaded (`loadedUserId` in AuthContext), so no screen renders with an unknown role; "Role Not Assigned" is shown only when the server confirms the login has no role, and a failed load shows Retry instead.
