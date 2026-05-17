#!/usr/bin/env node
/**
 * Vymaže `read_time` u všech článků (nastaví na null).
 * Frontend pak používá auto-výpočet z body textu (lib/articles.ts).
 *
 * Použití:
 *   node scripts/clear-article-readtime.mjs
 */
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
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

async function main() {
  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  console.log('✅ Auth OK\n');

  const all = await api('GET', '/items/articles?fields=id,slug,read_time&limit=-1');
  const articles = all.data ?? [];
  const withTime = articles.filter((a) => a.read_time);
  console.log(`Celkem ${articles.length} článků, z toho ${withTime.length} má vyplněný read_time.\n`);

  let cleared = 0;
  for (const a of withTime) {
    try {
      await api('PATCH', `/items/articles/${a.id}`, { read_time: null });
      console.log(`  ✓  ${a.slug}: "${a.read_time}" → null`);
      cleared++;
    } catch (e) {
      console.log(`  ✗  ${a.slug}: ${e.message}`);
    }
  }
  console.log(`\n✅ Hotovo. ${cleared} článků vyčištěno. Frontend si je teď dopočítá z body.`);
  rl.close();
}
main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
