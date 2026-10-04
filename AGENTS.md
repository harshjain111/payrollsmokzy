## Access architecture

- Role-aware routing is deny-by-default for HR: only `/attendance` and `/users/new` are allowed, because hidden navigation is not a security boundary.
- HR access uses explicit personal/workforce allow-lists; personal records are staff-linked and penalties are read-only, preserving salary and finance isolation.
- App installation state and prompting are centralized in the shared install hook so Settings and the global prompt stay synchronized.
- Auth data refreshes on tab return must run in the background without toggling global loading, so active pages and unsaved input remain mounted.
- Salary settlement is server-side: `settle_salary` / `undo_salary_settlement` / `get_payroll_month` (owner or admin) recompute every amount atomically; the client only sends choices. Payouts stay owner-only.