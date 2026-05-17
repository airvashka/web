#!/usr/bin/env node
/**
 * SFR Motor — opravuje typ pole `price` uvnitř pricing_per_trim z integer na string.
 *
 * Důvod: integer nepřijme "-", "standard", "unavailable". Změnou na string admin
 * povolí všechny tři varianty:
 *   - číslo (např. 14900)        → orange "14 900 Kč"
 *   - "standard" nebo "0"        → green "V ceně"
 *   - "-", "unavailable", prázdné → gray "—"
 *
 * Aktualizuje meta obou polí:
 *   - model_years.pricelist_colors_exterior
 *   - model_years.pricelist_colors_interior
 *
 * Idempotentní.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/fix-pricelist-colors-price-field.mjs
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

// Nová definice pricing_per_trim subfield — price je STRING
const PRICING_REPEATER = {
  field: 'pricing_per_trim',
  name: 'Ceny per trim',
  type: 'json',
  meta: {
    interface: 'list',
    special: ['cast-json'],
    width: 'full',
    note: 'Pro každý trim přidej řádek. Cena: zadej číslo Kč (např. 14900), nebo "standard" pokud je barva v ceně, nebo "-" pokud je pro daný trim nedostupná.',
    options: {
      template: '{{trim_slug}} — {{price}}',
      fields: [
        { field: 'trim_slug', name: 'Trim slug', type: 'string', meta: { interface: 'input', width: 'half', required: true, options: { placeholder: 'club, style, premium, select, exclusive...' } } },
        { field: 'price',     name: 'Cena',      type: 'string', meta: { interface: 'input', width: 'half', required: true, options: { placeholder: '14900 / standard / -' } } },
      ],
    },
  },
};

async function patchFieldOptions(collection, field, getMeta) {
  // Načti aktuální meta
  const cur = await api('GET', `/fields/${collection}/${field}`);
  const newMeta = { ...(cur.meta ?? {}), options: { ...(cur.meta?.options ?? {}), fields: cur.meta?.options?.fields ?? [] } };

  // Najdi a nahraď pricing_per_trim subfield
  newMeta.options.fields = newMeta.options.fields.map((f) => {
    if (f.field === 'pricing_per_trim') return PRICING_REPEATER;
    return f;
  });

  await api('PATCH', `/fields/${collection}/${field}`, { meta: newMeta });
  ok(`${collection}.${field} → pricing_per_trim subfield aktualizován (price = string)`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Fix: pricing_per_trim.price → string');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  await patchFieldOptions('model_years', 'pricelist_colors_exterior');
  await patchFieldOptions('model_years', 'pricelist_colors_interior');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V Directus admin (Ctrl+Shift+R):');
  console.log('    Model Years → libovolný ročník → Pricelist Colors Exterior');
  console.log('    Klik na barvu → Ceny per trim → Klik na položku →');
  console.log('      Cena teď přijme: "14900", "standard", "-"');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
