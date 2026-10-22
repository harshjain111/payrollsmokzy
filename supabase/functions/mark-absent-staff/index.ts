// Nightly sweep: mark untracked-checkin and stuck sessions as absent in attendance_discipline_log.
// Cron-invoked. Uses service role.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ymdLocal(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

/** Days of salary a rule cuts: 'full_day' = 1, 'half_day' = 0.5, '2_days' = 2; null for a ₹ amount. */
function deductionDays(rule: string): number | null {
  if (rule === 'full_day') return 1;
  if (rule === 'half_day') return 0.5;
  const m = /^(\d+(?:\.\d+)?)_days?$/.exec(rule);
  return m ? Number(m[1]) : null;
}

function resolveDeduction(rule: string, dailySalary: number): number {
  const days = deductionDays(rule);
  if (days !== null) return dailySalary * days;
  const n = Number(rule);
  return isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // Date to evaluate: yesterday (local server time UTC; acceptable for IST sweep run at night)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const workDate = ymdLocal(yesterday);

    const { data: rulesRow } = await supabase
      .from('discipline_rules')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!rulesRow) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no rules' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: staffList } = await supabase
      .from('staff')
      .select('id, monthly_salary, attendance_tracked, is_active')
      .eq('is_active', true)
      .eq('attendance_tracked', true);

    if (!staffList || staffList.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const wd = new Date(workDate + 'T00:00:00');
    const daysInMonth = new Date(wd.getFullYear(), wd.getMonth() + 1, 0).getDate();

    // Only staff with a shift have a check-in time to miss (same rule as check-absent-staff and
    // the "no shift assigned — penalties skipped" warning on the Attendance page).
    const { data: assigns } = await supabase
      .from('staff_shift_assignments')
      .select('staff_id, shift_id, override_check_in');
    const scheduled = new Set(
      (assigns ?? [])
        .filter((a: { shift_id: string | null; override_check_in: string | null }) => a.shift_id || a.override_check_in)
        .map((a: { staff_id: string }) => a.staff_id),
    );

    let absentCreated = 0;
    let stuckClosed = 0;

    for (const s of staffList) {
      const dailySalary = (Number(s.monthly_salary) || 0) / daysInMonth;

      // Already logged?
      const { data: existing } = await supabase
        .from('attendance_discipline_log')
        .select('id')
        .eq('staff_id', s.id)
        .eq('work_date', workDate)
        .maybeSingle();

      // Has approved leave?
      const { data: leave } = await supabase
        .from('leave_records')
        .select('id')
        .eq('staff_id', s.id)
        .eq('leave_date', workDate)
        .eq('status', 'approved')
        .maybeSingle();
      if (leave) continue;

      // Any session that day?
      const { data: session } = await supabase
        .from('attendance_sessions')
        .select('id, status')
        .eq('staff_id', s.id)
        .eq('work_date', workDate)
        .maybeSingle();

      if (!session) {
        if (existing || !scheduled.has(s.id)) continue;
        const fine = resolveDeduction(rulesRow.absent_no_checkin_deduction, dailySalary);
        await supabase.from('attendance_discipline_log').insert({
          staff_id: s.id,
          work_date: workDate,
          fine_amount: Math.round(fine * 100) / 100,
          fine_reason: 'Absent — no check-in',
          is_absent: true,
          absent_reason: 'no_checkin',
          deduction_days: deductionDays(rulesRow.absent_no_checkin_deduction),
        });
        absentCreated++;
      } else if (session.status === 'active' || session.status === 'on_break') {
        // Stuck session past day end → mark absent (no_checkout)
        const fine = resolveDeduction(rulesRow.absent_no_checkout_deduction, dailySalary);
        if (existing) {
          await supabase
            .from('attendance_discipline_log')
            .update({
              fine_amount: Math.round(fine * 100) / 100,
              fine_reason: 'Absent — no check-out',
              is_absent: true,
              absent_reason: 'no_checkout',
              deduction_days: deductionDays(rulesRow.absent_no_checkout_deduction),
              session_id: session.id,
              computed_at: new Date().toISOString(),
            })
            .eq('id', (existing as { id: string }).id);
        } else {
          await supabase.from('attendance_discipline_log').insert({
            staff_id: s.id,
            session_id: session.id,
            work_date: workDate,
            fine_amount: Math.round(fine * 100) / 100,
            fine_reason: 'Absent — no check-out',
            is_absent: true,
            absent_reason: 'no_checkout',
            deduction_days: deductionDays(rulesRow.absent_no_checkout_deduction),
          });
        }
        stuckClosed++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, workDate, absentCreated, stuckClosed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('mark-absent-staff error', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
