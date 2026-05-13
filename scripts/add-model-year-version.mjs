#!/usr/bin/env node
/**
 * SFR Motor — přidat model_years.version field.
 *
 * Volitelný string field na rozlišení vícero ceníků v jednom roce.
 * Příklady: "H1", "H2", "v2", "2026-03" (datum platnosti)
 *
 * Současně aktualizuje display_template aby version byla vidět v adminu:
 *   model_years:    "{{model.name}} {{year}} {{version}}"
 *   trim_levels:    "{{model_year.model.name}} {{model_year.year}} {{model_year.version}} — {{name}}"
 *   option_packages: dtto
 *
 * Použití:
 *   cd web && node scripts/add-model-year-version.mjs
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

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

async function ensureVersionField() {
  if (await fieldExists('model_years', 'version')) {
    info('model_years.version už existuje');
    return;
  }
  await api('POST', '/fields/model_years', {
    field: 'version',
    type: 'string',
    schema: { is_nullable: true, max_length: 50 },
    meta: {
      interface: 'input',
      width: 'half',
      note: 'Volitelně. Verze ceníku v rámci roku — např. "H1", "H2", "v2", "2026-03". Užitečné když má jeden rok více ceníků.',
      sort: 22, // hned za year
      options: { placeholder: 'např. H1, H2, v2' },
    },
  });
  ok('model_years.version field vytvořen');
}

async function patchDisplayTemplate(collection, newTemplate) {
  const cur = await api('GET', `/collections/${collection}`);
  const current = cur.data?.meta?.display_template;
  if (current === newTemplate) {
    info(`${collection} display_template už správný`);
    return;
  }
  await api('PATCH', `/collections/${collection}`, {
    meta: { display_template: newTemplate },
  });
  ok(`${collection} display_template → "${newTemplate}"`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Přidat model_years.version field');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Krok 1: Vytvořit field');
  await ensureVersionField();

  console.log('\nKrok 2: Update display_template (aby version byla vidět v adminu)');
  await patchDisplayTemplate('model_years', '{{model.name}} {{year}} {{version}}');
  await patchDisplayTemplate('trim_levels', '{{model_year.model.name}} {{model_year.year}} {{model_year.version}} — {{name}}');
  await patchDisplayTemplate('option_packages', '{{model_year.model.name}} {{model_year.year}} {{model_year.version}} — {{name}}');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('  model_years → libovolný rok → "Version" field (volitelný)');
  console.log('  Když ho vyplníš, projeví se v display_template napříč adminem.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
