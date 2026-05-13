#!/usr/bin/env node
/**
 * SFR Motor — trim_levels.featured_on_model_page boolean.
 *
 * Default true. Můžeš odškrtnout trim, který nechceš na model stránce
 * (např. limitka co se zobrazuje jen ve skladovce, nebo zastaralý trim).
 *
 * Model stránka pak ukáže jen featured trimy. Srovnávací podstránka
 * /model/[slug]/vybavy ukáže VŠECHNY trimy modelu (i odškrtnuté), aby měl
 * zákazník kompletní přehled.
 *
 * Použití:
 *   cd web && node scripts/add-trim-featured-flag.mjs
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

async function fieldExists(field) {
  try { await api('GET', `/fields/trim_levels/${field}`); return true; } catch { return false; }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  trim_levels.featured_on_model_page');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('featured_on_model_page')) {
    info('featured_on_model_page už existuje');
  } else {
    await api('POST', '/fields/trim_levels', {
      field: 'featured_on_model_page',
      type: 'boolean',
      schema: { is_nullable: true, default_value: true },
      meta: {
        interface: 'boolean',
        special: ['cast-boolean'],
        width: 'half',
        sort: 50,
        note: 'Zobrazit tento trim na model stránce (jako teaser karta). Odškrtni, pokud chceš trim skrýt z přehledu (např. limitka). Srovnávací tabulka /model/[slug]/vybavy ho ukáže tak jako tak.',
        options: { label: 'Zobrazit jako teaser na model stránce' },
      },
    });
    ok('featured_on_model_page field vytvořen (default = true)');
  }

  // Set default true na všechny existující trimy (kde je null)
  const trims = await api('GET', '/items/trim_levels?limit=200&fields=id,name,featured_on_model_page');
  let updated = 0;
  for (const t of trims.data) {
    if (t.featured_on_model_page === null || t.featured_on_model_page === undefined) {
      await api('PATCH', `/items/trim_levels/${t.id}`, { featured_on_model_page: true });
      updated++;
    }
  }
  if (updated > 0) ok(`Nastaveno featured=true na ${updated} existujících trimech`);
  else info('Všechny trimy už mají featured nastaveno');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Admin → trim_levels → libovolný trim →');
  console.log('  "Zobrazit jako teaser na model stránce" checkbox.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
