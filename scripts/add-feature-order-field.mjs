/**
 * SFR Motor — přidá `feature_order` JSON pole do model_years.
 *
 * Co skript dělá:
 *   Vytvoří field model_years.feature_order typu json.
 *   Struktura: ["Název prvku 1", "Název prvku 2", ...]
 *
 *   Je to explicitní GLOBÁLNÍ pořadí řádků (názvů prvků) výbavové matice
 *   pro daný modelový rok. Umožňuje volně řadit řádky i přes hranici stupňů
 *   (prvek "v ceně" jen u vyšších stupňů lze posunout nahoru nad prvek z nižších).
 *
 *   Matice (admin i web) řadí řádky uvnitř sekce podle indexu v tomto poli;
 *
 * Idempotentní — pokud field existuje, jen info, nic nemění.
 *
 * Použití:
 *   cd web && node scripts/add-feature-order-field.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
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
  try { await api('GET', `/fields/model_years/${field}`); return true; } catch { return false; }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add model_years.feature_order (JSON)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('feature_order')) {
    info('Field model_years.feature_order už existuje. Nic neměním.');
    rl.close();
    return;
  }

  await api('POST', '/fields/model_years', {
    field: 'feature_order',
    type: 'json',
    schema: { is_nullable: true, default_value: null },
    meta: {
      interface: 'tags',
      width: 'full',
      sort: 60,
      special: ['cast-json'],
      note: 'Explicitní pořadí řádků (názvů prvků) výbavové matice. Spravuje se šipkami v /admin/cenik. Prvky mimo seznam zůstanou v původním pořadí.',
      options: { placeholder: 'Spravuje se v ceníkovém editoru…' },
    },
  });
  ok('Field model_years.feature_order přidán');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V /admin/cenik teď půjde volně řadit řádky šipkami.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
