#!/usr/bin/env node
/**
 * Doplní `articles` (a další obsahové collections) do watched scope Flow
 * "Rebuild Vercel on content change". Pak publikace článku spustí rebuild webu.
 *
 * Použití:
 *   node scripts/update-webhook-add-articles.mjs
 *
 * Re-runnable — PATCHuje existing flow, idempotentní (jen rozšiřuje list).
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

// Vše co má spustit rebuild — sjednocení dosavadního scope + chybějící content collections
const COLLECTIONS = [
  // Vozy
  'brands', 'sub_brands', 'models', 'model_years', 'trim_levels', 'option_packages',
  // Skladovky
  'stock_vehicles', 'stock_vehicles_option_packages', 'stock_vehicles_files',
  // Modely – contents
  'model_highlights', 'model_color_exterior', 'model_color_interior', 'models_files',
  // Pobočky/Lidé
  'branches', 'employees',
  // Magazín — NOVĚ
  'articles',
  // Site settings (favicon, header config…)
  'site_settings',
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

  // Sjednocení (zachovat existující + přidat naše)
  const merged = Array.from(new Set([...currentCollections, ...COLLECTIONS]));
  const added = merged.filter((c) => !currentCollections.includes(c));

  if (!added.length) {
    console.log('✅ Všechny collections už jsou ve flow scope, není co dělat.');
    rl.close();
    return;
  }

  console.log(`\n   Přidávám: ${added.join(', ')}\n`);

  await api('PATCH', `/flows/${flow.id}`, {
    options: {
      ...(flow.options ?? {}),
      type: 'action',
      scope: flow.options?.scope ?? ['items.create', 'items.update', 'items.delete'],
      collections: merged,
    },
  });

  console.log(`✅ Flow updated — ${merged.length} collections watched.`);
  console.log('');
  console.log('Test:');
  console.log('  Directus → Articles → vytvoř/publikuj článek → Save');
  console.log('  Vercel dashboard → Deployments — měl bys vidět nový deploy');
  console.log('');
  rl.close();
}

main().catch((e) => { console.log(`❌ ${e.message}`); rl.close(); process.exit(1); });
