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

## Stack

- **Frontend**: Vite + React + TypeScript + Tailwind + shadcn/ui, installable as a PWA.
- **Backend**: [Supabase](https://supabase.com) (Postgres + RLS, Auth, Storage, Edge Functions). Project ref: `xshnuzoqeoqwarvmsgef`.
- **Hosting**: [Vercel](https://vercel.com) (static build of `dist/`, see `vercel.json`).

## Development

You need Node.js 20+ and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
cp .env.example .env   # fill in your Supabase URL and publishable key
npm run dev
```

Useful scripts:

```sh
npm run build   # production build into dist/
npm run test    # vitest
npm run lint    # eslint
```

## Supabase

Everything the app needs on the backend lives in `supabase/`:

- `supabase/migrations/` — the full schema, RLS policies, views and functions. Apply in order.
- `supabase/functions/` — Edge Functions (user management, Telegram/WhatsApp notifications, AI insights, webhooks).
- `supabase/config.toml` — per-function `verify_jwt` settings for the webhook-style functions.

### Connect the CLI to the project

```sh
npm i -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref xshnuzoqeoqwarvmsgef
```

### Database migrations

```sh
supabase db push
```

The six `20260930…` migrations were originally applied through a different migration runner, so the
live project already contains them. They are written to be idempotent (`IF NOT EXISTS`,
`CREATE OR REPLACE`, `DROP POLICY IF EXISTS`), so re-running them is harmless. If `supabase db push`
reports a mismatch between local and remote history, mark the already-applied versions without
re-running them:

```sh
supabase migration list
supabase migration repair --status applied 20260930120000 20260930120100 20260930120200 20260930120300 20260930120400 20260930120500
```

For a brand-new Supabase project, just create it, `supabase link` to it, run `supabase db push`,
and point `.env` / Vercel at the new URL and publishable key.

### Edge Functions

Deploy all functions:

```sh
supabase functions deploy
```

Set the secrets the functions read (`SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically):

| Secret | Used by |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | `send-telegram`, `telegram-report` — a bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_OWNER_CHAT_ID` | `send-telegram`, `telegram-report` — call `send-telegram` with `{ "action": "getUpdates" }` to discover it |
| `AI_API_KEY` | `ai-insights` — API key for an OpenAI-compatible chat-completions provider |
| `AI_BASE_URL` | `ai-insights` — optional, defaults to Google Gemini's OpenAI-compatible endpoint |
| `AI_MODEL` | `ai-insights` — optional, defaults to `gemini-3-flash-preview` |
| `WHATSAPP_ACCESS_TOKEN`, `WABANOW_API_KEY` | `send-attendance-whatsapp` |
| `JUVLON_API_KEY` | `daily-summary-email` |
| `FINANCIAL_CORE_WEBHOOK_URL` | `sync-to-financial` |
| `SMOKZY_ORDER_WEBHOOK_SECRET` | `receive-smokzy-order` |
| `REIMBURSEMENT_WEBHOOK_SECRET` | `receive-reimbursement` |

```sh
supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_OWNER_CHAT_ID=... AI_API_KEY=...
```

### Auth URLs

In the Supabase dashboard under **Authentication → URL Configuration**, set **Site URL** to your
Vercel domain and add it (plus `https://*-<team>.vercel.app/**` for preview deployments) to
**Redirect URLs**. Remove the old `lovable.app` entries.

## Deploy on Vercel

1. In Vercel, **Add New → Project** and import this GitHub repository. Vercel detects Vite; the
   build command (`npm run build`) and output directory (`dist`) are also pinned in `vercel.json`.
2. Add the environment variables for **Production** and **Preview**:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://xshnuzoqeoqwarvmsgef.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the project's anon / publishable key |
   | `VITE_SUPABASE_PROJECT_ID` | `xshnuzoqeoqwarvmsgef` |

3. Deploy. Every push to `main` becomes a production deployment; other branches get preview URLs.

`vercel.json` rewrites all non-asset routes to `index.html` (React Router) and sets no-cache headers
on the service worker so PWA updates roll out immediately.
