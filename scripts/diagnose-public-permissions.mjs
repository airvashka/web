#!/usr/bin/env node
/**
 * SFR Motor — diagnostika a fix public permissions
 *
 * Předchozí skript hlásil "permission už existuje", ale build pořád 403/400.
 * Důvod: v Directus 11 můžou existovat dvě "public" policies, nebo permission
 * je napojena na policy, která NENÍ aktivní pro anonymous přístup.
 *
 * Tento skript:
 *   1) najde VŠECHNY access entries kde user/role je null (= anonymous)
 *   2) získá policy ID každé z těchto entries (to je "aktivní" public policy)
 *   3) zkontroluje které permissions na ní jsou
 *   4) přidá chybějící (option_packages, sub_brands + junctions)
 *
 * Použití:
 *   cd web && node scripts/diagnose-public-permissions.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Public permissions — diagnostic & fix');
  console.log('═══════════════════════════════════════════════\n');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // ═══ 1. List všech policies
  console.log('═══ Krok 1: Všechny policies v systému ═══');
  const allPolicies = await api('GET', '/policies?limit=100&fields=id,name,description,admin_access,app_access');
  for (const p of allPolicies.data) {
    console.log(`  • ${p.name} ${p.admin_access ? '(admin)' : p.app_access ? '(app)' : '(custom)'}  id=${p.id}`);
  }
  console.log('');

  // ═══ 2. Najdi access entries pro anonymous (user=null, role=null)
  console.log('═══ Krok 2: Access entries pro anonymous (user=null, role=null) ═══');
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=id,policy.id,policy.name');
  if (!access.data || access.data.length === 0) {
    warn('Žádné anonymous access entry! Bez něj public nikdy nebude fungovat.');
    info('Musíš v adminu: Settings → Access Control → klik na "+ Add" → policy "Public", user/role prázdné.');
    rl.close();
    return;
  }
  const activePublicPolicyIds = [];
  for (const a of access.data) {
    const pid = a.policy?.id ?? a.policy;
    const pname = a.policy?.name ?? '(unknown)';
    activePublicPolicyIds.push(pid);
    console.log(`  • Access entry id=${a.id} → policy "${pname}" id=${pid}`);
  }
  console.log('');

  if (activePublicPolicyIds.length === 0) {
    warn('Žádná aktivní public policy nenalezena.');
    rl.close();
    return;
  }

  // ═══ 3. Pro každou aktivní public policy zkontroluj a doplň permissions
  const REQUIRED = [
    { collection: 'option_packages', publishedFilter: true },
    { collection: 'sub_brands', publishedFilter: false },
    { collection: 'option_packages_stock_vehicles', publishedFilter: false },
    { collection: 'models_directus_files', publishedFilter: false },
    { collection: 'stock_vehicles_directus_files', publishedFilter: false },
  ];

  for (const policyId of activePublicPolicyIds) {
    console.log(`═══ Krok 3: Permissions na aktivní policy ${policyId} ═══`);
    for (const req of REQUIRED) {
      const existing = await api(
        'GET',
        `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${req.collection}&filter[action][_eq]=read&limit=1`
      );
      if ((existing.data?.length ?? 0) > 0) {
        ok(`${req.collection}: read už existuje na této policy`);
        continue;
      }
      const body = {
        policy: policyId,
        collection: req.collection,
        action: 'read',
        fields: ['*'],
        permissions: req.publishedFilter ? { _and: [{ status: { _eq: 'published' } }] } : {},
      };
      try {
        await api('POST', '/permissions', body);
        ok(`${req.collection}: read přidáno`);
      } catch (e) {
        warn(`${req.collection}: ${e.message}`);
      }
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo. Spusť npm run build a 403/400 by měly');
  console.log('  zmizet. Pokud ne, pošli mi output Kroku 2.');
  console.log('═══════════════════════════════════════════════\n');
  rl.close();
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  rl.close();
  process.exit(1);
});
