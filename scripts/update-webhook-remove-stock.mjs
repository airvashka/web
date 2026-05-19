#!/usr/bin/env node
/**
 * Odebere `stock_vehicles*` collections z watch listu Flow
 * "Rebuild Vercel on content change".
 *
 * Důvod: /sklad/[id] je teď SSR (prerender=false), data se tahají při requestu.
 * Webhook rebuild při změně skladovky je zbytečný a drahý — každá změna ceny / fotky
 * / statusu by triggerovala plný Vercel build (5-10 min).
 *
 * Po pustění:
 *  - Admin změní cenu vozu → SSR ji zobrazí okamžitě → ŽÁDNÝ rebuild
 *  - Admin změní model / promo akci → rebuild jako dřív (model pages jsou static)
 *  - Admin přidá článek → rebuild jako dřív
 *
 * Použití:
 *   node scripts/update-webhook-remove-stock.mjs
 *
 * Re-runnable — idempotentní.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

// Collections k odebrání — všechny stock_vehicles* (junction tables + main)
const TO_REMOVE = [
  'stock_vehicles',
  'stock_vehicles_option_packages',
  'stock_vehicles_files',
];

async function main() {
  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  TOKEN = auth?.data?.access_token;
  if (!TOKEN) { console.log('❌ Auth selhal'); process.exit(1); }
  console.log('✅ Auth OK\n');

  // Najdi existing flow
  const flows = await api('GET', '/flows?filter[name][_eq]=Rebuild Vercel on content change&limit=1');
  const flow = flows?.data?.[0];
  if (!flow) {
    console.log('❌ Flow "Rebuild Vercel on content change" nenalezen.');
    console.log('   Spusť nejdřív: node scripts/setup-directus-webhook.mjs');
    rl.close();
    return;
  }
  console.log(`ℹ️   Flow nalezen (id=${flow.id})`);

  const currentCollections = flow.options?.collections ?? [];
  console.log(`ℹ️   Aktuálně watchované: ${currentCollections.length} collections`);

  // Filtrace — odstranit stock collections
  const filtered = currentCollections.filter((c) => !TO_REMOVE.includes(c));
  const removed = currentCollections.filter((c) => TO_REMOVE.includes(c));

  if (!removed.length) {
    console.log('✅ Žádné stock_vehicles collections ve flow scope, není co dělat.');
    rl.close();
    return;
  }

  console.log(`\n   Odstraňuji: ${removed.join(', ')}`);
  console.log(`   Po změně watchované: ${filtered.length} collections\n`);

  await api('PATCH', `/flows/${flow.id}`, {
    options: {
      ...(flow.options ?? {}),
      type: 'action',
      scope: flow.options?.scope ?? ['items.create', 'items.update', 'items.delete'],
      collections: filtered,
    },
  });

  console.log(`✅ Flow updated — ${filtered.length} collections watched.`);
  console.log('');
  console.log('Co se teď bude dít:');
  console.log('  • Změna ceny/fotky/statusu vozu v Directus → ŽÁDNÝ rebuild (SSR)');
  console.log('  • Změna modelu / promo akce → rebuild (static pages)');
  console.log('  • Nový článek → rebuild');
  console.log('');
  console.log('Test:');
  console.log('  Directus → Skladové vozy → uprav cenu → Save');
  console.log('  Vercel dashboard → Deployments — žádný nový deploy by se NEMĚL spustit');
  console.log('  Web → /sklad/[ten-vůz] → nová cena viditelná hned (refresh)');
  console.log('');
  rl.close();
}

main().catch((e) => { console.log(`❌ ${e.message}`); rl.close(); process.exit(1); });
