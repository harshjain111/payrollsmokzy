

## Plan: Set Up Webhook Secret for Smokzy Order Sync

The `receive-smokzy-order` edge function is already deployed and checks for a secret via the `x-webhook-secret` header. We just need to:

### Step 1: Add the webhook secret
Store a secret called `SMOKZY_ORDER_WEBHOOK_SECRET` in the backend. I'll generate a strong random value for you (e.g. `smkzy_wh_a7F9xK2mP4qR8vN1`), or you can choose your own.

### Step 2: Provide you the complete code
Once the secret is saved, you'll use this in your Smokzy party app:

```text
Webhook URL:
  POST https://xshnuzoqeoqwarvmsgef.supabase.co/functions/v1/receive-smokzy-order

Headers:
  Content-Type: application/json
  x-webhook-secret: <your-secret-value>

Body:
  {
    "customer_name": "...",
    "event_date_start": "2026-03-20T18:00:00",
    "event_date_end": "2026-03-20T22:00:00",
    "venue_name": "..."
  }
```

### No code changes needed
The edge function already handles secret validation, event creation, and error responses. We only need to store the secret value.

