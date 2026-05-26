#!/usr/bin/env node
/**
 * SFR Motor — přidá obrázek do promo bloku modelu.
 *
 * Dva fieldy na collection `models`:
 *   promo_image              uuid (M2O → directus_files) — obrázek pro akční banner
 *   promo_image_transparent  boolean                     — pokud true, render s
 *                                                          object-fit: contain
 *                                                          + bílé okolí (pro
 *                                                          transparentní PNG
 *                                                          nálepky), jinak cover.
 *
 * Akční banner se zobrazí pouze pokud `promo_active=true` + (promo_label nebo
 * promo_discount_amount). Pokud `promo_image` je vyplněn, na pravé straně bannera
 * se ukáže obrázek místo "SLEVA −X Kč" badge (sleva badge se použije jako fallback,
 * když image není).
 *
 * Idempotentní — můžeš spustit opakovaně, existující fieldy přeskočí.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-model-promo-image.mjs
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
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}
const ok = (m) => console.log(`  [ok]  ${m}`);
const info = (m) => console.log(`  [i]   ${m}`);

async function fieldExists(col, field) {
  try { await api('GET', `/fields/${col}/${field}`); return true; } catch { return false; }
}

async function main() {
  console.log('\n=== Add models.promo_image + promo_image_transparent ===\n');

  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) promo_image — M2O na directus_files
  if (await fieldExists('models', 'promo_image')) {
    info('models.promo_image uz existuje - preskakuji.');
  } else {
    await api('POST', '/fields/models', {
      field: 'promo_image',
      type: 'uuid',
      schema: { is_nullable: true },
      meta: {
        interface: 'file-image',
        special: ['file'],
        width: 'half',
        sort: 432,
        note: 'Obrazek pro akcni banner (zobrazi se vpravo, kde je jinak SLEVA -X Kc badge). Doporuceny pomer 4:3, velikost min 800x600. Funguje s libovolne velkym zdrojem - Directus transformuje na pozadovanou sirku.',
      },
    });
    await api('POST', '/relations', {
      collection: 'models',
      field: 'promo_image',
      related_collection: 'directus_files',
      schema: { on_delete: 'SET NULL' },
    });
    ok('models.promo_image pridan (M2O -> directus_files)');
  }

  // 2) promo_image_transparent — boolean toggle
  if (await fieldExists('models', 'promo_image_transparent')) {
    info('models.promo_image_transparent uz existuje - preskakuji.');
  } else {
    await api('POST', '/fields/models', {
      field: 'promo_image_transparent',
      type: 'boolean',
      schema: { is_nullable: true, default_value: false },
      meta: {
        interface: 'boolean',
        special: ['cast-boolean'],
        width: 'half',
        sort: 434,
        note: 'Zaskrtni, kdyz je promo_image transparentni PNG (nalepka, logo akce). Pak se v banneru pouzije object-fit: contain + 10px bile okoli. Kdyz necheckle, pouzije se cover (fotka vyplni cely ramecek).',
        options: { label: 'Promo image je transparentni PNG' },
      },
    });
    ok('models.promo_image_transparent pridan (boolean)');
  }

  console.log('\n=== Hotovo. V adminu (Ctrl+Shift+R): ===');
  console.log('  Models -> libovolny model -> sekce "Akcni nabidka":');
  console.log('    - promo_active (zaskrtnout)');
  console.log('    - promo_label (napr. "JARNI AKCE")');
  console.log('    - promo_image (nahraj obrazek 4:3, min 800x600)');
  console.log('    - promo_image_transparent (jen kdyz je to PNG nalepka)');
  console.log('  Pak rebuild/deploy -> obrazek se ukaze v akcnim banneru.\n');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
