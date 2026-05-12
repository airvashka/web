#!/usr/bin/env node
/**
 * SFR Motor — force reset permissions a okamžitě otestuje public přístup.
 *
 * Smaže existující read permissions na public policy pro option_packages
 * a sub_brands a nově je vytvoří s **ověřeným formátem** z setup-directus.mjs.
 * Pak udělá unauthenticated GET request a vypíše skutečnou response.
 *
 * Použití:
 *   cd web && node scripts/force-reset-permissions.mjs
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

// PUBLIC GET — bez tokenu (jak to dělá web build)
async function publicGet(path) {
  const r = await fetch(`${DIRECTUS_URL}${path}`);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, ok: r.ok, body: j };
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);
const err = (m) => console.log(`  ✗  ${m}`);

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Force reset public permissions + test');
  console.log('═══════════════════════════════════════════════\n');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1. Najdi aktivní public policy
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=policy');
  const policyId = access.data?.[0]?.policy;
  if (!policyId) throw new Error('Anonymous access entry nenalezen.');
  ok(`Public policy ID: ${policyId}\n`);

  // 2. Pro option_packages a sub_brands: detail existující permission + smazat + znova
  // Pozn: option_packages a sub_brands NEMAJÍ status field, proto null filter.
  const COLLECTIONS = [
    { name: 'option_packages', publishedFilter: false },
    { name: 'sub_brands', publishedFilter: false },
  ];

  for (const col of COLLECTIONS) {
    console.log(`═══ ${col.name} ═══`);

    // (a) Schema info — zjistíme typy a status field
    try {
      const collInfo = await api('GET', `/collections/${col.name}`);
      const hasStatus = (collInfo?.data?.meta?.archive_field || collInfo?.data?.fields?.includes?.('status')) ? '?' : '?';
      info(`Schema OK (collection existuje)`);
    } catch (e) {
      err(`Collection ${col.name} neexistuje: ${e.message}`);
      continue;
    }

    // (b) Najdi existující permission record
    const existing = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${col.name}&filter[action][_eq]=read&limit=10`);
    if (existing.data?.length > 0) {
      info(`Existuje ${existing.data.length} read permission(s). Detail:`);
      for (const p of existing.data) {
        console.log(`     id=${p.id}  fields=${JSON.stringify(p.fields)}  permissions=${JSON.stringify(p.permissions)}`);
      }
      // Smazat všechny
      for (const p of existing.data) {
        await api('DELETE', `/permissions/${p.id}`);
      }
      ok(`Smazáno ${existing.data.length} starých permission(s)`);
    } else {
      info('Žádná existující read permission.');
    }

    // (c) Nová permission s ověřeným formátem (přesně jak v setup-directus.mjs)
    const body = {
      policy: policyId,
      collection: col.name,
      action: 'read',
      fields: ['*'],
      // null místo {} pro "bez filtru" — Directus 11 doporučený formát
      permissions: col.publishedFilter
        ? { _and: [{ status: { _eq: 'published' } }] }
        : null,
    };
    try {
      const created = await api('POST', '/permissions', body);
      ok(`Vytvořena nová permission id=${created?.data?.id}`);
    } catch (e) {
      err(`POST permission selhalo: ${e.message}`);
    }

    // (d) UNAUTHENTICATED test — simulace build requestu
    const test = await publicGet(`/items/${col.name}?limit=1`);
    if (test.ok) {
      ok(`Unauthenticated GET: ${test.status} OK (count=${test.body?.data?.length ?? 0})`);
    } else {
      err(`Unauthenticated GET: ${test.status} → ${JSON.stringify(test.body?.errors ?? test.body)}`);
    }
    console.log('');
  }

  // 3. Bonus: zkontroluj sub_brands strukturu (kvůli 400 erroru na build)
  console.log('═══ sub_brands schema check ═══');
  try {
    const fields = await api('GET', '/fields/sub_brands');
    for (const f of fields.data) {
      console.log(`  • ${f.field}: ${f.type}${f.schema?.is_primary_key ? ' [PK]' : ''}`);
    }
  } catch (e) {
    warn(e.message);
  }
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Pokud unauthenticated GET vrací 200 OK, build');
  console.log('  poběží bez 403/400. Pošli mi output, ukáže to.');
  console.log('═══════════════════════════════════════════════\n');
  rl.close();
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  rl.close();
  process.exit(1);
});
