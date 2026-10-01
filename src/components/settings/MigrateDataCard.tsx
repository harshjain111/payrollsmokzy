import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CheckCircle2, DatabaseZap, Loader2, MinusCircle, XCircle } from 'lucide-react';

/**
 * One-time tool to move everything from the Lovable Cloud project into a Supabase project the
 * owner controls. Talks to the migrate-to-new-project edge function, which runs in the OLD
 * project and therefore has direct database access. Remove after the migration is complete.
 */

type TableInfo = { schema: string; table: string; rows: number | null };
type CheckResult = {
  sourceRef: string;
  targetRef: string;
  tables: TableInfo[];
  buckets: Record<string, number>;
  pendingMigrations: number;
  totalMigrations: number;
};
type VerifyRow = { table: string; source: number | null; target: number | null; match: boolean };

const FILE_BATCH = 10;

export function MigrateDataCard() {
  const { isOwner } = useAuth();
  const [targetUrl, setTargetUrl] = useState('');
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [dbUrl, setDbUrl] = useState('');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [verification, setVerification] = useState<VerifyRow[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // What to copy: 'db' = all tables and logins, plus one entry per storage bucket.
  const [include, setInclude] = useState<Record<string, boolean>>({});

  if (!isOwner) return null;

  const addLog = (line: string) => setLog((l) => [...l, line]);

  const callOnce = async <T,>(body: Record<string, unknown>): Promise<T> => {
    const { data, error } = await supabase.functions.invoke('migrate-to-new-project', {
      body: { ...body, target: { url: targetUrl.trim(), serviceRoleKey: serviceRoleKey.trim(), dbUrl: dbUrl.trim() } },
    });
    if (error) {
      // Surface the function's own error message when it sent one.
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const payload = await ctx.json().catch(() => null);
        if (payload?.error) throw new Error(payload.error);
      }
      throw new Error(error.message);
    }
    if (!data?.ok) throw new Error(data?.error ?? 'Unknown error');
    return data as T;
  };

  // Every action is safe to repeat, so transient failures (timeouts, dropped connections) are retried.
  const call = async <T,>(body: Record<string, unknown>, attempts = 3): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await callOnce<T>(body);
      } catch (e) {
        const msg = (e as Error).message;
        const transient = /failed to send a request|fetch|network|timed? ?out|worker|546|504|502/i.test(msg);
        if (!transient || attempt >= attempts) throw e;
        addLog(`  retrying after: ${msg}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  };

  const runCheck = async () => {
    setBusy(true);
    setLog([]);
    setVerification(null);
    try {
      const res = await call<CheckResult>({ action: 'check' });
      setCheck(res);
      setInclude({ db: true, ...Object.fromEntries(Object.keys(res.buckets).map((b) => [b, true])) });
      const rows = res.tables.reduce((n, t) => n + (t.rows ?? 0), 0);
      const files = Object.values(res.buckets).reduce((n, c) => n + c, 0);
      addLog(`Connected. Old project ${res.sourceRef} → new project ${res.targetRef}.`);
      addLog(`${res.tables.length} tables, ${rows} rows, ${files} files to copy.`);
      addLog(`${res.pendingMigrations} of ${res.totalMigrations} schema migrations still to apply on the new project.`);
    } catch (e) {
      setCheck(null);
      addLog(`Check failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const isSkipped = (row: string) =>
    row.startsWith('storage: ') ? !include[row.slice('storage: '.length)] : !include.db;

  const runMigration = async () => {
    if (!check) return;
    setConfirmOpen(false);
    setBusy(true);
    setVerification(null);
    setProgress(0);
    const tables = include.db ? check.tables : [];
    const bucketIds = Object.keys(check.buckets).filter((b) => check.buckets[b] > 0 && include[b]);
    const totalSteps = 1 + tables.length + bucketIds.length + 1;
    let step = 0;
    const advance = () => setProgress(Math.round((++step / totalSteps) * 100));

    try {
      addLog('Creating tables, policies and functions on the new project…');
      const schema = await call<{ applied: string[] }>({ action: 'apply-schema' });
      addLog(`Schema ready (${schema.applied.length} migrations applied now).`);
      advance();

      if (!include.db) addLog('Skipping tables and logins (unticked).');
      for (const t of tables) {
        addLog(`Copying ${t.schema}.${t.table} (${t.rows ?? '?'} rows)…`);
        let offset = 0;
        let copied = 0;
        let skipped: string[] = [];
        for (;;) {
          const res = await call<{ copied: number; skippedColumns: string[]; done: boolean; nextOffset: number }>({
            action: 'copy-table',
            schema: t.schema,
            table: t.table,
            offset,
          });
          copied += res.copied;
          skipped = res.skippedColumns;
          if (res.done) break;
          offset = res.nextOffset;
        }
        addLog(
          `  ${copied} rows copied` +
            (skipped.length ? ` (columns not on new project, skipped: ${skipped.join(', ')})` : ''),
        );
        advance();
      }

      Object.keys(check.buckets)
        .filter((b) => !include[b])
        .forEach((b) => addLog(`Skipping files in ${b} (unticked).`));
      for (const bucket of bucketIds) {
        addLog(`Copying files in ${bucket} (${check.buckets[bucket]})…`);
        const { names } = await call<{ names: string[] }>({ action: 'list-files', bucket });
        let copied = 0;
        const failed: string[] = [];
        for (let i = 0; i < names.length; i += FILE_BATCH) {
          const res = await call<{ copied: number; failed: { name: string; error: string }[] }>({
            action: 'copy-files',
            bucket,
            names: names.slice(i, i + FILE_BATCH),
          });
          copied += res.copied;
          failed.push(...res.failed.map((f) => `${f.name}: ${f.error}`));
          setProgress(Math.round(((step + (i + FILE_BATCH) / names.length) / totalSteps) * 100));
        }
        addLog(`Files in ${bucket}: ${copied} of ${names.length} copied.`);
        failed.slice(0, 10).forEach((f) => addLog(`  failed ${f}`));
        advance();
      }

      addLog('Finalising (file owners, sequences) and verifying counts…');
      const fin = await call<{ storageOwners: number | string; verification: VerifyRow[] }>({ action: 'finalize' });
      addLog(`File owners restored: ${fin.storageOwners}.`);
      setVerification(fin.verification);
      advance();
      const mismatches = fin.verification.filter((v) => !v.match && !isSkipped(v.table)).length;
      addLog(mismatches ? `Done with ${mismatches} mismatches. Re-run to retry.` : 'Done. Every count matches.');
    } catch (e) {
      addLog(`Stopped: ${(e as Error).message}. Fix the problem and run again; finished steps are safe to repeat.`);
    } finally {
      setBusy(false);
    }
  };

  const ready = targetUrl.trim() && serviceRoleKey.trim() && dbUrl.trim();

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseZap className="h-5 w-5" />
          Move data to your own Supabase project
        </CardTitle>
        <CardDescription>
          One-time copy of every table, login (passwords keep working) and uploaded file into a new Supabase
          project. The current data is only read, never changed. Keys are used for this session only and not saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="mig-url">New project URL</Label>
            <Input
              id="mig-url"
              placeholder="https://xxxx.supabase.co"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mig-key">New project service role key</Label>
            <Input
              id="mig-key"
              type="password"
              autoComplete="off"
              value={serviceRoleKey}
              onChange={(e) => setServiceRoleKey(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mig-db">New project database connection string (Session pooler)</Label>
            <Input
              id="mig-db"
              type="password"
              autoComplete="off"
              placeholder="postgresql://postgres.xxxx:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
              value={dbUrl}
              onChange={(e) => setDbUrl(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Supabase dashboard → Connect → Session pooler. Write special characters in the password
              URL-encoded, for example $ as %24.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={runCheck} disabled={!ready || busy}>
            {busy && !check ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            1. Check connection
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={!check || busy}>
            {busy && check ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            2. Start migration
          </Button>
        </div>

        {check && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">What to copy</p>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={!!include.db}
                onCheckedChange={(v) => setInclude((i) => ({ ...i, db: v === true }))}
                disabled={busy}
              />
              All tables and logins ({check.tables.reduce((n, t) => n + (t.rows ?? 0), 0)} rows)
            </label>
            {Object.entries(check.buckets).map(([bucket, files]) => (
              <label key={bucket} className="flex items-center gap-2">
                <Checkbox
                  checked={!!include[bucket]}
                  onCheckedChange={(v) => setInclude((i) => ({ ...i, [bucket]: v === true }))}
                  disabled={busy}
                />
                Files in {bucket} ({files})
              </label>
            ))}
          </div>
        )}

        {busy && check ? <Progress value={progress} /> : null}

        {log.length > 0 && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
            {log.join('\n')}
          </pre>
        )}

        {verification && (
          <div className="space-y-1 text-sm">
            {verification.map((v) => (
              <div key={v.table} className="flex items-center justify-between gap-2 border-b py-1 last:border-0">
                <span className="flex min-w-0 items-center gap-2">
                  {isSkipped(v.table) ? (
                    <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : v.match ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <span className="truncate">{v.table}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {isSkipped(v.table) ? 'skipped' : `${v.source ?? '–'} → ${v.target ?? '–'}`}
                </span>
              </div>
            ))}
          </div>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Copy everything to {check?.targetRef}?</AlertDialogTitle>
              <AlertDialogDescription>
                For each ticked item, what is in the NEW project is replaced with a copy of this app&apos;s data.
                Nothing in the current app is changed. Avoid entering new data while this runs.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={runMigration}>Start migration</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
