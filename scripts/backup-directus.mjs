#!/usr/bin/env node
/**
 * SFR Motor — Daily backup Directus collections do JSON souborů.
 *
 * Co dělá:
 *   1) Stáhne všechny záznamy z klíčových collections (brands, models, trim_levels,
 *      stock_vehicles, articles, employees, knowledge_documents...)
 *   2) Uloží jako JSON do `_backups/YYYY-MM-DD/` v repu
 *   3) Pokud spuštěno přes cron na Vercel/Railway, push commit do gitu
 *
 * Idempotentní — přepíše existující backup z téhož dne.
 *
 * Použití:
 *   # Lokálně:
 *   node scripts/backup-directus.mjs
 *
 *   # Automaticky přes Vercel cron:
 *   v vercel.json: { "crons": [{ "path": "/api/cron/backup", "schedule": "0 3 * * *" }] }
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);

// Collections k backupu — všechny klíčové
const COLLECTIONS = [
  'brands',
  'sub_brands',
  'models',
  'model_years',
  'trim_levels',
  'option_packages',
  'model_highlights',
  'model_color_exterior',
  'model_color_interior',
  'stock_vehicles',
  'branches',
  'employees',
  'articles',
  'leads',
  'knowledge_documents',
  'site_settings',
  // Junction tables
  'stock_vehicles_option_packages',
  'stock_vehicles_files',
  'models_files',
];

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Backup Directus → JSON');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const backupDir = join('_backups', today);
  if (!existsSync('_backups')) mkdirSync('_backups');
  if (!existsSync(backupDir)) mkdirSync(backupDir);

  let totalRecords = 0;
  let totalSize = 0;

  for (const collection of COLLECTIONS) {
    try {
      const res = await api('GET', `/items/${collection}?limit=-1&fields=*`);
      const data = res?.data ?? [];
      const json = JSON.stringify(data, null, 2);
      const path = join(backupDir, `${collection}.json`);
      writeFileSync(path, json, 'utf-8');
      const sizeKb = (json.length / 1024).toFixed(1);
      totalRecords += data.length;
      totalSize += json.length;
      ok(`${collection.padEnd(40)} ${String(data.length).padStart(5)} záznamů (${sizeKb} KB)`);
    } catch (e) {
      console.log(`  ✗ ${collection}: ${e.message}`);
    }
  }

  console.log('');
  ok(`Hotovo. ${totalRecords} záznamů, ${(totalSize / 1024 / 1024).toFixed(2)} MB.`);
  ok(`Uloženo: ${backupDir}/`);
  console.log('');
  info('Tip: commit + push do gitu pro permanent backup:');
  info(`  git add ${backupDir} && git commit -m "backup ${today}" && git push`);

  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
