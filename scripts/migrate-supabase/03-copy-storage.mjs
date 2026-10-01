#!/usr/bin/env node
// Step 3: copy every Storage bucket and file (attendance photos, expense proofs) from SOURCE
// to TARGET using the service-role keys. Buckets missing on the target are created with the
// same visibility/limits. Existing objects on the target are overwritten (upsert), so re-running
// is safe.
//
// Usage: node scripts/migrate-supabase/03-copy-storage.mjs
//   (reads scripts/migrate-supabase/.env.migration or the environment)
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '.env.migration');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const need = (k) => {
  if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
  return process.env[k];
};
const src = createClient(need('SOURCE_SUPABASE_URL'), need('SOURCE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const dst = createClient(need('TARGET_SUPABASE_URL'), need('TARGET_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

async function listAll(client, bucket, prefix = '') {
  const out = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Folders come back with id === null
      if (item.id === null) out.push(...(await listAll(client, bucket, path)));
      else out.push({ path, contentType: item.metadata?.mimetype });
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

const { data: buckets, error: bErr } = await src.storage.listBuckets();
if (bErr) throw bErr;
const { data: targetBuckets } = await dst.storage.listBuckets();
const targetIds = new Set((targetBuckets ?? []).map((b) => b.id));

let copied = 0, failed = 0;
for (const b of buckets) {
  if (!targetIds.has(b.id)) {
    console.log(`Creating bucket ${b.id} (public=${b.public})`);
    const { error } = await dst.storage.createBucket(b.id, {
      public: b.public,
      fileSizeLimit: b.file_size_limit ?? undefined,
      allowedMimeTypes: b.allowed_mime_types ?? undefined,
    });
    if (error) throw new Error(`createBucket ${b.id}: ${error.message}`);
  }
  const files = await listAll(src, b.id);
  console.log(`Bucket ${b.id}: ${files.length} files`);
  for (const f of files) {
    const { data, error } = await src.storage.from(b.id).download(f.path);
    if (error) { console.error(`  download failed ${b.id}/${f.path}: ${error.message}`); failed++; continue; }
    const { error: upErr } = await dst.storage.from(b.id).upload(f.path, data, { upsert: true, contentType: f.contentType || data.type || undefined });
    if (upErr) { console.error(`  upload failed ${b.id}/${f.path}: ${upErr.message}`); failed++; continue; }
    copied++;
    if (copied % 50 === 0) console.log(`  ...${copied} copied`);
  }
}
console.log(`\nStorage copy finished: ${copied} files copied, ${failed} failed.`);
process.exit(failed ? 1 : 0);
