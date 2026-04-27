
# Attendance Module Plan

A self-contained attendance feature for **Staff (executives)** and **Accountant** users. They check in / take breaks / check out from their dashboard. Each action mandatorily captures a live photo and GPS location. The Owner and Admin get a full Attendance page plus a per-staff tab to review everything.

---

## 1. Work-day / session model

- A "work day" is defined by the **check-in date** (local time).
  - Example: Check-in Mon 4:00 PM, check-out Tue 2:00 AM → counted as Monday's attendance.
- Each user can have only **one open session** at a time.
- A session contains: check-in, optional multiple breaks (start + end), and a check-out.
- Total worked hours = (check-out − check-in) − sum of break durations.

---

## 2. Database schema (new migration)

Two new tables, both with RLS.

### `attendance_sessions`
- `id` uuid pk
- `user_id` uuid (auth user)
- `staff_id` uuid (nullable — links to staff record if available)
- `work_date` date (the check-in calendar date)
- `check_in_at` timestamptz
- `check_in_photo_url` text (storage path)
- `check_in_lat` numeric, `check_in_lng` numeric, `check_in_accuracy` numeric, `check_in_address` text (nullable)
- `check_out_at` timestamptz nullable
- `check_out_photo_url` text nullable
- `check_out_lat`, `check_out_lng`, `check_out_accuracy`, `check_out_address` nullable
- `total_break_minutes` integer default 0 (denormalized for fast reporting)
- `worked_minutes` integer nullable (computed on check-out)
- `status` text: `active` | `on_break` | `completed`
- `created_at`, `updated_at`

Unique partial index: one `active`/`on_break` session per `user_id`.

### `attendance_breaks`
- `id` uuid pk
- `session_id` uuid → `attendance_sessions.id`
- `start_at` timestamptz
- `end_at` timestamptz nullable
- `duration_minutes` integer nullable
- `created_at`

### Storage
- Reuse a new public-read but write-restricted bucket `attendance-photos` (or private bucket with signed URLs). Photos stored at `{user_id}/{session_id}/checkin.jpg` and `…/checkout.jpg`.

### RLS
- Staff/Accountant: can `SELECT`/`INSERT`/`UPDATE` only their own rows (`user_id = auth.uid()`).
- Owner / Admin / CA: `SELECT` all.
- Owner: full manage.
- Storage bucket policies mirror the same logic.

---

## 3. Capture rules (per your choice)

Mandatory — if camera or geolocation permission is denied / unavailable, the action is blocked with a clear error toast. The UI explains why permissions are required and offers a retry.

Implementation:
- Camera: `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })` in a dialog, capture to canvas → JPEG blob, upload to storage.
- Location: `navigator.geolocation.getCurrentPosition` with `enableHighAccuracy: true`, 15s timeout. Optional reverse-geocoding skipped (we just store lat/lng + a Google Maps link in the UI).

---

## 4. Dashboard widget (Staff + Accountant)

A new `AttendanceWidget` component shown at the top of:
- `StaffDashboard.tsx`
- `AccountantDashboard.tsx` (visible regardless of accounting/personal mode toggle)

Behaviour based on current session state:

| State | UI |
|---|---|
| No active session | Big **Check In** button. Shows today's status if already completed. |
| Active (working) | Live elapsed timer since check-in. Buttons: **Start Break**, **Check Out**. |
| On break | Live break timer. Buttons: **End Break**, **Check Out** (ends break first). |
| Completed today | Summary card: in/out times, total worked, total break, photos thumbnail. |

Flows trigger a `CaptureDialog` for check-in / check-out that:
1. Requests camera + geolocation in parallel.
2. Shows live camera preview + a "Capture & Submit" button (disabled until both are ready).
3. On submit: uploads photo, writes the row, closes the dialog, refreshes widget.

Breaks do **not** require photo/location — just timestamped clicks.

---

## 5. Owner / Admin views (per your choice: Both)

### New page: `/attendance` (sidebar entry "Attendance")
- Filters: date range (default = today), staff/user, status.
- Table columns: Staff, Work date, Check-in, Check-out, Total worked, Break time, Status.
- Row click → drawer with both photos (clickable to enlarge), Google Maps links for both pin locations, break log, raw timestamps.
- Summary cards: total people checked in today, currently on break, completed.

Visible to: Owner, Admin, CA (read-only), Accountant (own records only — accountants see their own attendance via dashboard, not this admin page).

### Per-staff tab: in `StaffDetails.tsx`
- New "Attendance" tab listing that staff member's last 60 days of sessions with the same drawer for details.

### Audit
- Each check-in/out/break action writes to the existing `audit_log` automatically via the standard insert pattern (we'll add an explicit insert in the action handlers since not all tables have audit triggers).

---

## 6. Routing & navigation

- Add `/attendance` route in `App.tsx` (protected).
- Add sidebar nav entry "Attendance" visible to Owner, Admin, CA.
- Add Attendance tab inside `StaffDetails.tsx`.

---

## 7. Files to create / change

**New**
- `supabase/migrations/<timestamp>_attendance_module.sql` — tables, indexes, RLS, storage bucket + policies.
- `src/components/attendance/AttendanceWidget.tsx`
- `src/components/attendance/CaptureDialog.tsx` (camera + geolocation capture)
- `src/components/attendance/SessionDetailsDrawer.tsx`
- `src/components/attendance/StaffAttendanceTab.tsx`
- `src/hooks/useCurrentAttendanceSession.ts`
- `src/lib/attendance.ts` (check-in/out/break handlers, photo upload, audit log)
- `src/pages/Attendance.tsx`

**Edit**
- `src/components/dashboards/StaffDashboard.tsx` — mount widget at top.
- `src/components/dashboards/AccountantDashboard.tsx` — mount widget at top.
- `src/components/layout/AppLayout.tsx` (sidebar) — add "Attendance" link for Owner/Admin/CA.
- `src/App.tsx` — register `/attendance` route.
- `src/pages/StaffDetails.tsx` — add Attendance tab.

---

## 8. Edge cases handled

- Forgotten check-out: if a session is `active`/`on_break` past 6 AM next day, the widget shows a banner "You forgot to check out from <date>" and lets the user complete it (still photo + location, but flagged `late_checkout = true` — small extra column).
- Browser refresh mid-session: state is read fresh from DB via the hook, so timers resume correctly.
- iOS Safari camera quirks: use `playsInline` + user-gesture-triggered `play()`.
- HTTPS required for camera/geolocation — already true on lovable.app and the custom domain.

---

## Notes for the user

- All photos and locations are stored permanently and are visible to Owner/Admin/CA.
- Accountants will see the attendance widget on their dashboard regardless of whether they are in personal or accounting mode.
- We can later add monthly summaries, late-arrival alerts, payroll integration, or geofencing — flag if you want any of these in the first version.
