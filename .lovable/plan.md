# Refine the HR module and mobile experience

## Goal
Give HR a clear split between personal attendance/workflows and workforce monitoring, while preserving strict role boundaries and making key pages comfortable to use on phones without page-level horizontal scrolling.

## HR access and navigation
- Keep HR deny-by-default with an explicit route allow-list.
- Add two HR contexts:
  - **My Account:** personal dashboard, own attendance, own leave requests, own advance requests, own expenses, and settings.
  - **Workforce:** team attendance report, read-only penalties, and Staff-user creation.
- Add a compact context switcher to the sidebar and make `/dashboard` the HR landing page.
- Continue blocking HR from salaries, settlements, payouts, ledgers, reports, staff management, user lists, and all approval actions.

## HR dashboard
- Build a dedicated HR dashboard with today’s workforce status tiles: checked in, on break, checked out, absent, and approved leave.
- Make each tile open a mobile-friendly staff list showing names and useful attendance details for that status.
- Include search/filtering so HR can quickly find a person.
- Add direct actions for attendance reports, personal attendance, leave, advance, expenses, penalties, and Staff-user creation.
- Keep all salary and finance totals out of the workforce dashboard.

## Personal HR workflows
- Reuse the existing staff self-service attendance, leave, advance, and expense flows.
- Treat HR as a personal user on request and expense pages, always filtering records to their linked staff record.
- Require every HR login using personal workflows to be linked to an active staff record; show a clear setup message if not linked.
- Keep HR unable to approve, pay, waive, restore, or edit other employees’ records.

## Read-only penalties
- Allow HR to view the monthly staff penalty breakdown and individual entries.
- Keep waiver/cancellation controls limited to Owner/Admin.
- Add database read permission for HR only; no insert, update, or delete permission.
- Resolve staff names through the existing attendance-safe staff lookup rather than exposing salary fields.

## Backend safeguards
- Add narrowly scoped HR policies for:
  - viewing all discipline/penalty rows;
  - viewing and creating only their own advance, expense, and leave records through their linked staff ID.
- Preserve existing self-service attendance permissions and salary confidentiality.
- Do not grant HR broad access to staff, payment, expense, leave, or accounting data.
- Keep HR user creation limited to Staff accounts.

## Mobile optimization
- Prevent viewport-level horizontal overflow in the shared page shell, headings, dialogs, filters, and action rows.
- Convert the highest-impact remaining desktop-only tables into compact phone card lists: Leave Records, Petty Cash, Users, WhatsApp Logs, and report result tables.
- Make long tab sets wrap or use compact selectors instead of requiring horizontal page scrolling.
- Keep the attendance date matrix contained inside its own dedicated scroller because its date-by-date structure cannot fit into a single phone width; it must never overlap the sidebar or page.
- Tighten fixed-width controls and dialog sizing for 320–430px screens.

## Verification
- Confirm HR can access only the intended personal and workforce pages.
- Confirm HR can clock in/out, review personal records, request leave/advance/expenses, inspect penalties, and create Staff users.
- Confirm HR cannot approve requests, modify penalties, view salaries, or open restricted finance/admin pages.
- Test dashboard tile dialogs and filters with live attendance data.
- Check representative pages at mobile and desktop widths for page-level overflow, clipped text, and overlapping controls.
- Run focused tests, type checks, and review the latest preview build diagnostics.
