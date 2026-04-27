# Staff Attendance & Leave Hub

Give Staff and Accountants a single page to see their own attendance history, daily session logs, and manage their leave — all in one tab.

## What gets built

### 1. New unified page: `/my-attendance`
Accessible to **Staff** and **Accountant** roles only (their own data). Owners/Admins/CA continue to use the existing `/attendance` page (all-staff view).

Page layout — three tabs:

```text
┌──────────────────────────────────────────────────┐
│ My Attendance                                    │
├──────────────────────────────────────────────────┤
│ [ Summary ] [ Daily Logs ] [ Leave ]             │
└──────────────────────────────────────────────────┘
```

**Tab A — Summary (default)**
- Month selector (defaults to current month)
- Stat cards: Days Present, Total Hours Worked, Avg Hours/Day, Late Checkouts, Leave Days Taken, Break Time Total
- Mini calendar heatmap for the month (green = present, amber = on leave, gray = absent)

**Tab B — Daily Logs**
- Filter: month + status (all / completed / late checkout)
- Table/cards (responsive — table on desktop, stacked cards on mobile) showing each session:
  - Work date, Check-in time, Check-out time, Worked hours, Break minutes, Late flag
  - Tap row → opens existing `SessionDetailsDrawer` with photos, GPS map links, break list

**Tab C — Leave**
- Reuses existing `CreateLeaveDialog` ("Apply for Leave" button)
- Lists the staff member's own leave records (pending / approved / rejected) with the same non-threatening UX already used in Staff portal
- Same data source as `/leave-records` filtered to the current user's `staff_id`

### 2. Sidebar navigation changes
For Staff and Accountant roles:
- Add **"My Attendance"** entry (Clock icon) → `/my-attendance`
- Remove the standalone **"Leave"** entry from the staff sidebar (leave is now inside the attendance hub) — keeps things simple per the user's request

Owner/Admin/CA sidebar is unchanged. Their `/attendance` (all-staff) and `/leave-records` (all-staff) continue as today.

### 3. Dashboard widget tweak
On `StaffDashboard` and `AccountantDashboard`, the existing `AttendanceWidget` gets a small "View History →" link that routes to `/my-attendance`.

## Technical details

- New file: `src/pages/MyAttendance.tsx` — three-tab shell (`Tabs` from shadcn).
- New components:
  - `src/components/attendance/MyAttendanceSummary.tsx` — month selector + stat cards + calendar heatmap. Pulls from `attendance_sessions` filtered by `user_id = auth.uid()` and `work_date` in selected month, plus `leave_records` for the same staff/month.
  - `src/components/attendance/MyAttendanceLogs.tsx` — list of sessions, opens `SessionDetailsDrawer`.
  - `src/components/attendance/MyLeaveSection.tsx` — wraps `CreateLeaveDialog` + own-staff leave list (extracted from existing `LeaveRecords.tsx` rendering logic).
- Route added in `src/App.tsx`: `<Route path="/my-attendance" element={<ProtectedRoute><MyAttendance /></ProtectedRoute>} />`.
- `src/components/layout/AppLayout.tsx`: update the `staff` and `accountant` branches in `getNavSections` to add the new entry and remove the standalone Leave link for staff.
- No DB schema changes — existing RLS already restricts staff to their own `attendance_sessions`, `attendance_breaks`, and `leave_records`.
- Reuse `getSignedPhotoUrl`, `formatMinutes`, `googleMapsLink` from `src/lib/attendance.ts`.

## What does NOT change
- Owner/Admin/CA `/attendance` page (all-staff view) stays exactly as is.
- Existing `/leave-records` page stays for non-staff roles.
- No DB migrations, no edge function changes, no RLS changes.
