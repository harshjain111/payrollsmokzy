import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Slab = 'on_time' | 'level_1' | 'level_2' | 'half_day' | 'full_day';

interface Payload {
  staff_name: string;
  staff_phone: string;
  staff_id?: string | null;
  event_type: 'checkin' | 'checkout';
  actual_time: string;
  scheduled_time: string;
  slab: Slab;
  deduction_amount: number;
}

function formatIST(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function stripPlus(phone: string): string {
  return phone.startsWith('+') ? phone.slice(1) : phone;
}

function buildPayload(p: Payload): { templateName: string; body: Record<string, unknown> } {
  const to = stripPlus(p.staff_phone);
  const timeStr = formatIST(p.actual_time);
  const amt = `₹${p.deduction_amount}`;

  let templateName = '';
  let parameters: Array<{ type: 'text'; text: string }> = [];

  switch (p.slab) {
    case 'on_time':
      templateName = 'attendance_on_time';
      parameters = [
        { type: 'text', text: p.staff_name },
        { type: 'text', text: timeStr },
      ];
      break;
    case 'level_1':
      templateName = 'attendance_late_level_1';
      parameters = [
        { type: 'text', text: p.staff_name },
        { type: 'text', text: timeStr },
        { type: 'text', text: amt },
      ];
      break;
    case 'level_2':
      templateName = 'attendance_late_level_2';
      parameters = [
        { type: 'text', text: p.staff_name },
        { type: 'text', text: timeStr },
        { type: 'text', text: amt },
      ];
      break;
    case 'half_day':
      templateName = 'attendance_half_day';
      parameters = [
        { type: 'text', text: p.staff_name },
        { type: 'text', text: amt },
      ];
      break;
    case 'full_day':
      templateName = 'attendance_full_day';
      parameters = [
        { type: 'text', text: p.staff_name },
        { type: 'text', text: amt },
      ];
      break;
  }

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en', policy: 'deterministic' },
      components: [
        {
          type: 'BODY',
          parameters,
        },
      ],
    },
  };

  return { templateName, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')?.trim();
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')?.trim();

  console.log(
    'Token check:',
    accessToken ? accessToken.substring(0, 10) + '...' + accessToken.slice(-5) : 'MISSING',
  );
  console.log('Phone number ID:', phoneNumberId ?? 'MISSING');

  if (!accessToken || !phoneNumberId) {
    return new Response(
      JSON.stringify({ success: false, error: 'WhatsApp credentials not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const { templateName, body: waBody } = buildPayload(payload);

  let success = false;
  let metaMessageId: string | null = null;
  let errorMessage: string | null = null;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(waBody),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      errorMessage = data?.error?.message || `Meta API error ${res.status}`;
      console.error('Meta API rejected:', JSON.stringify(data));
    } else {
      metaMessageId = data?.messages?.[0]?.id ?? null;
      success = true;
    }
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('Fetch error:', errorMessage);
  }

  try {
    await supabase.from('whatsapp_notification_log').insert({
      staff_id: payload.staff_id ?? null,
      staff_phone: stripPlus(payload.staff_phone),
      event_type: payload.event_type,
      slab: payload.slab,
      template_name: templateName,
      deduction_amount: payload.deduction_amount ?? 0,
      success,
      error_message: errorMessage,
      meta_message_id: metaMessageId,
    });
  } catch (e) {
    console.error('Failed to log whatsapp send:', e);
  }

  if (success) {
    return new Response(
      JSON.stringify({ success: true, message_id: metaMessageId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  return new Response(
    JSON.stringify({ success: false, error: errorMessage }),
    { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
