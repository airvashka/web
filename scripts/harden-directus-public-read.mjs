#!/usr/bin/env node
/**
 * SFR Motor — zúžení veřejného (Public) čtení v Directusu.
 *
 * Co dělá:
 *   - Zruší PUBLIC read na `knowledge_documents` (znalostní báze AI chatbota —
 *     frontend ji nepoužívá, chatbot je vypnutý; nemá být veřejně čitelná).
 *
 * Co NEdělá (záměrně — ať nerozbije web):
 *   - `employees` necháváme veřejné — všechna pole jsou pracovní kontakty,
 *     které se stejně zobrazují na webu (jméno, role, e-mail, telefon, foto).
 *   - `site_settings` necháváme — frontend z nich tahá zobrazovací konfiguraci.
 *   - `leads` a `users` jsou už správně chráněné (403).
 *
 * Idempotentní — lze spustit opakovaně.
 *
 * Použití:
 *   cd web && node scripts/harden-directus-public-read.mjs
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

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Zúžení veřejného čtení v Directusu');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://admin.sfr-motor.cz]: ')).trim() || 'https://admin.sfr-motor.cz';
  const email = (await prompt('Email (admin): ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // Najdi Public policy (user==null && role==null)
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=policy');
  const policyId = access.data?.[0]?.policy;
  if (!policyId) throw new Error('Public policy nenalezena');
  info(`Public policy: ${policyId}`);

  const COLLECTIONS_TO_PRIVATE = ['knowledge_documents'];
  for (const collection of COLLECTIONS_TO_PRIVATE) {
    const existing = await api('GET',
      `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=read&fields=id&limit=10`);
    const perms = existing.data ?? [];
    if (perms.length === 0) {
      info(`${collection}: veřejné read už neexistuje (OK)`);
      continue;
    }
    for (const p of perms) {
      await api('DELETE', `/permissions/${p.id}`);
    }
    ok(`${collection}: veřejné read zrušeno (${perms.length} pravidlo/a)`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Ověř: GET https://admin.sfr-motor.cz/items/knowledge_documents');
  console.log('  → má vrátit 403. (employees/site_settings necháváme veřejné záměrně.)');
  console.log('═══════════════════════════════════════════════\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
