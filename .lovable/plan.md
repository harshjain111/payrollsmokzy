I will recreate `send-attendance-whatsapp` from scratch and keep the existing app integration intact.

Plan:

1. Delete and recreate the Edge Function source
   - Replace `supabase/functions/send-attendance-whatsapp/index.ts` with a fresh implementation.
   - Keep the function name exactly `send-attendance-whatsapp` so existing check-in/check-out calls continue working.

2. Implement exact Meta API credential handling
   - Read secrets with:
     - `Deno.env.get('WHATSAPP_ACCESS_TOKEN')?.trim()`
     - `Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')?.trim()`
   - Add the requested masked token log:
     - `Token check: first10...last5`
   - Send the Meta request with only:
     - `Authorization: Bearer ${accessToken}`
     - `Content-Type: application/json`
   - No extra Meta request headers and no token modification beyond `.trim()`.

3. Rebuild payload generation exactly by slab
   - `on_time` → `attendance_on_time`, parameters: staff name, IST formatted actual time.
   - `level_1` → `attendance_late_level_1`, parameters: staff name, IST formatted actual time, `₹amount`.
   - `level_2` → `attendance_late_level_2`, parameters: staff name, IST formatted actual time, `₹amount`.
   - `half_day` → `attendance_half_day`, parameters: staff name, `₹amount`.
   - `full_day` → `attendance_full_day`, parameters: staff name, `₹amount`.
   - Strip any leading `+` from `staff_phone` before sending.
   - Format `actual_time` using the exact `toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })` pattern.

4. Preserve CORS and response shape
   - Support `OPTIONS` preflight.
   - Include:
     - `Access-Control-Allow-Origin: *`
     - `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`
   - Return `{ success: true, message_id: '...' }` on success.
   - Return `{ success: false, error: '...' }` on failure.

5. Ensure logging table exists
   - The migration for `public.whatsapp_notification_log` already exists with the requested columns and RLS.
   - I will not duplicate it unless implementation approval reveals the live backend is missing it; if needed, I’ll add an idempotent migration using `CREATE TABLE IF NOT EXISTS`.

6. Validate after implementation
   - Deploy/test the function through the backend function tool.
   - Send a test request to `918811040799`.
   - Check the function response/log entry to confirm whether Meta accepts the token and which template was selected.