#!/usr/bin/env node
/**
 * SFR Motor — quick fix: trim_levels.features template
 *
 * Předchozí template "{{category}} ({{items.length}} položek)" byl bugem
 * Directus template engine: items.length iteruje array a vrací délku každého
 * stringu zřetězenou (např. "20151029254029" místo "7").
 *
 * Fix: zjednodušit template na pouhé "{{category}}".
 *
 * Použití:
 *   cd web && node scripts/fix-features-template.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

async function main() {
  console.log('Fix template pro trim_levels.features\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;

  const current = await api('GET', '/fields/trim_levels/features');
  const meta = current.data?.meta ?? {};
  const options = meta.options ?? {};

  await api('PATCH', '/fields/trim_levels/features', {
    meta: {
      ...meta,
      options: {
        ...options,
        template: '{{category}}',
      },
    },
  });
  console.log('  ✓  trim_levels.features template → "{{category}}"');
  console.log('\nCtrl+Shift+R v adminu. V collapsed view každé skupiny teď uvidíš jen "pohon", "bezpecnost", … bez šíleného čísla.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
