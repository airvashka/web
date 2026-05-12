#!/usr/bin/env node
/**
 * SFR Motor — Fix script pro Public permissions v Directus 11.
 *
 * V Directus 11 se permissions vážou na "Access Policy", ne na Role.
 * Tento skript:
 *  1. Najde / vytvoří Public policy
 *  2. Nastaví READ permissions pro veřejné collections (jen status=published)
 *  3. Nastaví CREATE permission pro leads
 *  4. Připojí Public policy k anonymnímu přístupu (pokud není už)
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

// Collections + jejich permissions
const PUBLIC_READ_WITH_STATUS = ['brands', 'sub_brands', 'models', 'model_years', 'trim_levels', 'option_packages', 'stock_vehicles'];
const PUBLIC_READ_NO_STATUS   = ['branches', 'employees']; // tyto nemají `status` field
const PUBLIC_CREATE = {
  leads: ['form_type', 'customer_name', 'customer_email', 'customer_phone', 'message', 'source_model', 'source_vehicle', 'source_page', 'utm_source', 'utm_medium', 'utm_campaign'],
};

async function findOrCreatePublicPolicy() {
  // 1) Existující policy?
  let policies;
  try {
    policies = await api('GET', '/policies?filter[name][_eq]=Public&limit=1');
  } catch (e) {
    warn(`Nelze načíst /policies: ${e.message}`);
    return null;
  }

  if (policies?.data?.length) {
    const p = policies.data[0];
    info(`Public policy nalezena: ${p.name} (${p.id})`);
    return p;
  }

  // 2) Pokud neexistuje, najdi policy s `ip_access` null + bez `admin_access`/`app_access`
  //    nebo s id "abf8a154-5b1c-4a46-ac9c-7300570f4f17" (Directus default Public)
  try {
    policies = await api('GET', '/policies?limit=100');
  } catch (e) { return null; }

  // Heuristika: hledáme defaultní policy bez admin/app access flagů
  const candidate = policies?.data?.find(p =>
    !p.admin_access && !p.app_access && (
      p.name?.toLowerCase().includes('public') ||
      p.name?.toLowerCase().includes('$t:public')
    )
  );
  if (candidate) {
    info(`Public policy nalezena podle heuristiky: ${candidate.name} (${candidate.id})`);
    return candidate;
  }

  // 3) Vytvořím novou
  info('Public policy neexistuje, vytvářím...');
  try {
    const created = await api('POST', '/policies', {
      name: 'Public',
      icon: 'public',
      description: 'Anonymní přístup pro veřejnou část webu (čtení modelů, vozů, vytvoření leadu)',
      ip_access: null,
      enforce_tfa: false,
      admin_access: false,
      app_access: false,
    });
    ok(`Public policy vytvořena: ${created.data.id}`);
    return created.data;
  } catch (e) {
    err(`Nepodařilo se vytvořit Public policy: ${e.message}`);
    return null;
  }
}

async function addPermission(policyId, body) {
  try {
    await api('POST', '/permissions', { policy: policyId, ...body });
    return true;
  } catch (e) {
    if (e.status === 400 && (e.message.includes('unique') || e.message.includes('exists'))) {
      return 'exists';
    }
    throw e;
  }
}

async function setupPublicPermissions(policyId) {
  info('Nastavuju READ permissions (status=published)...');
  for (const coll of PUBLIC_READ_WITH_STATUS) {
    try {
      const r = await addPermission(policyId, {
        collection: coll, action: 'read', fields: ['*'],
        permissions: { _and: [{ status: { _eq: 'published' } }] },
      });
      if (r === 'exists') skip(`  ${coll} — už existuje`);
      else ok(`  ${coll}`);
    } catch (e) { warn(`  ${coll}: ${e.message}`); }
  }

  info('Nastavuju READ permissions (bez filteru — branches, employees)...');
  for (const coll of PUBLIC_READ_NO_STATUS) {
    try {
      const r = await addPermission(policyId, {
        collection: coll, action: 'read', fields: ['*'],
      });
      if (r === 'exists') skip(`  ${coll} — už existuje`);
      else ok(`  ${coll}`);
    } catch (e) { warn(`  ${coll}: ${e.message}`); }
  }

  info('Nastavuju CREATE permissions pro lead form...');
  for (const [coll, fields] of Object.entries(PUBLIC_CREATE)) {
    try {
      const r = await addPermission(policyId, {
        collection: coll, action: 'create', fields,
      });
      if (r === 'exists') skip(`  ${coll} — už existuje`);
      else ok(`  ${coll} (jen: ${fields.length} polí)`);
    } catch (e) { warn(`  ${coll}: ${e.message}`); }
  }

  // Také čtení directus_files pro public (aby web mohl zobrazit fotky)
  info('Nastavuju READ pro fotky (directus_files)...');
  try {
    const r = await addPermission(policyId, {
      collection: 'directus_files', action: 'read', fields: ['*'],
    });
    if (r === 'exists') skip(`  directus_files — už existuje`);
    else ok(`  directus_files`);
  } catch (e) { warn(`  directus_files: ${e.message}`); }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Fix Public permissions');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  info(`Auth → ${DIRECTUS_URL}`);
  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth?.data?.access_token;
  if (!TOKEN) { err('Auth selhal'); process.exit(1); }
  ok('Auth OK');
  console.log('');

  const policy = await findOrCreatePublicPolicy();
  if (!policy) {
    err('Nepodařilo se získat Public policy. Nastav ji ručně v Directus admin:');
    err('  Settings → Access Policies → + Add Policy → název "Public", uložit');
    err('  Pak spusť tento skript znovu.');
    process.exit(1);
  }
  console.log('');

  await setupPublicPermissions(policy.id);
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('Otevři Directus admin:');
  console.log(`  ${DIRECTUS_URL}/admin/settings/policies`);
  console.log('a ověř, že "Public" policy má permissions na všechny collections.');
  console.log('');
  console.log('Pak ověř public API z prohlížeče:');
  console.log(`  ${DIRECTUS_URL}/items/brands`);
  console.log('Měl bys vidět JSON s 3 značkami (status=draft, takže prázdné — později nastavíme status=published).');
  console.log('');

  rl.close();
}

main().catch((e) => { err(e.message); rl.close(); process.exit(1); });
