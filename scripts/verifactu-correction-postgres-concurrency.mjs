// Real PostgreSQL integration gate. Never point this at an application database.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

if (process.env.VERIFACTU_DISPOSABLE_POSTGRES !== '1') throw new Error('Explicit disposable PostgreSQL opt-in required');
if (process.env.DATABASE_URL || process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGPASSWORD) throw new Error('URLs, services and credentials are not accepted');
if (process.env.PGHOST && !['localhost', '127.0.0.1', '::1'].includes(process.env.PGHOST)) throw new Error('Only loopback PostgreSQL is allowed');
if (process.env.PGUSER && process.env.PGUSER !== 'postgres') throw new Error('Only the disposable postgres role is allowed');
if (process.env.PGPORT && process.env.PGPORT !== '5432') throw new Error('Only disposable port 5432 is allowed');
const cwd = fileURLToPath(new URL('..', import.meta.url));
const db = `vf_concurrency_${Date.now()}_${process.pid}`;
// Discard inherited libpq settings, including options and password file paths.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
Object.assign(env, { PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: db, PGCONNECT_TIMEOUT: '5', PGPASSFILE: '/dev/null', PGAPPNAME: 'vf-concurrency' });
function sql(query, { database = db, application = 'vf-concurrency' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], { cwd, env: { ...env, PGDATABASE: database, PGAPPNAME: application }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout.trim()) : reject(new Error(`psql exited ${code}: ${stderr.trim()}`)); });
    child.stdin.on('error', () => {});
    child.stdin.end(`SET statement_timeout='45s'; SET lock_timeout='20s';\n${query}`);
  });
}
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const series = '00000000-0000-4000-8000-000000000021';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = `SET test.uid='${owner}'; SET test.owner='${owner}'; SET ROLE authenticated;`;
const issue = n => `SELECT i.invoice_number FROM public.issue_sales_invoice('${id(n)}') AS i;`;
async function draft(n, seriesId = series) {
  await sql(`${context}
    INSERT INTO sales_invoices(id,owner_id,client_id,series_id,issue_date) VALUES('${id(n)}','${owner}','00000000-0000-4000-8000-000000000011','${seriesId}','2026-10-24');
    INSERT INTO sales_invoice_lines(id,owner_id,invoice_id,description,quantity,unit_price,tax_rate) VALUES('${id(n + 1000)}','${owner}','${id(n)}','Synthetic concurrency line',1,100,21);`);
}
async function check(predicate, label) {
  assert.equal(await sql(`SELECT (${predicate})::text;`), 'true', label);
}
async function denied(query, pattern) {
  await assert.rejects(sql(query), pattern);
}
async function chainCheck(expected) {
  await check(`(SELECT count(*)=${expected} AND min(sequence)=1 AND max(sequence)=${expected} AND count(DISTINCT sequence)=${expected} FROM private.verifactu_records)`, 'single consecutive record sequence');
  await check(`NOT EXISTS(SELECT 1 FROM (SELECT *,lag(hash,1,'') OVER(ORDER BY sequence) preceding FROM private.verifactu_records) r WHERE previous_hash<>preceding OR hash<>upper(encode(sha256(convert_to(hash_input,'UTF8')),'hex')) OR hash_fields->>'Huella'<>previous_hash)`, 'chain links and independent PostgreSQL SHA-256');
  await check(`(SELECT count(*)=1 AND bool_and(last_sequence=${expected}) FROM private.verifactu_chains) AND NOT EXISTS(SELECT previous_hash FROM private.verifactu_records GROUP BY previous_hash HAVING count(*)>1) AND (SELECT last_hash FROM private.verifactu_chains)=(SELECT hash FROM private.verifactu_records ORDER BY sequence DESC LIMIT 1)`, 'single chain, no fork, matching head');
}
async function waitForSleep(application) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${application}' AND wait_event='PgSleep');`) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Did not observe deterministic transaction barrier: ${application}`);
}
async function waitForRollbackLock(application) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${application}' AND wait_event_type='Lock');`, { database: 'postgres' }) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Rollback did not wait for writer before its history gate: ${application}`);
}
async function rollbackWriterRace(kind, action, migration) {
  const raceDb = `${db}_rollback_${kind}_${action}`;
  const writerApp = `vf-rollback-writer-${kind}-${action}`;
  const rollbackApp = `vf-rollback-waiter-${kind}-${action}`;
  let raceCreated = false, writer, rolling;
  try {
    await sql(`CREATE DATABASE ${raceDb};`, { database: 'postgres' }); raceCreated = true;
    await sql(readFileSync(new URL('../tests/fixtures/verifactu-before.sql', import.meta.url), 'utf8'), { database: raceDb });
    await sql(readFileSync(new URL('../supabase/migrations/20261024075749_verifactu_shadow_phase1.sql', import.meta.url), 'utf8'), { database: raceDb });
    if (kind === 'correction') await sql(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'), { database: raceDb });
    let write;
    if (action === 'issue') {
      await sql(`${context}INSERT INTO sales_invoices(id,owner_id,client_id,series_id,issue_date) VALUES('${id(1)}','${owner}','00000000-0000-4000-8000-000000000011','${series}','2026-10-24');INSERT INTO sales_invoice_lines(owner_id,invoice_id,description,quantity,unit_price,tax_rate) VALUES('${owner}','${id(1)}','Synthetic first issue rollback race',1,100,21);`, { database: raceDb });
      write = `${context}BEGIN;${issue(1)}SELECT pg_sleep(2);COMMIT;`;
    } else {
      write = `SET test.uid='${owner}';SET test.owner='${owner}';BEGIN;INSERT INTO private.verifactu_settings(owner_id,mode,issuer_nif) VALUES('${owner}','shadow','89890001K');SELECT pg_sleep(2);COMMIT;`;
    }
    writer = sql(write, { database: raceDb, application: writerApp });
    await waitForSleep(writerApp);
    const rollbackPath = kind === 'base' ? '../docs/deploy/20261024-verifactu-phase1/rollback.sql' : '../docs/deploy/20261024-verifactu-correction/rollback.sql';
    // Attach rejection handling immediately: refusal is the required result.
    rolling = sql(readFileSync(new URL(rollbackPath, import.meta.url), 'utf8'), { database: raceDb, application: rollbackApp }).then(() => ({ ok: true }), error => ({ ok: false, error }));
    await waitForRollbackLock(rollbackApp);
    await writer;
    const result = await rolling;
    assert.equal(result.ok, false, `${kind} rollback must refuse committed ${action} history`);
    assert.match(String(result.error), /VF_ROLLBACK_PRESERVE_HISTORY/);
    assert.equal(await sql('SELECT count(*)>0 FROM private.verifactu_events;', { database: raceDb }), 't', 'writer audit rows survive rollback refusal');
    if (action === 'issue') {
      assert.equal(await sql(`SELECT status='issued' AND invoice_number='F-2026-0001' FROM sales_invoices WHERE id='${id(1)}';`, { database: raceDb }), 't', 'first issued invoice and number survive');
    } else {
      assert.equal(await sql(`SELECT mode='shadow' FROM private.verifactu_settings WHERE owner_id='${owner}';`, { database: raceDb }), 't', 'activation survives');
      assert.equal(await sql("SELECT count(*)=1 FROM private.verifactu_events WHERE event_kind='mode_shadow';", { database: raceDb }), 't', 'activation event survives');
    }
    console.log(`PASS: ${kind} rollback waits for concurrent first ${action}, then refuses and preserves history`);
  } finally {
    await Promise.allSettled([writer, rolling].filter(Boolean));
    if (raceCreated) await sql(`DROP DATABASE ${raceDb} WITH (FORCE);`, { database: 'postgres' });
  }
}
let created = false;
try {
  assert.ok(Number(await sql('SHOW server_version_num;', { database: 'postgres' })) >= 170000, 'PostgreSQL 17 or newer required');
  await sql(`CREATE DATABASE ${db};`, { database: 'postgres' }); created = true;
  await sql(readFileSync(new URL('../tests/fixtures/verifactu-before.sql', import.meta.url), 'utf8'));
  await sql(readFileSync(new URL('../supabase/migrations/20261024075749_verifactu_shadow_phase1.sql', import.meta.url), 'utf8'));
  const migration = readdirSync(new URL('../supabase/migrations/', import.meta.url)).find(name => name.endsWith('_verifactu_correction_circuit.sql'));
  assert.ok(migration, 'correction migration exists');
  await sql(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  await sql(`SET test.uid='${owner}'; SET test.owner='${owner}'; INSERT INTO private.verifactu_settings(owner_id,mode,issuer_nif) VALUES('${owner}','shadow','89890001K');`);
  const correction = n => `SELECT public.create_sales_invoice_correction('${id(n)}','R1','I','Synthetic explicit price difference');`;
  const cancel = document => `SELECT public.verifactu_cancel_sales_document('${document}','invoice','Synthetic duplicate emission');`;
  await draft(1); await sql(`${context}${issue(1)}`);
  const child = await sql(`${context}${correction(1)}`);
  // Cancellation wins: the already-open draft cannot emit after parent commit.
  const cancelling = sql(`${context}BEGIN;${cancel(id(1))}SELECT pg_sleep(2);COMMIT;`, { application: 'vf-parent-cancel-first' });
  await waitForSleep('vf-parent-cancel-first');
  await Promise.all([cancelling, denied(`${context}SELECT public.issue_sales_invoice('${child}');`, /VF_RECTIFIED_DOCUMENT_INVALID/), denied(`${context}${correction(1)}`, /VF_RECTIFIED_DOCUMENT_INVALID/)]);
  await check(`(SELECT status='draft' AND invoice_number IS NULL FROM sales_invoices WHERE id='${child}')`, 'waiting issuer leaves correction draft and number untouched');
  console.log('PASS: cancellation-first blocks both waiting draft emission and new correction creation');
  await draft(2); await sql(`${context}${issue(2)}`);
  const child2 = await sql(`${context}${correction(2)}`);
  const originalBefore = await sql(`SELECT to_jsonb(i)::text FROM sales_invoices i WHERE id='${id(2)}';`);
  // Emission wins: waiting parent cancellation must see the committed child.
  const emitting = sql(`${context}BEGIN;SELECT public.issue_sales_invoice('${child2}');SELECT pg_sleep(2);COMMIT;`, { application: 'vf-child-issue-first' });
  await waitForSleep('vf-child-issue-first');
  await Promise.all([emitting, denied(`${context}${cancel(id(2))}`, /VF_ACTIVE_CORRECTIONS/)]);
  assert.equal(await sql(`SELECT to_jsonb(i)::text FROM sales_invoices i WHERE id='${id(2)}';`), originalBefore);
  console.log('PASS: correction-first blocks parent cancellation and preserves source document byte-for-byte');
  // Parent and child cancellations share lock order: no parent/child deadlock.
  const childCancellation = sql(`${context}BEGIN;${cancel(child2)}SELECT pg_sleep(2);COMMIT;`, { application: 'vf-child-cancel-first' });
  await waitForSleep('vf-child-cancel-first');
  await Promise.all([childCancellation, sql(`${context}${cancel(id(2))}`)]);
  await check(`(SELECT count(*)=2 FROM private.verifactu_cancellations WHERE document_id IN('${child2}','${id(2)}'))`, 'child cancellation releases parent cancellation');
  console.log('PASS: concurrent child and parent cancellations finish without lock inversion');
  await draft(3); await sql(`${context}${issue(3)}`);
  const siblingS = await sql(`${context}SELECT public.create_sales_invoice_correction('${id(3)}','R1','S','Synthetic sibling replacement');`);
  const siblingI = await sql(`${context}${correction(3)}`);
  const siblingResults = await Promise.allSettled([siblingS,siblingI].map(child => sql(`${context}SELECT public.issue_sales_invoice('${child}');`)));
  assert.equal(siblingResults.filter(result => result.status === 'fulfilled').length, 1);
  const blockedSibling = siblingResults.find(result => result.status === 'rejected');
  assert.match(String(blockedSibling?.reason), /VF_CORRECTION_TARGET_SUPERSEDED/);
  console.log('PASS: racing S/I sibling emissions serialize and only one can emit');
  await draft(4); await sql(`${context}${issue(4)}`);
  const savedChild = await sql(`${context}${correction(4)}`);
  const save = child => `SELECT public.save_sales_invoice_correction('${child}','{"rectification_reason":"Synthetic atomic saved difference"}'::jsonb,'[{"description":"Synthetic atomic saved line","quantity":2,"unit_price":-15,"discount_percent":0,"tax_rate":21}]'::jsonb);`;
  const saving = sql(`${context}BEGIN;${save(savedChild)}SELECT pg_sleep(2);COMMIT;`, { application: 'vf-correction-save-first' });
  await waitForSleep('vf-correction-save-first');
  await Promise.all([saving, sql(`${context}SELECT public.issue_sales_invoice('${savedChild}');`)]);
  await check(`(SELECT snapshot->'invoice'->>'rectification_reason'='Synthetic atomic saved difference' AND (snapshot->'invoice'->>'total_amount')::numeric=-36.3 AND (snapshot->'lines'->0->>'unit_price')::numeric=-15 FROM private.verifactu_records WHERE invoice_id='${savedChild}')`, 'save-first captures new header and complete new lines together');
  const issuedChild = await sql(`${context}${correction(4)}`);
  const issuingBeforeSave = sql(`${context}BEGIN;SELECT public.issue_sales_invoice('${issuedChild}');SELECT pg_sleep(2);COMMIT;`, { application: 'vf-correction-issue-before-save' });
  await waitForSleep('vf-correction-issue-before-save');
  await Promise.all([issuingBeforeSave, denied(`${context}${save(issuedChild)}`, /VF_CORRECTION_DRAFT_REQUIRED/)]);
  await check(`(SELECT snapshot->'invoice'->>'rectification_reason'='Synthetic explicit price difference' AND (snapshot->'invoice'->>'total_amount')::numeric=0 AND (snapshot->'lines'->0->>'unit_price')::numeric=0 FROM private.verifactu_records WHERE invoice_id='${issuedChild}')`, 'issue-first retains old coherent header and lines and rejects waiting save');
  console.log('PASS: atomic correction saves and issue serialize in both orders with coherent snapshots');
  await chainCheck(11);
  for (const kind of ['base','correction']) for (const action of ['issue','mode']) await rollbackWriterRace(kind,action,migration);
  console.log('VERI*FACTU correction PostgreSQL concurrency gate passed (synthetic data, no AEAT).');
} finally {
  if (created) await sql(`DROP DATABASE ${db} WITH (FORCE);`, { database: 'postgres' });
}
