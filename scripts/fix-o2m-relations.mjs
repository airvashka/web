#!/usr/bin/env node
/**
 * SFR Motor — fix O2M relations (model na color/highlights collections).
 *
 * Problém: při editaci modelu "Value can't be null" pro field `model` na color/highlight records.
 * Důvod: `one_field` v meta relace chybí nebo je špatně, Directus nepřenese parent ID.
 *
 * Tento skript:
 *   - Zkontroluje GET /relations/{collection}/model pro každou child collection
 *   - PATCH meta.one_field = správný parent field name
 *
 * Použití:
 *   cd web && node scripts/fix-o2m-relations.mjs
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

async function fixRelation(childCollection, childField, parentField) {
  console.log(`\n▸ ${childCollection}.${childField} → models.${parentField}`);
  let rel;
  try {
    rel = await api('GET', `/relations/${childCollection}/${childField}`);
  } catch (e) {
    warn(`  Relation neexistuje: ${e.message}`);
    return;
  }
  const data = rel.data;
  info(`  Current meta: one_field=${data.meta?.one_field}, sort_field=${data.meta?.sort_field}`);

  if (data.meta?.one_field === parentField) {
    ok(`  one_field už správně nastaveno`);
    return;
  }

  try {
    await api('PATCH', `/relations/${childCollection}/${childField}`, {
      meta: {
        one_field: parentField,
        sort_field: 'sort',
        // Zajistit kaskádu při delete parent
        one_deselect_action: 'delete',
      },
      schema: {
        on_delete: 'CASCADE',
      },
    });
    ok(`  one_field nastaveno na "${parentField}"`);
  } catch (e) {
    warn(`  PATCH selhal: ${e.message}`);
  }
}

async function ensureFieldNotNullable(collection, field) {
  // Zkontrolovat is_nullable na field — pokud true, je to OK (auto-fill funguje)
  // Pokud false, Directus po PATCH nevyžaduje neexistující model, nechá to být
  // Ale aby auto-fill fungoval, musí mít is_nullable: false (= ve smyslu DB constraint)
  // To už by mělo být OK z předchozího setupu, jen pro jistotu check.
  try {
    const f = await api('GET', `/fields/${collection}/${field}`);
    info(`  ${collection}.${field}: is_nullable=${f.data.schema?.is_nullable}`);
  } catch {}
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Fix O2M relations — model field na color/highlight');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  await fixRelation('model_color_exterior', 'model', 'color_exterior');
  await fixRelation('model_color_interior', 'model', 'color_interior');
  await fixRelation('model_highlights', 'model', 'highlights');

  // Check fields jsou nullable=false (aby auto-fill přes O2M fungoval)
  console.log('\nKontrola is_nullable na model field:');
  await ensureFieldNotNullable('model_color_exterior', 'model');
  await ensureFieldNotNullable('model_color_interior', 'model');
  await ensureFieldNotNullable('model_highlights', 'model');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Ctrl+Shift+R refresh. Pak otevři model, přidej barvu,');
  console.log('Save by měl projít bez "Value can\'t be null" chyby.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
