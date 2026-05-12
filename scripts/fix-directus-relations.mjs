#!/usr/bin/env node
/**
 * SFR Motor — Fix script pro rozbité M2O relations po prvním setupu.
 *
 * Problém: setup-directus.mjs deklaroval M2O fieldy jako UUID, ale
 * Directus 11 default vytváří `id` kolony jako integer auto-increment.
 * Type mismatch → FK constraint selhal.
 *
 * Tento skript:
 *  1. Naloguje se
 *  2. Detekuje skutečný typ ID
 *  3. Smaže rozbité M2O fieldy
 *  4. Vytvoří je znovu s integer typem + správným M2O meta
 *  5. Vytvoří FK relations
 *  6. Nastaví Public permissions (read pro veřejné collections + create pro leads)
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
    const err = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const ok   = (m) => console.log(`✅  ${m}`);
const skip = (m) => console.log(`⏭️   ${m}`);
const warn = (m) => console.log(`⚠️   ${m}`);
const err  = (m) => console.log(`❌  ${m}`);
const info = (m) => console.log(`ℹ️   ${m}`);

// All M2O relations that need fixing (from screenshot of failures)
const RELATIONS = [
  { from: 'sub_brands',     field: 'brand',          to: 'brands',         onDelete: 'CASCADE',  nullable: false, required: true,  template: '{{name}}',                            note: '' },
  { from: 'employees',      field: 'branch',         to: 'branches',       onDelete: 'SET NULL', nullable: true,  required: false, template: '{{name}}',                            note: '' },
  { from: 'models',         field: 'brand',          to: 'brands',         onDelete: 'NO ACTION',nullable: false, required: true,  template: '{{name}}',                            note: '' },
  { from: 'models',         field: 'sub_brand',      to: 'sub_brands',     onDelete: 'SET NULL', nullable: true,  required: false, template: '{{name}}',                            note: 'Volitelné — jen OMODA / JAECOO' },
  { from: 'model_years',    field: 'model',          to: 'models',         onDelete: 'CASCADE',  nullable: false, required: true,  template: '{{name}}',                            note: '' },
  { from: 'trim_levels',    field: 'model_year',    to: 'model_years',    onDelete: 'CASCADE',  nullable: false, required: true,  template: '{{model.name}} {{year}}',             note: '' },
  { from: 'option_packages',field: 'model_year',    to: 'model_years',    onDelete: 'CASCADE',  nullable: false, required: true,  template: '{{model.name}} {{year}}',             note: '' },
  { from: 'stock_vehicles', field: 'brand',          to: 'brands',         onDelete: 'NO ACTION',nullable: false, required: true,  template: '{{name}}',                            note: '' },
  { from: 'stock_vehicles', field: 'model',          to: 'models',         onDelete: 'NO ACTION',nullable: false, required: true,  template: '{{name}}',                            note: '' },
  { from: 'stock_vehicles', field: 'model_year',    to: 'model_years',    onDelete: 'SET NULL', nullable: true,  required: false, template: '{{year}}',                            note: '' },
  { from: 'stock_vehicles', field: 'trim_level',    to: 'trim_levels',    onDelete: 'SET NULL', nullable: true,  required: false, template: '{{name}}',                            note: '' },
  { from: 'stock_vehicles', field: 'branch',         to: 'branches',       onDelete: 'SET NULL', nullable: true,  required: false, template: '{{name}}',                            note: '' },
  { from: 'leads',          field: 'source_model',  to: 'models',         onDelete: 'SET NULL', nullable: true,  required: false, template: '{{name}}',                            note: '' },
  { from: 'leads',          field: 'source_vehicle',to: 'stock_vehicles', onDelete: 'SET NULL', nullable: true,  required: false, template: '{{model.name}} — {{vin}}',            note: '' },
  { from: 'leads',          field: 'assignee',      to: 'employees',      onDelete: 'SET NULL', nullable: true,  required: false, template: '{{full_name}}',                       note: 'Komu přidělit' },
];

async function detectIdType() {
  // Try fetching a brand row — if id is "1", it's integer; if it's "550e8400-..." it's uuid
  try {
    const res = await api('GET', '/items/brands?limit=1');
    const id = res?.data?.[0]?.id;
    if (id === undefined) {
      // No data — query field schema directly
      const idField = await api('GET', '/fields/brands/id');
      return idField?.data?.type ?? 'integer';
    }
    if (typeof id === 'string' && id.length > 20) return 'uuid';
    return 'integer';
  } catch (e) {
    warn(`Nepodařilo se detekovat ID typ (${e.message}), defaultně integer`);
    return 'integer';
  }
}

async function ensureFieldDeleted(coll, field) {
  try {
    await api('DELETE', `/fields/${coll}/${field}`);
    skip(`  smazán starý field ${coll}.${field}`);
  } catch (e) {
    // 404 = field already doesn't exist, OK
    if (e.status !== 404 && e.status !== 403) {
      warn(`  delete ${coll}.${field}: ${e.message}`);
    }
  }
}

async function fixRelation(rel, idType) {
  const tag = `${rel.from}.${rel.field} → ${rel.to}`;

  // 1) Delete any existing broken field
  await ensureFieldDeleted(rel.from, rel.field);

  // 2) Create field with correct type + M2O meta
  try {
    await api('POST', `/fields/${rel.from}`, {
      field: rel.field,
      type: idType,
      meta: {
        interface: 'select-dropdown-m2o',
        special: ['m2o'],
        required: rel.required,
        width: 'half',
        options: { template: rel.template },
        ...(rel.note ? { note: rel.note } : {}),
      },
      schema: { is_nullable: rel.nullable },
    });
    ok(`  field ${rel.from}.${rel.field} (${idType})`);
  } catch (e) {
    err(`  field ${rel.from}.${rel.field}: ${e.message}`);
    return;
  }

  // 3) Create relation
  try {
    await api('POST', '/relations', {
      collection: rel.from,
      field: rel.field,
      related_collection: rel.to,
      schema: { on_delete: rel.onDelete },
    });
    ok(`  relation ${tag} (on delete: ${rel.onDelete})`);
  } catch (e) {
    err(`  relation ${tag}: ${e.message}`);
  }
}

async function setPermissions() {
  info('Nastavuju Public role permissions...');

  // Get all roles, find one with admin_access=false and app_access=false (= Public)
  let roles;
  try {
    roles = await api('GET', '/roles?limit=100');
  } catch (e) {
    err(`Nelze načíst roles: ${e.message}`);
    return;
  }

  // In Directus 11, "Public" role is usually identified by being the one without admin_access
  // Sometimes it's also just named "Public" or is the default role.
  // We use `directus_users` filter or look for a role with no special access
  let publicRole = roles?.data?.find(r =>
    (r.name === 'Public' || r.name === '$t:public_label') &&
    !r.admin_access && !r.app_access
  );

  // Fallback: any role without admin/app access
  if (!publicRole) {
    publicRole = roles?.data?.find(r => !r.admin_access && !r.app_access);
  }

  // Even older fallback: the Public role in Directus has a fixed UUID or is implicit
  if (!publicRole) {
    warn('Public role nenalezen v /roles. Možná nemá ID (Directus 11+ změna).');
    warn('Permissions můžeš nastavit ručně: Settings → Access Policies → Public.');
    return;
  }

  info(`Public role nalezen: ${publicRole.name} (${publicRole.id})`);

  const PUBLIC_READ = ['brands', 'sub_brands', 'models', 'model_years', 'trim_levels', 'option_packages', 'stock_vehicles', 'branches', 'employees'];

  for (const coll of PUBLIC_READ) {
    try {
      await api('POST', '/permissions', {
        role: publicRole.id,
        collection: coll,
        action: 'read',
        fields: ['*'],
        permissions: { _and: [{ status: { _eq: 'published' } }] },
      });
      ok(`  ${coll} — public READ (jen status=published)`);
    } catch (e) {
      if (e.status === 400 && (e.message.includes('exists') || e.message.includes('unique'))) {
        skip(`  ${coll} — permission už existuje`);
      } else {
        warn(`  ${coll}: ${e.message}`);
      }
    }
  }

  // Branches and employees don't have status field, special case (read all)
  for (const coll of ['branches', 'employees']) {
    try {
      await api('POST', '/permissions', {
        role: publicRole.id,
        collection: coll,
        action: 'read',
        fields: ['*'],
        // no status filter
      });
    } catch { /* expected if already set */ }
  }

  // Public CREATE for leads
  try {
    await api('POST', '/permissions', {
      role: publicRole.id,
      collection: 'leads',
      action: 'create',
      fields: ['form_type', 'customer_name', 'customer_email', 'customer_phone', 'message', 'source_model', 'source_vehicle', 'source_page', 'utm_source', 'utm_medium', 'utm_campaign'],
    });
    ok(`  leads — public CREATE`);
  } catch (e) {
    if (e.status === 400) skip(`  leads — create permission už existuje`);
    else warn(`  leads CREATE: ${e.message}`);
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Fix Directus relations');
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

  info('Detekuji ID typ collections...');
  const idType = await detectIdType();
  ok(`ID typ: ${idType}`);
  console.log('');

  info('Opravuji M2O relations...');
  for (const rel of RELATIONS) {
    await fixRelation(rel, idType);
  }
  console.log('');

  await setPermissions();
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! ✅');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`Otevři ${DIRECTUS_URL} → měl bys vidět:`);
  console.log('  • Všechny M2O vztahy fungují (klikni Models → Add new → field "Brand" má dropdown)');
  console.log('  • V Settings → Access Policies → Public má permissions na čtení');
  console.log('');

  rl.close();
}

main().catch((e) => { err(e.message); rl.close(); process.exit(1); });
