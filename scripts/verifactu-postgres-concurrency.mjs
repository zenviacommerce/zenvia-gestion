// Real PostgreSQL integration gate. Never point this at an application database.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
let created = false;
try {
  assert.ok(Number(await sql('SHOW server_version_num;', { database: 'postgres' })) >= 170000, 'PostgreSQL 17 or newer required');
  await sql(`CREATE DATABASE ${db};`, { database: 'postgres' });
  created = true;
  await sql(readFileSync(new URL('../tests/fixtures/verifactu-before.sql', import.meta.url), 'utf8'));
  await sql(readFileSync(new URL('../supabase/migrations/20261024075749_verifactu_shadow_phase1.sql', import.meta.url), 'utf8'));
  await sql(`SET test.uid='${owner}'; SET test.owner='${owner}'; INSERT INTO private.verifactu_settings(owner_id,mode,issuer_nif) VALUES('${owner}','shadow','89890001K');`);
  for (let n = 1; n <= 20; n++) await draft(n);
  const numbers = await Promise.all(Array.from({ length: 20 }, (_, index) => sql(`${context}${issue(index + 1)}`)));
  assert.deepEqual(numbers.sort(), Array.from({ length: 20 }, (_, index) => `F-2026-${String(index + 1).padStart(4, '0')}`));
  await chainCheck(20);
  console.log('PASS: 20 simultaneous PostgreSQL clients, consecutive numbers, SHA-256 and unbranched chain');

  await draft(21);
  const retries = await Promise.all(Array.from({ length: 20 }, () => sql(`${context}${issue(21)}`)));
  assert.deepEqual([...new Set(retries)], ['F-2026-0021']);
  await check(`(SELECT count(*)=1 FROM private.verifactu_records WHERE invoice_id='${id(21)}') AND (SELECT next_number=22 FROM sales_invoice_series WHERE id='${series}')`, '20 retries consume exactly one number and record');
  await chainCheck(21);
  console.log('PASS: 20 concurrent retries are idempotent');

  const secondSeries = '00000000-0000-4000-8000-000000000023';
  await sql(`INSERT INTO sales_invoice_series(id,owner_id,code,name,kind,year,prefix) VALUES('${secondSeries}','${owner}','B','Synthetic second series','standard',2026,'B-2026-');`);
  await draft(22, secondSeries); await draft(23);
  await Promise.all([sql(`${context}${issue(22)}`), sql(`${context}${issue(23)}`)]);
  await chainCheck(23);
  await check(`(SELECT count(DISTINCT snapshot->'invoice'->>'series_id')=2 FROM private.verifactu_records)`, 'two series share one owner chain');
  console.log('PASS: simultaneous issues from two series share one chain');

  await draft(24);
  assert.equal(await sql(`${context}BEGIN;${issue(24)}ROLLBACK;`), 'F-2026-0023');
  await chainCheck(23);
  await check(`(SELECT status='draft' AND invoice_number IS NULL FROM sales_invoices WHERE id='${id(24)}') AND (SELECT next_number=23 FROM sales_invoice_series WHERE id='${series}')`, 'rollback consumes no number');
  assert.equal(await sql(`${context}${issue(24)}`), 'F-2026-0023');
  await chainCheck(24);
  console.log('PASS: rollback reuses the number and record sequence');

  await draft(25);
  // Observe the writer holding the parent invoice lock before starting issue.
  const editor = sql(`${context}BEGIN; UPDATE sales_invoice_lines SET unit_price=200 WHERE invoice_id='${id(25)}'; SELECT pg_sleep(2); COMMIT;`, { application: 'vf-edit-first' });
  await waitForSleep('vf-edit-first');
  await Promise.all([editor, sql(`${context}${issue(25)}`)]);
  await check(`(SELECT (snapshot->'invoice'->>'total_amount')::numeric=242 AND (snapshot->'lines'->0->>'line_total')::numeric=242 AND (snapshot->'lines'->0->>'unit_price')::numeric=200 FROM private.verifactu_records WHERE invoice_id='${id(25)}')`, 'edit-first captures coherent committed line and total');
  await draft(26);
  const issuer = sql(`${context}BEGIN;${issue(26)}SELECT pg_sleep(2);COMMIT;`, { application: 'vf-issue-first' });
  await waitForSleep('vf-issue-first');
  await Promise.all([issuer, denied(`${context}UPDATE sales_invoice_lines SET unit_price=300 WHERE invoice_id='${id(26)}';`, /VF_FISCAL_IMMUTABLE|emitida/) ]);
  await check(`(SELECT (snapshot->'invoice'->>'total_amount')::numeric=121 AND (snapshot->'lines'->0->>'line_total')::numeric=121 FROM private.verifactu_records WHERE invoice_id='${id(26)}') AND (SELECT unit_price=100 FROM sales_invoice_lines WHERE invoice_id='${id(26)}')`, 'issue-first rejects waiting line mutation');
  await chainCheck(26);
  console.log('PASS: both edit/issue lock orderings preserve coherent immutable snapshots');

  await draft(27);
  for (const mutation of ["status='draft'", "invoice_number='F-2026-9999'", 'total_amount=0', `owner_id='${other}'`]) await denied(`${context}UPDATE sales_invoices SET ${mutation} WHERE id='${id(1)}';`, /VF_FISCAL_IMMUTABLE|VF_TENANT_IMMUTABLE/);
  assert.equal(await sql(`${context}WITH removed AS (DELETE FROM sales_invoices WHERE id='${id(1)}' RETURNING id) SELECT count(*) FROM removed;`),'0','RLS filters issued rows from direct DELETE');
  await check(`EXISTS(SELECT 1 FROM sales_invoices WHERE id='${id(1)}' AND status='issued')`,'filtered DELETE leaves issued document intact');
  await denied(`SET test.uid='${owner}';SET test.owner='${owner}';DELETE FROM sales_invoices WHERE id='${id(1)}';`,/VF_FISCAL_IMMUTABLE/);
  await denied(`${context}SET test.owner='${other}';${issue(27)}`, /VF_DOCUMENT_NOT_FOUND/);
  await denied(`${context}SET test.mfa='no';${issue(27)}`, /MFA_REQUIRED/);
  await denied(`${context}SELECT * FROM private.verifactu_records;`, /permission denied/);
  await denied(`${context}UPDATE private.verifactu_settings SET mode='disabled';`, /permission denied/);
  await denied(`${context}UPDATE sales_invoices SET status='issued' WHERE id='${id(27)}';`, /VF_ISSUE_RPC_REQUIRED/);
  await denied('DELETE FROM private.verifactu_records;', /VF_APPEND_ONLY/);
  await denied('TRUNCATE private.verifactu_events;', /VF_APPEND_ONLY/);
  await chainCheck(26);
  console.log('PASS: fiscal immutability, tenant boundary, MFA, direct archive and issue bypass denied');
  console.log('VERI*FACTU PostgreSQL concurrency gate passed (synthetic data, no AEAT connection).');
} finally {
  if (created) await sql(`DROP DATABASE ${db} WITH (FORCE);`, { database: 'postgres' });
}
