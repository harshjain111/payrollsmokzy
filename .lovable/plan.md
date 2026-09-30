## Goal

Add a tightly restricted **HR** user type. HR can view every employee’s attendance/check-in/check-out records and create **Staff login accounts only**. HR cannot access payroll, salaries, advances, expenses, payouts, reports, settings, user administration, or attendance editing.

## Access design

- Owner can assign the new HR role.
- HR navigation contains only:
  - Attendance
  - Create Staff User
  - Sign out/account menu
- After login, HR lands on Attendance rather than a finance dashboard.
- Add role-aware route protection so hidden links cannot be opened directly.
- HR can open the attendance report and existing session details, including breaks and attendance photos, as read-only data.
- HR cannot access penalties or financial deduction details.
- HR can create only `staff` accounts; the server rejects any attempt by HR to submit Owner, Admin, Accountant, CA, or HR roles.
- Existing Owner user-management capabilities remain unchanged. HR receives no edit, delete, password-reset, or full user-list permissions.

## Backend changes

- Add `hr` to the `app_role` database enum.
- Add read-only HR policies for the attendance data needed by the report:
  - active staff identity fields used in the attendance table
  - attendance sessions
  - attendance breaks
  - approved leave dates used to label attendance correctly
  - private attendance photos
- Do not add HR to financial, salary, advance, expense, discipline/penalty, audit, or settings policies.
- Update the user-creation function to:
  - validate the bearer token
  - allow Owner or HR callers
  - enforce `role = staff` for HR on the server
  - continue deriving the creator from the authenticated caller
- Keep role assignment in the protected server function; do not grant HR direct write access to role records.

## App changes

- Extend the shared role type and authentication context with `isHR` and narrow HR capabilities.
- Add HR to the Owner’s role selector, with a clear attendance-and-onboarding description.
- When HR opens the creation screen, lock the role to Staff and remove Owner-only fields/actions.
- Allow HR to read the Attendance page while keeping its management/penalty controls hidden.
- Add reusable role-based route guards for Attendance and Create User, and deny HR access everywhere else.

## Verification

- Confirm Owner can create an HR account.
- Confirm HR can view all staff attendance, check-in/out details, breaks, and photos.
- Confirm HR can create a Staff login account.
- Attempt to submit a privileged role as HR and confirm the backend rejects it.
- Confirm HR cannot open finance, salary, penalties, settings, staff management, full user management, or other protected pages by direct URL.
- Run the backend security checker and verify the app compiles cleanly.

## Technical notes

- Apply the enum addition before policies that reference `hr`, avoiding PostgreSQL enum transaction issues.
- Deploy the updated user-creation function after the database role exists.
- Record role-aware routing as a project architecture rule so future pages remain deny-by-default for HR.
