import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user with their token
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { password, dateFrom, dateTo, backupTimestamp } = await req.json();

    if (!password || !dateFrom || !dateTo) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!backupTimestamp) {
      return new Response(
        JSON.stringify({ success: false, error: 'Backup must be completed before clearing data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify password by attempting sign in
    const { error: signInError } = await userClient.auth.signInWithPassword({
      email: user.email!,
      password,
    });

    if (signInError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Incorrect password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user is Owner
    const { data: roleData, error: roleError } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || roleData?.role !== 'owner') {
      return new Response(
        JSON.stringify({ success: false, error: 'Only owners can clear transaction data' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[clear-transaction-data] Owner ${user.email} initiating data clear: ${dateFrom} to ${dateTo}`);

    // Execute deletion in a transaction-like manner
    // Order matters due to foreign key constraints
    const deletedCounts: Record<string, number> = {
      journal_lines: 0,
      journal_entries: 0,
      ledger_entries: 0,
      salary_settlements: 0,
      payment_requests: 0,
      expenses: 0,
      total: 0,
    };

    // 1. Get journal entry IDs in date range first
    const { data: journalEntryIds } = await adminClient
      .from('journal_entries')
      .select('id')
      .gte('entry_date', dateFrom)
      .lte('entry_date', dateTo);

    if (journalEntryIds && journalEntryIds.length > 0) {
      const ids = journalEntryIds.map(e => e.id);
      
      // 1a. First, remove immutability flag on journal entries to allow deletion
      const { error: immutableJeError } = await adminClient
        .from('journal_entries')
        .update({ is_immutable: false })
        .in('id', ids);

      if (immutableJeError) {
        console.error('Error removing immutability from journal_entries:', immutableJeError);
        // Continue - this might fail if trigger prevents even UPDATE, but we'll try delete anyway
      }

      // 1b. Delete journal_lines (must be first due to FK to journal_entries)
      const { error: linesError, count: linesCount } = await adminClient
        .from('journal_lines')
        .delete({ count: 'exact' })
        .in('journal_entry_id', ids);

      if (linesError) {
        console.error('Error deleting journal_lines:', linesError);
        throw new Error(`Failed to delete journal lines: ${linesError.message}`);
      }
      deletedCounts.journal_lines = linesCount || 0;
    }

    // 2. Delete journal_entries (now with is_immutable = false)
    if (journalEntryIds && journalEntryIds.length > 0) {
      const ids = journalEntryIds.map(e => e.id);
      const { error: jeError, count: jeCount } = await adminClient
        .from('journal_entries')
        .delete({ count: 'exact' })
        .in('id', ids);

      if (jeError) {
        console.error('Error deleting journal_entries:', jeError);
        throw new Error(`Failed to delete journal entries: ${jeError.message}`);
      }
      deletedCounts.journal_entries = jeCount || 0;
    }

    // 3. Delete ledger_entries - first remove immutability
    const { data: ledgerEntryIds } = await adminClient
      .from('ledger_entries')
      .select('id')
      .gte('entry_date', dateFrom)
      .lte('entry_date', dateTo);

    if (ledgerEntryIds && ledgerEntryIds.length > 0) {
      const ids = ledgerEntryIds.map(e => e.id);
      
      // Remove immutability first
      await adminClient
        .from('ledger_entries')
        .update({ is_immutable: false })
        .in('id', ids);

      const { error: leError, count: leCount } = await adminClient
        .from('ledger_entries')
        .delete({ count: 'exact' })
        .in('id', ids);

      if (leError) {
        console.error('Error deleting ledger_entries:', leError);
        throw new Error(`Failed to delete ledger entries: ${leError.message}`);
      }
      deletedCounts.ledger_entries = leCount || 0;
    }

    // 4. Delete salary_settlements (by settlement_month)
    const fromMonth = dateFrom.substring(0, 7); // YYYY-MM
    const toMonth = dateTo.substring(0, 7);
    
    const { error: ssError, count: ssCount } = await adminClient
      .from('salary_settlements')
      .delete({ count: 'exact' })
      .gte('settlement_month', fromMonth)
      .lte('settlement_month', toMonth);

    if (ssError) {
      console.error('Error deleting salary_settlements:', ssError);
      throw new Error(`Failed to delete salary settlements: ${ssError.message}`);
    }
    deletedCounts.salary_settlements = ssCount || 0;

    // 5. Delete payment_requests (by created_at)
    const { error: prError, count: prCount } = await adminClient
      .from('payment_requests')
      .delete({ count: 'exact' })
      .gte('created_at', dateFrom)
      .lte('created_at', dateTo + 'T23:59:59');

    if (prError) {
      console.error('Error deleting payment_requests:', prError);
      throw new Error(`Failed to delete payment requests: ${prError.message}`);
    }
    deletedCounts.payment_requests = prCount || 0;

    // 6. Delete expenses (by expense_date)
    const { error: expError, count: expCount } = await adminClient
      .from('expenses')
      .delete({ count: 'exact' })
      .gte('expense_date', dateFrom)
      .lte('expense_date', dateTo);

    if (expError) {
      console.error('Error deleting expenses:', expError);
      throw new Error(`Failed to delete expenses: ${expError.message}`);
    }
    deletedCounts.expenses = expCount || 0;

    // Calculate total
    deletedCounts.total = Object.values(deletedCounts).reduce((a, b) => a + b, 0) - deletedCounts.total;

    // Log audit entry
    const auditData = {
      table_name: 'SYSTEM',
      record_id: crypto.randomUUID(),
      action: 'CLEAR_TRANSACTIONS',
      performed_by: user.id,
      old_data: null,
      new_data: {
        action: 'CLEAR_TRANSACTIONS',
        owner_id: user.id,
        owner_email: user.email,
        date_from: dateFrom,
        date_to: dateTo,
        backup_taken: true,
        backup_timestamp: backupTimestamp,
        execution_timestamp: new Date().toISOString(),
        deleted_counts: deletedCounts,
      },
    };

    const { error: auditError } = await adminClient
      .from('audit_log')
      .insert(auditData);

    if (auditError) {
      console.error('Warning: Failed to log audit entry:', auditError);
      // Don't fail the operation for audit log error
    }

    console.log(`[clear-transaction-data] Successfully cleared data. Counts:`, deletedCounts);

    return new Response(
      JSON.stringify({
        success: true,
        deletedCounts,
        message: `Successfully cleared ${deletedCounts.total} records`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[clear-transaction-data] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
