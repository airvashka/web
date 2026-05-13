#!/usr/bin/env node
/**
 * SFR Motor — fix foreign key schema na O2M relations.
 *
 * Problém: relations byly vytvořené bez schema, takže DB FK constraint neexistuje.
 * Admin UI při update modelu zkouší auto-fill model FK na child records ale fail.
 *
 * Tento skript:
 *   1) Pro každou relation (model_color_exterior.model, model_color_interior.model,
 *      model_highlights.model):
 *      - DELETE existing relation
 *      - POST new relation se schema (vytvoří FK na DB úrovni)
 *
 * Records v collection ZŮSTÁVAJÍ (model FK column data v DB jsou OK, jen schema chybí).
 *
 * Použití:
 *   cd web && node scripts/fix-fk-schema.mjs
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

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

async function recreateRelation(childCollection, childField, parentField) {
  console.log(`\n▸ ${childCollection}.${childField}`);

  // 1) Načti current state
  const current = await api('GET', `/relations/${childCollection}/${childField}`);
  const cur = current.data;
  info(`  current meta.one_field: ${cur.meta?.one_field}`);
  info(`  current schema: ${cur.schema ? 'set' : 'NULL (= no FK in DB)'}`);

  if (cur.schema && cur.schema.foreign_key_table === 'models') {
    ok(`  schema FK už existuje — skip`);
    return;
  }

  // 2) DELETE relation (zachová records, jen smaže metadata)
  await api('DELETE', `/relations/${childCollection}/${childField}`);
  info(`  relation smazána (records zůstávají)`);

  // 3) POST nová relation SE schema
  await api('POST', '/relations', {
    collection: childCollection,
    field: childField,
    related_collection: 'models',
    schema: {
      on_delete: 'CASCADE',
    },
    meta: {
      one_field: parentField,
      sort_field: 'sort',
      one_deselect_action: 'delete',
    },
  });
  ok(`  relation znovu vytvořena se schema FK`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Fix FK schema na O2M relations');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  await recreateRelation('model_color_exterior', 'model', 'color_exterior');
  await recreateRelation('model_color_interior', 'model', 'color_interior');
  await recreateRelation('model_highlights', 'model', 'highlights');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('Ověř po refresh:');
  console.log('  Admin Directus → Settings → Data Model → model_color_exterior → model');
  console.log('  → Schema → "Foreign Key" by mělo být nastavené na "models.id"');
  console.log('');
  console.log('Pak v adminu (Ctrl+Shift+R) zkus Save modelu Actyon.');
  console.log('Mělo by projít bez "Value can\'t be null" chyby.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
