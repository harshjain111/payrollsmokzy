
# Webhook for Auto-Creating Expenses from Smokzy DC Reimbursements

## What This Does

When someone clicks "Reimburse" in your Smokzy DC app, it will automatically send data to this app via a webhook. This app will then:
1. Look up the staff member by their phone number
2. Create an expense entry under that staff member's account with category "logistics"
3. Include order details (order ID, customer name, address, delivery date) in the expense description

## How It Works

```text
Smokzy DC App                          This App (Payroll)
+-----------------+                    +-------------------------+
| Admin clicks    |  POST webhook      | receive-reimbursement   |
| "Reimburse"     | -----------------> | edge function           |
|                 |   JSON payload     |                         |
+-----------------+                    | 1. Find staff by phone  |
                                       | 2. Create expense       |
                                       |    (logistics, pending) |
                                       +-------------------------+
```

## What You Need to Do in Smokzy DC

After we build this, you will need to add a POST request in your Smokzy DC app's reimbursement flow that sends this JSON to the webhook URL:

```json
{
  "phone": "9876543210",
  "amount": 150,
  "order_id": "ORD-1234",
  "order_date": "2026-02-20",
  "customer_name": "John Doe",
  "customer_address": "123 Main St, City",
  "delivery_date": "2026-02-20"
}
```

The webhook URL will be:
`https://xshnuzoqeoqwarvmsgef.supabase.co/functions/v1/receive-reimbursement`

You will also need to pass a secret API key in the header for security (details below).

## What We Will Build Here

### 1. New Edge Function: `receive-reimbursement`

- Receives the POST request from Smokzy DC
- Validates a shared secret key (via an `x-webhook-secret` header) to prevent unauthorized calls
- Looks up the staff member by matching the `phone` field against the `staff` table
- If found, inserts an expense record with:
  - **staff_id**: matched from phone number
  - **amount**: from the payload
  - **category**: `logistics`
  - **expense_date**: the `order_date` from the payload
  - **description**: formatted as: `"Reimbursement for Order #ORD-1234 | Customer: John Doe | Address: 123 Main St | Delivery: 2026-02-20"`
  - **status**: `pending` (so it appears for approval in this app)
- Returns success/error response to Smokzy DC

### 2. New Secret: `REIMBURSEMENT_WEBHOOK_SECRET`

A shared secret that Smokzy DC must include in the `x-webhook-secret` header. This prevents random people from creating expenses via the webhook URL.

### 3. Config Update

Register the new function in `supabase/config.toml` with `verify_jwt = false` (since Smokzy DC won't have a JWT for this app -- authentication is handled via the shared secret instead).

## Security

- The edge function uses a **service role key** (already available as `SUPABASE_SERVICE_ROLE_KEY`) to insert expenses, bypassing RLS since the webhook caller isn't a logged-in user of this app.
- The shared `x-webhook-secret` header ensures only Smokzy DC can call the endpoint.

## Technical Details

### Edge function file: `supabase/functions/receive-reimbursement/index.ts`

The function will:
1. Handle CORS preflight (OPTIONS)
2. Validate the `x-webhook-secret` header against `REIMBURSEMENT_WEBHOOK_SECRET`
3. Parse the JSON body and validate required fields (phone, amount, order_id, order_date)
4. Query `staff` table using service role client: `SELECT id FROM staff WHERE phone = <phone> AND is_active = true`
5. If no staff found, return 404 with clear error message
6. Insert into `expenses` table with the mapped fields
7. Return the created expense ID on success

### Config change: `supabase/config.toml`

Add:
```toml
[functions.receive-reimbursement]
verify_jwt = false
```

## Steps Summary

1. You provide a shared secret value for `REIMBURSEMENT_WEBHOOK_SECRET`
2. We create the `receive-reimbursement` edge function
3. We update the config
4. You add the webhook call in Smokzy DC's reimbursement flow, passing the secret in the `x-webhook-secret` header
