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
  staff_id?: string;
  event_type: 'checkin' | 'checkout';
  actual_time: string;
  scheduled_time: string;
  slab: Slab;
  deduction_amount: number;
}

function formatIndianTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function buildTemplate(p: Payload): { name: string; params: string[] } {
  const time = formatIndianTime(p.actual_time);
  const amt = `₹${p.deduction_amount}`;
  switch (p.slab) {
    case 'on_time':
      return { name: 'attendance_on_time', params: [p.staff_name, time] };
    case 'level_1':
      return { name: 'attendance_late_level_1', params: [p.staff_name, time, amt] };
    case 'level_2':
      return { name: 'attendance_late_level_2', params: [p.staff_name, time, amt] };
    case 'half_day':
      return { name: 'attendance_half_day', params: [p.staff_name, amt] };
    case 'full_day':
      return { name: 'attendance_full_day', params: [p.staff_name, amt] };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const required = ['staff_name', 'staff_phone', 'event_type', 'actual_time', 'scheduled_time', 'slab'];
  for (const k of required) {
    if (!(k in body) || (body as Record<string, unknown>)[k] == null) {
      return new Response(JSON.stringify({ success: false, error: `Missing field: ${k}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) {
    return new Response(JSON.stringify({ success: false, error: 'WhatsApp credentials not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { name: templateName, params } = buildTemplate(body);

  const waBody = {
    messaging_product: 'whatsapp',
    to: body.staff_phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en', policy: 'deterministic' },
      components: [
        {
          type: 'BODY',
          parameters: params.map((text) => ({ type: 'text', text })),
        },
      ],
    },
  };

  let success = false;
  let metaMessageId: string | null = null;
  let errorMessage: string | null = null;

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(waBody),
    });
    const data = await res.json();
    if (!res.ok) {
      errorMessage = data?.error?.message || `Meta API error ${res.status}`;
    } else {
      metaMessageId = data?.messages?.[0]?.id ?? null;
      success = true;
    }
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Unknown error';
  }

  try {
    await supabase.from('whatsapp_notification_log').insert({
      staff_id: body.staff_id ?? null,
      staff_phone: body.staff_phone,
      event_type: body.event_type,
      slab: body.slab,
      template_name: templateName,
      deduction_amount: body.deduction_amount ?? 0,
      success,
      error_message: errorMessage,
      meta_message_id: metaMessageId,
    });
  } catch (e) {
    console.error('Failed to log whatsapp send:', e);
  }

  if (success) {
    return new Response(JSON.stringify({ success: true, message_id: metaMessageId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ success: false, error: errorMessage }), {
    status: 502,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
