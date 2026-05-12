#!/usr/bin/env node
/**
 * SFR Motor — doplnění chybějících public-read permissions.
 *
 * Build hlásí:
 *   [directus] 403 při fetchování option_packages
 *   [directus] 400 při fetchování sub_brands
 *
 * Tyhle collections byly přidány po původním setup-directus.mjs
 * a nemají Public policy s read přístupem.
 *
 * Skript najde Public Access Policy a přidá `read` permission
 * (s filtrem status=published kde je).
 *
 * Použití:
 *   cd web && node scripts/grant-extra-permissions.mjs
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
const warn = (m) => console.log(`  ⚠  ${m}`);

// Vrátí ID public policy (musí existovat z setup-directus.mjs)
async function findPublicPolicy() {
  const r = await api('GET', '/policies?filter[name][_eq]=$t:public_label&limit=1');
  let p = r?.data?.[0];
  if (p) return p.id;
  // Fallback — některé instalace mají name "Public"
  const r2 = await api('GET', '/policies?filter[name][_eq]=Public&limit=1');
  p = r2?.data?.[0];
  if (p) return p.id;
  throw new Error('Public policy nenalezena. Spusť nejdřív setup-directus.mjs.');
}

async function permissionExists(policyId, collection, action) {
  const r = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=${action}&limit=1`);
  return (r?.data?.length ?? 0) > 0;
}

async function grantPublicRead(policyId, collection, opts = {}) {
  if (await permissionExists(policyId, collection, 'read')) {
    warn(`${collection}: read permission už existuje`);
    return;
  }
  const body = {
    policy: policyId,
    collection,
    action: 'read',
    fields: ['*'],
    permissions: opts.publishedOnly ? { _and: [{ status: { _eq: 'published' } }] } : {},
  };
  await api('POST', '/permissions', body);
  ok(`${collection}: public-read přidáno${opts.publishedOnly ? ' (status=published filter)' : ''}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Grant extra public permissions');
  console.log('═══════════════════════════════════════════════\n');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  const policyId = await findPublicPolicy();
  ok(`Public policy ID: ${policyId}\n`);

  console.log('Přidávám public-read permissions:');
  // option_packages — má status field → published-only
  await grantPublicRead(policyId, 'option_packages', { publishedOnly: true });
  // sub_brands — pravděpodobně NEMÁ status field, žádný filtr
  await grantPublicRead(policyId, 'sub_brands');
  // Pro jistotu i další collections co může build potřebovat
  await grantPublicRead(policyId, 'option_packages_stock_vehicles');  // M2M junction
  await grantPublicRead(policyId, 'models_directus_files');             // M2M gallery junction
  await grantPublicRead(policyId, 'stock_vehicles_directus_files');     // M2M photos junction

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo! Spusť `npm run build` znovu —');
  console.log('  403/400 chyby by měly zmizet.');
  console.log('═══════════════════════════════════════════════\n');
  rl.close();
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  rl.close();
  process.exit(1);
});
