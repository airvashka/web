#!/usr/bin/env node
/**
 * SFR Motor — Setup webhook Directus → Vercel
 *
 * Vytvoří v Directusu Flow s triggerem "item create/update/delete" na všech
 * obsahových collections, který POST'uje na Vercel Deploy Hook URL.
 *
 * Výsledek: jakákoliv změna v adminu spustí rebuild Astra na Vercelu během 30 s.
 *
 * Re-runnable: skipuje pokud Flow už existuje (kontroluje podle name).
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '';
let TOKEN = '';

async function api(method, path, body) {
  const url = `${DIRECTUS_URL}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const e = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    e.status = res.status; e.body = json;
    throw e;
  }
  return json;
}

const ok   = (m) => console.log(`✅  ${m}`);
const skip = (m) => console.log(`⏭️   ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);
const err  = (m) => console.log(`❌  ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);

const FLOW_NAME = 'Rebuild Vercel on content change';

// Collections, jejichž změny mají spouštět rebuild
const WATCH_COLLECTIONS = [
  // Vozy
  'brands', 'sub_brands', 'models', 'model_years', 'trim_levels', 'option_packages',
  // Modely — content
  'model_highlights', 'model_color_exterior', 'model_color_interior', 'models_files',
  // Skladovky
  'stock_vehicles', 'stock_vehicles_option_packages', 'stock_vehicles_files',
  // Pobočky/Lidé
  'branches', 'employees',
  // Magazín
  'articles',
  // Site settings (favicon, header, footer config)
  'site_settings',
];

async function findExistingFlow() {
  try {
    const res = await api('GET', `/flows?filter[name][_eq]=${encodeURIComponent(FLOW_NAME)}&limit=1`);
    return res?.data?.[0] ?? null;
  } catch (e) {
    if (e.status === 403 || e.status === 404) return null;
    throw e;
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Setup Directus → Vercel webhook');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  const hookUrl = (await prompt('Vercel Deploy Hook URL: ')).trim();
  console.log('');

  if (!hookUrl.startsWith('https://api.vercel.com/')) {
    err('Vercel Deploy Hook URL musí začínat https://api.vercel.com/');
    process.exit(1);
  }

  info(`Auth → ${DIRECTUS_URL}`);
  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth?.data?.access_token;
  if (!TOKEN) { err('Auth selhal'); process.exit(1); }
  ok('Auth OK');
  console.log('');

  // Check existing
  info('Hledám existující Flow se jménem "' + FLOW_NAME + '"...');
  const existing = await findExistingFlow();
  if (existing) {
    warn(`Flow už existuje (id=${existing.id}). Aktualizuju trigger + operation...`);
    // Skip recreation, just update if needed — for simplicity teď vrátíme info
    info('Pokud chceš změnit nastavení, smaž existující Flow v Directus admin a spusť skript znovu.');
    console.log('');
    rl.close();
    return;
  }

  // Create Flow
  info('Vytvářím Flow...');
  const flowRes = await api('POST', '/flows', {
    name: FLOW_NAME,
    icon: 'rocket_launch',
    color: '#1976D2',
    description: 'Automaticky spustí rebuild Vercel webu při změně obsahu v adminu (30s do live).',
    status: 'active',
    trigger: 'event',
    accountability: 'all',
    options: {
      type: 'action',
      scope: ['items.create', 'items.update', 'items.delete'],
      collections: WATCH_COLLECTIONS,
    },
  });
  const flow = flowRes.data;
  ok(`Flow vytvořen (id=${flow.id})`);

  // Create operation — webhook call
  info('Vytvářím Operation (webhook)...');
  const opRes = await api('POST', '/operations', {
    name: 'Vercel rebuild',
    key: 'vercel_rebuild',
    type: 'request',
    position_x: 19,
    position_y: 1,
    options: {
      url: hookUrl,
      method: 'POST',
      headers: [],
      body: '',
    },
    flow: flow.id,
  });
  const operation = opRes.data;
  ok(`Operation vytvořena (id=${operation.id})`);

  // Link operation to flow (set as first operation)
  info('Propojuju Flow ↔ Operation...');
  await api('PATCH', `/flows/${flow.id}`, {
    operation: operation.id,
  });
  ok('Flow → Operation propojeno');
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('Test:');
  console.log(`  1. Otevři ${DIRECTUS_URL}/admin/content/models`);
  console.log('  2. Klikni na Korando TEST → uprav cokoliv (např. tagline)');
  console.log('  3. Save (fajfka vpravo nahoře)');
  console.log('  4. Otevři Vercel dashboard → Deployments — měl bys vidět NOVÝ deploy probíhající');
  console.log('  5. Za ~30s je tvoje změna live na webu');
  console.log('');
  console.log('Webhook se spustí při ANY změně v těchto collections:');
  WATCH_COLLECTIONS.forEach(c => console.log(`  • ${c}`));
  console.log('');

  rl.close();
}

main().catch((e) => { err(e.message); rl.close(); process.exit(1); });
