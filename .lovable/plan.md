

# Implement Smokzy DC Reimbursement Webhook

## Step 1: Set up the shared secret
Request you to input a secret value for `REIMBURSEMENT_WEBHOOK_SECRET`. You can use any strong string you like (e.g. `smokzy-reimburse-2026-secure`). You will use this same value in the Smokzy DC app when calling the webhook.

## Step 2: Create the edge function
Create `supabase/functions/receive-reimbursement/index.ts` that:
- Validates the `x-webhook-secret` header
- Looks up staff by phone number
- Inserts an expense with category "logistics", status "pending", and a description containing Order ID, customer name, address, and delivery date

## Step 3: Update config
Add `verify_jwt = false` for the new function in `supabase/config.toml`.

## Step 4: Deploy and test
Deploy the function and test it with a sample call.

---

## Technical Details

### Edge function: `supabase/functions/receive-reimbursement/index.ts`

```text
POST /functions/v1/receive-reimbursement
Header: x-webhook-secret: <your-secret>

Body:
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

The function will:
1. Check `x-webhook-secret` matches `REIMBURSEMENT_WEBHOOK_SECRET`
2. Query: `SELECT id FROM staff WHERE phone = <phone> AND is_active = true`
3. Insert into `expenses` table with mapped fields
4. Return the created expense ID

### Config addition
```toml
[functions.receive-reimbursement]
verify_jwt = false
```

