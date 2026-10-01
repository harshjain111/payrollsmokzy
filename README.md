# Smokzy Payroll Hub

🏢 Company Context

Smokzy is a fast-growing service company with 50+ staff and scaling.
We require an internal payroll & accounting app that is:

Extremely simple to use

Accounting-accurate (Tally-level logic)

Privacy-first

Ready for CA & audit use

Built for real-world salary + advance workflows

This system must replace Excel, WhatsApp, and manual confusion entirely.

🎯 Core Objectives

Track salary, advances, settlements accurately

Maintain automatic staff-wise ledgers

Support partial payments & carry-forward advances

Provide Tally-style professional reports

Enforce strict salary privacy

Support leave-based salary deductions

Provide clean dashboards for each user type

👥 USER ROLES & ACCESS MODEL (CRITICAL)
1️⃣ Owner (Admin)

Full access to everything

Create/edit staff

Set & modify salaries

Approve requests

Make payments

Settle salaries

View/export all reports

Override entries (with audit logs)

2️⃣ Accountant (Special Dual-Context Access – SINGLE LOGIN)

The accountant is also an employee, so the system must support dual access contexts without exposing salaries.

🔄 Context A: My Account (Staff Context)

View only own salary

View own ledger

Raise requests for self

Exactly same experience as normal staff

🔄 Context B: Accounting Mode

Create payment entries

Raise requests for staff

View ledgers WITHOUT fixed salary visibility

Salary fields of others must be:

Completely hidden OR

Masked (“Restricted”)

🚫 Accountant must never see or infer:

Fixed salary

Net salary

Leave deductions of other staff

⚠️ Salary protection must exist at:

Database level

API level

UI level (not UI only)

3️⃣ Staff

View only their own data

View salary, advances, balance

Raise payment/advance requests

Add “Received amount” entries (subject to owner confirmation)

Cannot edit/delete any financial entry

4️⃣ CA / Auditor (Read-Only)

No transactional access

Can only view & download reports

Salary visibility only in aggregated / report format

🔐 SALARY VISIBILITY MATRIX
User	Own Salary	Others’ Salary
Owner	✅ Yes	✅ Yes
Accountant	✅ Yes	❌ No
Staff	✅ Yes	❌ No
CA	❌ No (direct)	❌ No (direct)
💰 SALARY, ADVANCE & SETTLEMENT LOGIC

Each staff has:

Monthly salary

Auto-calculated daily salary rate

Advance Handling

Any payment before salary settlement = Advance

Advances automatically adjusted during settlement

Partial & Cross-Month Payments

Example:

Salary: ₹20,000

Paid ₹10,000 (Jan 10) → Advance

Paid ₹5,000 (Jan 25) → Advance

Paid ₹10,000 (Feb 5):

₹5,000 → Salary cleared

₹5,000 → New advance

System must auto-split intelligently.

🔁 MONTHLY SALARY SETTLEMENT FLOW (VERY IMPORTANT)

When Owner clicks “Settle Salary”:

Select:

Staff

Month

System prompts:

Number of leave days to deduct

System calculates:

Daily salary × leave days = deduction

Adjusted net salary

System checks:

Advances already paid

Calculates:

Balance payable OR excess advance

Records:

Final payment entry

Ledger posting

Salary marked as SETTLED

Entry becomes immutable

📒 LEDGER SYSTEM (TALLY-STYLE)

Each staff has a running ledger with:

Date

Voucher Type (Payment / Journal / Settlement)

Voucher No.

Description

Debit

Credit

Balance

Tag: Salary / Advance

Reference Month

Paid by (Name of owner who paid)

Approved by

Timestamp

Ledger must behave exactly like Tally personal ledgers.

🧾 PAYMENT REQUEST WORKFLOW

Staff / Accountant raises request:

Amount

Reason

Staff name

Request appears in Owner dashboard

Owner approves/rejects

On approval:

Payment entry opens

Payment recorded:

Amount

Mode (Cash / UPI / Bank)

Paid by (Owner name)

Ledger auto-updated

📊 PROFESSIONAL REPORTING (CA-READY)
1️⃣ Staff Ledger Report

Opening balance

Period debits/credits

Closing balance

2️⃣ Salary Register

Monthly salary

Leave days

Deductions

Net salary

Advances adjusted

Paid amount

Balance

3️⃣ Advance Register

Staff-wise advances outstanding

Ageing

4️⃣ Payment Register

Date-wise payments

Mode

Paid by

5️⃣ Monthly Payroll Summary

Total salary liability

Total paid

Outstanding

Advances created

📥 All reports must be downloadable in:

Excel

PDF
📊 Formats must be CA-friendly and Tally-style

📈 DASHBOARDS
Owner Dashboard

Payroll liability

Advances outstanding

Pending requests

Salary settlement status

Month & staff filters

Accountant Dashboard

Requests raised

Payments recorded

Ledger overview (salary masked)

Staff Dashboard

Salary

Advances

Balance

Request status

🔐 AUDIT, SECURITY & COMPLIANCE

Immutable settled entries

Full audit trail:

Who created

Who approved

Who paid

Timestamped logs

Role-based API enforcement

No salary data leakage via exports or APIs

🧠 UX PHILOSOPHY

Zero accounting jargon for staff

Ledger clarity for finance

One-click actions

Mobile-first (Android priority)

Extremely minimal UI

🛠️ TECHNICAL EXPECTATIONS

Cloud-based backend

Role & context-based auth

Secure export engine

Monthly close logic

Scalable to 200+ staff

Future-ready for GST/statutory modules

🚀 END GOAL

This app should feel like:

**Tally-grade accounting accuracy

Razorpay-level simplicity

Enterprise-grade privacy**

Built specifically for Smokzy’s real operational needs.

Build this with absolute accounting correctness, strict salary confidentiality, and operational ease.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://snug-salary-safe.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9f1417a2-0b73-4fb4-84a1-a73b5fcb1457).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
