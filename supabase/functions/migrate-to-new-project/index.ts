// One-time migration tool.
//
// Runs inside the OLD (Lovable Cloud) project, where the database connection string is available
// to edge functions as SUPABASE_DB_URL even though Lovable does not show it in its UI. It copies
// the schema, every public table, auth users (including password hashes, so nobody has to reset
// their password) and all storage files into a Supabase project you own.
//
// Owner-only. The target credentials are sent per request and never stored.
// Delete this function and the Settings card once the migration is finished.
import postgres from 'npm:postgres@3.4.5';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { MIGRATIONS } from './migrations.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Sql = ReturnType<typeof postgres>;
type Target = { url: string; serviceRoleKey: string; dbUrl: string };

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const qi = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const fqName = (schema: string, table: string) => `${qi(schema)}.${qi(table)}`;
const refFromUrl = (url: string) => new URL(url).hostname.split('.')[0];

// Auth tables copied before the public tables (public tables reference auth.users).
const AUTH_TABLES = [
  { schema: 'auth', table: 'users' },
  { schema: 'auth', table: 'identities' },
];

async function columnsOf(sql: Sql, schema: string, table: string, insertableOnly: boolean) {
  const rows = await sql`
    select a.attname, a.attidentity
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and c.relname = ${table}
      and a.attnum > 0 and not a.attisdropped
      ${insertableOnly ? sql`and a.attgenerated = ''` : sql``}
    order by a.attnum`;
  return rows.map((r) => ({ name: r.attname as string, identityAlways: r.attidentity === 'a' }));
}

async function publicTables(sql: Sql): Promise<string[]> {
  const rows = await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`;
  return rows.map((r) => r.tablename as string);
}

async function countRows(sql: Sql, schema: string, table: string): Promise<number | null> {
  try {
    const [r] = await sql.unsafe(`select count(*)::bigint as n from ${fqName(schema, table)}`);
    return Number(r.n);
  } catch {
    return null; // table missing on that side
  }
}

// Parents before children, so a copy without replica mode still satisfies foreign keys.
async function tablesInDependencyOrder(sql: Sql): Promise<string[]> {
  const tables = await publicTables(sql);
  const edges = await sql`
    select cc.relname as child, pc.relname as parent
    from pg_constraint c
    join pg_class cc on cc.oid = c.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = c.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
    where c.contype = 'f' and cn.nspname = 'public' and pn.nspname = 'public' and cc.relname <> pc.relname`;
  const parents = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const e of edges) parents.get(e.child as string)?.add(e.parent as string);
  const ordered: string[] = [];
  const done = new Set<string>();
  let progressed = true;
  while (ordered.length < tables.length && progressed) {
    progressed = false;
    for (const t of tables) {
      if (done.has(t)) continue;
      if ([...parents.get(t)!].every((p) => done.has(p) || !parents.has(p))) {
        ordered.push(t);
        done.add(t);
        progressed = true;
      }
    }
  }
  for (const t of tables) if (!done.has(t)) ordered.push(t); // cycles: replica mode handles them
  return ordered;
}

// Replica mode skips triggers and foreign-key checks, so ledger/audit triggers do not fire twice
// and immutability guards do not block the bulk insert. SET LOCAL inside a savepoint keeps this
// working through a transaction pooler and lets the copy continue if the role is not allowed.
type Tx = postgres.TransactionSql;
async function trySetReplica(tx: Tx): Promise<boolean> {
  try {
    await tx.savepoint((sp) => sp.unsafe('set local session_replication_role = replica'));
    return true;
  } catch {
    return false;
  }
}

// Reads the source inside a read-only transaction: a consistent snapshot per table, and the
// cursor stays on one connection even behind a transaction pooler.
async function streamRows(src: Sql, query: string, batch: number, onRows: (json: string) => Promise<void>) {
  await src.begin(async (stx) => {
    await stx.unsafe('set transaction read only');
    await stx.unsafe(query).cursor(batch, async (rows) => {
      await onRows('[' + rows.map((r) => r.j as string).join(',') + ']');
    });
  });
}

async function assertSourceTable(src: Sql, schema: string, table: string) {
  const isAuth = AUTH_TABLES.some((t) => t.schema === schema && t.table === table);
  if (isAuth) return;
  if (schema !== 'public' || !(await publicTables(src)).includes(table)) {
    throw new Error(`Unknown table ${schema}.${table}`);
  }
}

async function copyTable(src: Sql, tgt: Sql, schema: string, table: string) {
  await assertSourceTable(src, schema, table);
  const srcCols = (await columnsOf(src, schema, table, false)).map((c) => c.name);
  const tgtColInfo = await columnsOf(tgt, schema, table, true);
  if (!tgtColInfo.length) {
    throw new Error(`${schema}.${table} does not exist on the new project. The schema step has not finished; run the migration again.`);
  }
  const tgtCols = tgtColInfo.map((c) => c.name);
  const cols = tgtCols.filter((c) => srcCols.includes(c));
  const skippedColumns = srcCols.filter((c) => !tgtCols.includes(c));
  const overriding = tgtColInfo.some((c) => c.identityAlways && cols.includes(c.name)) ? 'overriding system value' : '';
  const fq = fqName(schema, table);
  const colList = cols.map(qi).join(', ');

  let copied = 0;
  let replica = false;
  await tgt.begin(async (tx) => {
    replica = await trySetReplica(tx);
    if (!replica && schema === 'public') await tx.unsafe(`alter table ${fq} disable trigger user`);
    await tx.unsafe(`delete from ${fq}`); // makes re-running a step safe
    await streamRows(src, `select to_json(t)::text as j from (select ${colList} from ${fq}) t`, 500, async (payload) => {
      const res = await tx.unsafe(
        `insert into ${fq} (${colList}) ${overriding} select ${colList} from json_populate_recordset(null::${fq}, $1::json)`,
        [payload],
      );
      copied += res.count;
    });
    if (!replica && schema === 'public') await tx.unsafe(`alter table ${fq} enable trigger user`);
  });
  return { table: `${schema}.${table}`, copied, skippedColumns, replica };
}

async function applySchema(tgt: Sql) {
  await tgt.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text not null primary key, statements text[], name text
    );`).simple();
  const applied = new Set(
    (await tgt`select version from supabase_migrations.schema_migrations`).map((r) => r.version as string),
  );
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    try {
      await tgt.begin(async (tx) => {
        await tx.unsafe(m.sql).simple();
        await tx`insert into supabase_migrations.schema_migrations (version, name)
                 values (${m.version}, ${m.name})`;
      });
      ran.push(m.version);
    } catch (e) {
      throw new Error(`Migration ${m.version}_${m.name} failed: ${(e as Error).message}`);
    }
  }
  return { applied: ran, alreadyApplied: applied.size, total: MIGRATIONS.length };
}

async function pendingMigrations(tgt: Sql) {
  try {
    const rows = await tgt`select version from supabase_migrations.schema_migrations`;
    const applied = new Set(rows.map((r) => r.version as string));
    return MIGRATIONS.filter((m) => !applied.has(m.version)).length;
  } catch {
    return MIGRATIONS.length;
  }
}

async function bucketFileCounts(sql: Sql) {
  const rows = await sql`
    select b.id, count(o.id)::bigint as files
    from storage.buckets b left join storage.objects o on o.bucket_id = b.id
    group by b.id order by b.id`;
  return Object.fromEntries(rows.map((r) => [r.id as string, Number(r.files)]));
}

async function ensureBucket(srcAdmin: SupabaseClient, tgtAdmin: SupabaseClient, bucket: string) {
  const { data: existing } = await tgtAdmin.storage.getBucket(bucket);
  if (existing) return;
  const { data: srcBucket, error } = await srcAdmin.storage.getBucket(bucket);
  if (error || !srcBucket) throw new Error(`Bucket ${bucket} not found on the old project`);
  const { error: createErr } = await tgtAdmin.storage.createBucket(bucket, {
    public: srcBucket.public,
    fileSizeLimit: srcBucket.file_size_limit ?? undefined,
    allowedMimeTypes: srcBucket.allowed_mime_types ?? undefined,
  });
  if (createErr) throw new Error(`Could not create bucket ${bucket}: ${createErr.message}`);
}

async function copyFiles(srcAdmin: SupabaseClient, tgtAdmin: SupabaseClient, bucket: string, names: string[]) {
  const failed: { name: string; error: string }[] = [];
  let copied = 0;
  const queue = [...names];
  const worker = async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const { data, error } = await srcAdmin.storage.from(bucket).download(name);
      if (error || !data) {
        failed.push({ name, error: error?.message ?? 'download failed' });
        continue;
      }
      const { error: upErr } = await tgtAdmin.storage
        .from(bucket)
        .upload(name, data, { upsert: true, contentType: data.type || undefined });
      if (upErr) failed.push({ name, error: upErr.message });
      else copied++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { bucket, copied, failed };
}

// Files uploaded with the service-role key have no owner. Several storage policies check
// owner = auth.uid(), so copy the original owner columns across.
async function syncStorageOwners(src: Sql, tgt: Sql) {
  const srcCols = (await columnsOf(src, 'storage', 'objects', false)).map((c) => c.name);
  const tgtCols = (await columnsOf(tgt, 'storage', 'objects', true)).map((c) => c.name);
  const ownerCols = ['owner', 'owner_id'].filter((c) => srcCols.includes(c) && tgtCols.includes(c));
  if (!ownerCols.length) return 0;
  const select = ['bucket_id', 'name', ...ownerCols].map(qi).join(', ');
  const set = ownerCols.map((c) => `${qi(c)} = s.${qi(c)}`).join(', ');
  let updated = 0;
  await tgt.begin(async (tx) => {
    await trySetReplica(tx);
    await streamRows(src, `select to_json(t)::text as j from (select ${select} from storage.objects) t`, 1000, async (payload) => {
      const res = await tx.unsafe(
        `update storage.objects o set ${set}
         from json_populate_recordset(null::storage.objects, $1::json) s
         where o.bucket_id = s.bucket_id and o.name = s.name`,
        [payload],
      );
      updated += res.count;
    });
  });
  return updated;
}

async function resetSequences(tgt: Sql) {
  const seqs = await tgt`
    select n.nspname as schema, t.relname as tbl, a.attname as col,
           pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(t.relname), a.attname) as seq
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid
    where n.nspname = 'public' and t.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      and pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(t.relname), a.attname) is not null`;
  for (const s of seqs) {
    await tgt.unsafe(
      `select setval($1, coalesce((select max(${qi(s.col)}) from ${fqName(s.schema, s.tbl)}), 0) + 1, false)`,
      [s.seq],
    );
  }
  return seqs.length;
}

async function verify(src: Sql, tgt: Sql) {
  const rows: { table: string; source: number | null; target: number | null }[] = [];
  for (const t of [...AUTH_TABLES, ...(await publicTables(src)).map((table) => ({ schema: 'public', table }))]) {
    rows.push({
      table: `${t.schema}.${t.table}`,
      source: await countRows(src, t.schema, t.table),
      target: await countRows(tgt, t.schema, t.table),
    });
  }
  const srcFiles = await bucketFileCounts(src);
  const tgtFiles = await bucketFileCounts(tgt);
  for (const b of Object.keys(srcFiles)) {
    rows.push({ table: `storage: ${b}`, source: srcFiles[b], target: tgtFiles[b] ?? 0 });
  }
  return rows.map((r) => ({ ...r, match: r.source === r.target }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const sourceDbUrl = Deno.env.get('SUPABASE_DB_URL');

  // --- Owner-only ---
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return respond({ ok: false, error: 'Unauthorized' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return respond({ ok: false, error: 'Invalid session' }, 401);
  const srcAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: ownerRole } = await srcAdmin
    .from('user_roles').select('role').eq('user_id', user.id).eq('role', 'owner').maybeSingle();
  if (!ownerRole) return respond({ ok: false, error: 'Only the owner can run the migration' }, 403);

  if (!sourceDbUrl) {
    return respond({ ok: false, error: 'SUPABASE_DB_URL is not available to edge functions on this project.' });
  }

  let body: { action?: string; target?: Target; schema?: string; table?: string; bucket?: string; names?: string[] };
  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const { action, target } = body;

  // --- Validate the target so the old project can never be overwritten ---
  if (!target?.url || !target?.serviceRoleKey || !target?.dbUrl) {
    return respond({ ok: false, error: 'New project URL, service role key and database URL are required' }, 400);
  }
  let targetRef: string;
  try {
    targetRef = refFromUrl(target.url);
  } catch {
    return respond({ ok: false, error: 'New project URL is not a valid URL' }, 400);
  }
  const sourceRef = refFromUrl(supabaseUrl);
  if (targetRef === sourceRef || target.dbUrl.includes(sourceRef)) {
    return respond({ ok: false, error: 'The new project must be different from this (old) project' }, 400);
  }
  if (!target.dbUrl.includes(targetRef)) {
    return respond({ ok: false, error: `The database URL does not belong to project ${targetRef}` }, 400);
  }

  const src = postgres(sourceDbUrl, { prepare: false, max: 1, idle_timeout: 5 });
  const tgt = postgres(target.dbUrl, { prepare: false, max: 1, idle_timeout: 5, ssl: 'require', connect_timeout: 15 });
  const tgtAdmin = createClient(target.url, target.serviceRoleKey, { auth: { persistSession: false } });

  try {
    switch (action) {
      case 'check': {
        await tgt`select 1`;
        const { error: keyErr } = await tgtAdmin.storage.listBuckets();
        if (keyErr) throw new Error(`New project service role key rejected: ${keyErr.message}`);
        const tables = await tablesInDependencyOrder(src);
        const counts = [];
        for (const t of [...AUTH_TABLES, ...tables.map((table) => ({ schema: 'public', table }))]) {
          counts.push({ schema: t.schema, table: t.table, rows: await countRows(src, t.schema, t.table) });
        }
        return respond({
          ok: true,
          sourceRef,
          targetRef,
          tables: counts,
          buckets: await bucketFileCounts(src),
          pendingMigrations: await pendingMigrations(tgt),
          totalMigrations: MIGRATIONS.length,
        });
      }
      case 'apply-schema':
        return respond({ ok: true, ...(await applySchema(tgt)) });
      case 'copy-table':
        if (!body.schema || !body.table) return respond({ ok: false, error: 'schema and table are required' }, 400);
        return respond({ ok: true, ...(await copyTable(src, tgt, body.schema, body.table)) });
      case 'list-files': {
        if (!body.bucket) return respond({ ok: false, error: 'bucket is required' }, 400);
        await ensureBucket(srcAdmin, tgtAdmin, body.bucket);
        const rows = await src`select name from storage.objects where bucket_id = ${body.bucket} order by name`;
        return respond({ ok: true, names: rows.map((r) => r.name as string) });
      }
      case 'copy-files':
        if (!body.bucket || !Array.isArray(body.names)) return respond({ ok: false, error: 'bucket and names are required' }, 400);
        if (body.names.length > 50) return respond({ ok: false, error: 'At most 50 files per call' }, 400);
        return respond({ ok: true, ...(await copyFiles(srcAdmin, tgtAdmin, body.bucket, body.names)) });
      case 'finalize': {
        const sequences = await resetSequences(tgt);
        let storageOwners: number | string;
        try {
          storageOwners = await syncStorageOwners(src, tgt);
        } catch (e) {
          storageOwners = `failed: ${(e as Error).message}`;
        }
        return respond({ ok: true, sequences, storageOwners, verification: await verify(src, tgt) });
      }
      case 'verify':
        return respond({ ok: true, verification: await verify(src, tgt) });
      default:
        return respond({ ok: false, error: `Unknown action ${action}` }, 400);
    }
  } catch (e) {
    console.error(`[migrate-to-new-project] ${action} failed:`, e);
    return respond({ ok: false, error: (e as Error).message });
  } finally {
    await Promise.allSettled([src.end({ timeout: 5 }), tgt.end({ timeout: 5 })]);
  }
});
