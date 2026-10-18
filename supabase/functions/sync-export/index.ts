// TEMPORARY read-only export, used once to copy the data written to the old Lovable Cloud
// project (after 12 Oct) into the self-owned project. Delete right after the move.
//
// Access needs a one-time key; only its SHA-256 is committed. It can only read: list the
// tables, or return one page of rows from one public table (or auth.users / auth.identities).
import postgres from 'npm:postgres@3.4.5';

const KEY_SHA256 = 'f2c4d0262df26df280e87ceca3035b480d92a2de3543f006a3b5b37d1bc4cb60';
const AUTH_TABLES = new Set(['users', 'identities']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const qi = (s: string) => '"' + s.replace(/"/g, '""') + '"';

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const key = req.headers.get('x-sync-key') ?? '';
  if (!key || (await sha256Hex(key)) !== KEY_SHA256) return respond({ error: 'forbidden' }, 403);

  const dbUrl = Deno.env.get('SUPABASE_DB_URL');
  if (!dbUrl) return respond({ error: 'SUPABASE_DB_URL not available' }, 500);
  const project = (Deno.env.get('SUPABASE_URL') ?? '').replace('https://', '').split('.')[0];
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === 'tables') {
      const rows = await sql`
        select n.nspname as schema, c.relname as table
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r'
          and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
        order by 1, 2`;
      const out = [];
      for (const r of rows) {
        const [{ n }] = await sql.unsafe(`select count(*)::bigint as n from ${qi(r.schema)}.${qi(r.table)}`);
        out.push({ schema: r.schema, table: r.table, rows: Number(n) });
      }
      return respond({ project, tables: out });
    }

    if (body.action === 'rows') {
      const schema = String(body.schema ?? 'public');
      const table = String(body.table ?? '');
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) return respond({ error: 'bad table' }, 400);
      if (schema !== 'public' && !(schema === 'auth' && AUTH_TABLES.has(table))) {
        return respond({ error: 'bad schema' }, 400);
      }
      const [{ exists }] = await sql`
        select exists (select 1 from pg_tables where schemaname = ${schema} and tablename = ${table}) as exists`;
      if (!exists) return respond({ error: 'no such table' }, 404);

      const limit = Math.min(Math.max(Number(body.limit) || 1000, 1), 2000);
      const offset = Math.max(Number(body.offset) || 0, 0);
      const pk = await sql`
        select a.attname from pg_index i
        join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
        where n.nspname = ${schema} and c.relname = ${table} and i.indisprimary
        order by array_position(i.indkey, a.attnum)`;
      const orderBy = pk.length ? pk.map((r) => 't.' + qi(r.attname as string)).join(', ') : 't.ctid';
      const rows = await sql.unsafe(
        `select to_jsonb(t) as r from ${qi(schema)}.${qi(table)} t order by ${orderBy} limit ${limit} offset ${offset}`,
      );
      return respond({ project, rows: rows.map((x) => x.r), next: rows.length === limit ? offset + limit : null });
    }

    return respond({ project, ok: true });
  } catch (e) {
    return respond({ error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
