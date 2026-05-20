#!/usr/bin/env node
/**
 * SFR Motor — pridá tile_eyebrow + tile_description do `brands`.
 *
 * Pouzivaji se v sekci "Dalsi znacky u SFR Motor" (boxy "Tri znacky pod jednou
 * strechou") na brand strankach. Frontend cte z techto poli, fallback je stara
 * STRIP mapa v kodu / tagline.
 *
 * Idempotentni — pole nevytvari znovu, seed neprepisuje uz vyplnene hodnoty.
 *
 * Pouziti:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-brand-tile-fields.mjs
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

const SEED = {
  kgm: { tile_eyebrow: 'Korejské SUV', tile_description: '9 modelů. Spolehlivé pohony 4×4 a štědrá záruka.' },
  'omoda-jaecoo': { tile_eyebrow: 'Nová generace', tile_description: 'Odvážný design a velkorysá výbava v základu.' },
  farizon: { tile_eyebrow: 'Užitkové elektro', tile_description: 'Geely Group. SuperVan pro každodenní práci.' },
};

async function main() {
  console.log('\n=== Add brands.tile_eyebrow + tile_description ===\n');
  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('brands', 'tile_eyebrow')) info('brands.tile_eyebrow uz existuje.');
  else {
    await api('POST', '/fields/brands', {
      field: 'tile_eyebrow', type: 'string', schema: { is_nullable: true, max_length: 60 },
      meta: { interface: 'input', width: 'half', sort: 60,
        note: 'Stitek v boxu "Dalsi znacky" na brand strankach. Napr. "Korejske SUV".',
        options: { placeholder: 'Korejske SUV' } },
    });
    ok('brands.tile_eyebrow pridan');
  }

  if (await fieldExists('brands', 'tile_description')) info('brands.tile_description uz existuje.');
  else {
    await api('POST', '/fields/brands', {
      field: 'tile_description', type: 'text', schema: { is_nullable: true },
      meta: { interface: 'input-multiline', width: 'full', sort: 61,
        note: 'Kratky popis v boxu "Dalsi znacky" na brand strankach.',
        options: { placeholder: '9 modelu. Spolehlive pohony 4x4...' } },
    });
    ok('brands.tile_description pridan');
  }

  console.log('');
  // Seed — jen pokud je pole prazdne
  const brands = await api('GET', '/items/brands?fields=id,slug,tile_eyebrow,tile_description&limit=-1');
  for (const b of (brands.data ?? [])) {
    const s = SEED[b.slug];
    if (!s) continue;
    const patch = {};
    if (!b.tile_eyebrow) patch.tile_eyebrow = s.tile_eyebrow;
    if (!b.tile_description) patch.tile_description = s.tile_description;
    if (Object.keys(patch).length === 0) { info(`${b.slug} uz vyplneno - nechavam.`); continue; }
    await api('PATCH', `/items/brands/${b.id}`, patch);
    ok(`${b.slug} seed: ${JSON.stringify(patch)}`);
  }

  console.log('\n=== Hotovo. Edituj v adminu: /admin/content/brands -> pole Tile eyebrow / Tile description ===\n');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
