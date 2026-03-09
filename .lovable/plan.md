

# Petty Cash Management Module - Implementation Plan

## Overview

Add a full Petty Cash module that tracks cash floats given to admins, integrates with the existing payout system as a new payment mode, and provides audit-grade visibility for the owner.

## Database Changes

### 1. New table: `petty_cash_transactions`

```sql
CREATE TYPE petty_cash_transaction_type AS ENUM (
  'opening_balance', 'top_up', 'expense_payment', 'advance_payment'
);

CREATE TABLE petty_cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  transaction_type petty_cash_transaction_type NOT NULL,
  amount NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  reference_type TEXT,          -- 'expense', 'payment_request', etc.
  reference_id UUID,            -- links to expense/payment_request id
  notes TEXT,
  source TEXT,                  -- for top-ups: 'owner', 'cash_collection', 'other'
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE petty_cash_transactions ENABLE ROW LEVEL SECURITY;
-- Owner: full access; Admin: SELECT + INSERT only
```

### 2. New account in chart of accounts

Insert a new account code `1300` - "Petty Cash" (asset type) for double-entry integration.

### 3. Add `petty_cash` to the `payment_mode` enum

```sql
ALTER TYPE payment_mode ADD VALUE 'petty_cash';
```

This makes "Petty Cash" available as a payment mode in payout dialogs.

## Frontend Changes

### 1. New page: `src/pages/PettyCash.tsx`

- **Dashboard tiles**: Current Balance, Total Top-Ups, Total Spent, Last Top-Up Date (computed from `petty_cash_transactions`)
- **Transaction ledger table**: Date, Type, Amount (+/-), Balance After, Reference, Notes, Entered By
- **Add Top-Up dialog**: Amount, Notes, Source selector (Owner / Cash Collection / Other)
- **Filters** (owner only): Date range, staff, expense category
- Balance validation: prevent negative balance on all deductions

### 2. Route & Navigation

- Add `/petty-cash` route in `App.tsx` (ProtectedRoute)
- Add "Petty Cash" nav item under "Finance" section for Owner and Admin in `AppLayout.tsx`
- Use `Coins` icon from lucide-react

### 3. Payout Integration (`src/pages/Payouts.tsx`)

- Add `{ value: 'petty_cash', label: 'Petty Cash' }` to `PAYMENT_MODES` array
- When "Petty Cash" is selected as payment mode:
  - Fetch current petty cash balance
  - Show balance in the dialog
  - Block payout if balance insufficient (disable Pay button + warning)
  - On successful payout, insert a `petty_cash_transactions` record (type: `expense_payment` or `advance_payment`) and deduct from balance

### 4. Journal Entry Integration (`src/lib/journal-entries.ts`)

- Add `PETTY_CASH: '1300'` to `ACCOUNT_CODES`
- Add `petty_cash: ACCOUNT_CODES.PETTY_CASH` to `PAYMENT_MODE_TO_ACCOUNT`
- This ensures double-entry correctly credits the Petty Cash asset account instead of Cash/Bank

### 5. Type updates (`src/types/database.ts`)

- Add `'petty_cash'` to `PaymentMode` type
- Add petty cash transaction types

## RLS Policies

- **Owner**: Full access (ALL) on `petty_cash_transactions`
- **Admin**: SELECT + INSERT only (can view and record, but cannot modify/delete)
- **All others**: No access

## Safety Enforcement

- Balance computed as running total: each INSERT calculates `balance_after` from the previous latest record
- A validation check before INSERT ensures `balance_after >= 0`; if negative, reject the transaction
- No UPDATE or DELETE allowed on the table (enforced via RLS - no UPDATE/DELETE policies for anyone except owner, and even owner should only append)

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/pages/PettyCash.tsx` | Create - full module page |
| `src/App.tsx` | Add route |
| `src/components/layout/AppLayout.tsx` | Add nav item for owner + admin |
| `src/pages/Payouts.tsx` | Add petty_cash payment mode + balance check |
| `src/lib/journal-entries.ts` | Add account code mapping |
| `src/types/database.ts` | Add types |
| Migration SQL | Create table, enum value, account, RLS policies |

