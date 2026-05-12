#!/usr/bin/env node
/**
 * Test PŘESNÉHO requestu, který build dělá na option_packages.
 *
 * Postup:
 *   1) Najde nějaký latestYear ID (auth)
 *   2) Vypíše schema option_packages — všechny fieldy včetně typu
 *   3) Vypíše VŠECHNY permission records pro option_packages na public policy
 *   4) Spustí přesně tu unauth fetch, kterou dělá build, s detailním errorem
 *   5) Postupně eliminuje co je problém — bez filtru, s filtrem, …
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

async function publicGet(path) {
  const r = await fetch(`${URL}${path}`);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, ok: r.ok, body: j };
}

async function main() {
  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  console.log('Auth OK\n');

  // 1. Public policy ID
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=policy');
  const policyId = access.data?.[0]?.policy;
  console.log(`Public policy: ${policyId}\n`);

  // 2. Schema option_packages
  console.log('═══ option_packages SCHEMA ═══');
  const fields = await api('GET', '/fields/option_packages');
  for (const f of fields.data) {
    const isPK = f.schema?.is_primary_key ? ' [PK]' : '';
    const isFK = f.schema?.foreign_key_table ? ` → ${f.schema.foreign_key_table}` : '';
    console.log(`  • ${f.field}: ${f.type}${isPK}${isFK}`);
  }
  console.log('');

  // 3. VŠECHNY permission records pro option_packages
  console.log('═══ option_packages PERMISSIONS (na public policy) ═══');
  const perms = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=option_packages&limit=100`);
  if (perms.data.length === 0) {
    console.log('  ✗ ŽÁDNÉ permissions! To je problém.');
  } else {
    for (const p of perms.data) {
      console.log(`  • id=${p.id}  action=${p.action}  fields=${JSON.stringify(p.fields)}  permissions=${JSON.stringify(p.permissions)}`);
    }
  }
  console.log('');

  // 4. Najdi libovolný model_year ID pro test
  const my = await api('GET', '/items/model_years?limit=1&fields=id');
  const myId = my.data?.[0]?.id;
  console.log(`Test model_year ID: ${myId}\n`);

  // 5. Unauthenticated TEST — přesně jak build
  console.log('═══ UNAUTHENTICATED requests (jak build) ═══\n');

  const tests = [
    { name: 'A) Bez filtru, bez fields', url: `/items/option_packages?limit=2` },
    { name: 'B) S filtrem model_year, bez fields', url: `/items/option_packages?limit=2&filter={"model_year":{"_eq":${myId}}}` },
    { name: 'C) S fields=*', url: `/items/option_packages?limit=2&fields=*` },
    { name: 'D) S sort=sort', url: `/items/option_packages?limit=2&sort=sort` },
    { name: 'E) Build kombinace', url: `/items/option_packages?filter=${encodeURIComponent(JSON.stringify({model_year:{_eq:myId}}))}&sort=sort&fields=*` },
  ];

  for (const t of tests) {
    const r = await publicGet(t.url);
    if (r.ok) {
      console.log(`✓ ${t.name}`);
      console.log(`   ${r.status} OK, count=${r.body?.data?.length ?? 0}`);
    } else {
      console.log(`✗ ${t.name}`);
      console.log(`   ${r.status} ERROR`);
      console.log(`   URL: ${t.url}`);
      console.log(`   Body: ${JSON.stringify(r.body?.errors ?? r.body).substring(0, 300)}`);
    }
    console.log('');
  }

  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
