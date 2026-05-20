#!/usr/bin/env node
/**
 * SFR Motor — WIPE skladovych vozu (stock_vehicles) + volitelny reset ID sekvence.
 *
 * !!! DESTRUKTIVNI !!! Smaze VSECHNY stock_vehicles (KGM i OMODA i rucni).
 * Pouziti pro cisty start pred re-importem. Po wipe pust znovu oba syncy.
 *
 *   node scripts/wipe-stock.mjs               # DRY-RUN: jen vypise pocet
 *   node scripts/wipe-stock.mjs --confirm     # opravdu smaze (po napsani SMAZAT)
 *   node scripts/wipe-stock.mjs --confirm --reset-seq   # + reset ID na 1 (pta se DATABASE_URL)
 *
 * Pozn.: fotky (directus_files) zustanou ve slozkach Import — KGM / Import - OMODA & JAECOO
 * (osirele), muzes je smazat rucne v adminu. Lead.source_vehicle se nastavi na null
 * (dle relace), leady se NEMAZOU.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const RESET_SEQ = args.includes('--reset-seq');

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);
let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

async function main() {
  console.log('\n=== WIPE stock_vehicles ===');
  console.log(CONFIRM ? '  [OSTRY] opravdu smaze' : '  [DRY-RUN] jen vypise (pro smazani pridej --confirm)');
  console.log('');
  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim() || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');
  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;

  const all = await api('GET', '/items/stock_vehicles?fields=id&limit=-1');
  const ids = (all.data ?? []).map((x) => x.id);
  console.log(`  Nalezeno ${ids.length} skladovych vozu.`);

  if (!CONFIRM) {
    console.log('\n  DRY-RUN — nic se nesmazalo. Pro smazani: node scripts/wipe-stock.mjs --confirm');
    rl.close(); return;
  }
  if (ids.length === 0) { console.log('  Nic ke smazani.'); rl.close(); return; }

  const a = (await prompt(`\n  Opravdu SMAZAT vsech ${ids.length} vozu? Napis "SMAZAT": `)).trim();
  if (a !== 'SMAZAT') { console.log('  Zruseno.'); rl.close(); return; }

  // Batch delete (po 100)
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await api('DELETE', '/items/stock_vehicles', chunk);
    deleted += chunk.length;
    console.log(`  smazano ${deleted}/${ids.length}`);
  }
  console.log(`  Hotovo, smazano ${deleted} vozu.`);

  if (RESET_SEQ) {
    const dbUrl = (await prompt('\n  DATABASE_URL pro reset ID sekvence (Render Postgres, prazdne = preskocit): ')).trim();
    if (dbUrl) {
      let pg;
      try { pg = (await import('pg')).default; } catch { console.log('  pg modul chybi (npm i pg) — sekvence neresetovana.'); rl.close(); return; }
      const client = new pg.Client({ connectionString: dbUrl });
      await client.connect();
      const seq = await client.query("SELECT pg_get_serial_sequence('stock_vehicles','id') AS s");
      const seqName = seq.rows[0]?.s;
      if (seqName) {
        await client.query(`ALTER SEQUENCE ${seqName} RESTART WITH 1`);
        console.log(`  ID sekvence ${seqName} resetovana na 1.`);
      } else { console.log('  Sekvence nenalezena — preskoceno.'); }
      await client.end();
    } else { console.log('  Reset sekvence preskocen.'); }
  }

  console.log('\n  DALSI KROK: pust znovu oba syncy:');
  console.log('    node scripts/sync-stock-kgm.mjs');
  console.log('    node scripts/sync-stock-omoda-jaecoo.mjs\n');
  rl.close();
}
main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
