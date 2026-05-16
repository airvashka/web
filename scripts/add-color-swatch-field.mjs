#!/usr/bin/env node
/**
 * SFR Motor — přidá `swatch` M2O file field do model_color_exterior.
 *
 * Slouží jako malá ikona pro kruhový selector pod hlavní fotkou auta
 * v Barvy sekci na /model/[slug] (KGM-style configurator look).
 *
 * Schema bude:
 *   - photo (existing) — velká fotka auta v dané barvě (full bleed)
 *   - swatch (new)     — malá ikona/swatch (40-60px) pro kolečko pod fotkou
 *   - hex (existing)   — fallback CSS barva, pokud swatch chybí
 *   - name (existing)  — popisek pod selectorem
 *
 * Idempotentní.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-color-swatch-field.mjs
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

async function fieldExists(col, field) {
  try { await api('GET', `/fields/${col}/${field}`); return true; } catch { return false; }
}
async function relationExists(col, field) {
  try {
    const r = await api('GET', `/relations/${col}/${field}`);
    return !!r;
  } catch { return false; }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add model_color_exterior.swatch (M2O file)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('model_color_exterior', 'swatch')) {
    info('model_color_exterior.swatch už existuje.');
  } else {
    await api('POST', '/fields/model_color_exterior', {
      field: 'swatch',
      type: 'uuid',
      schema: { is_nullable: true },
      meta: {
        interface: 'file-image',
        special: ['file'],
        width: 'half',
        sort: 7,
        note: 'Malá ikona / swatch (cca 60×60px, transparentní pozadí) — zobrazí se jako kruhový selector pod hlavní fotkou auta. Pokud chybí, použije se hex barva.',
      },
    });
    ok('model_color_exterior.swatch field přidán');
  }

  if (await relationExists('model_color_exterior', 'swatch')) {
    info('relation model_color_exterior.swatch → directus_files už existuje.');
  } else {
    await api('POST', '/relations', {
      collection: 'model_color_exterior',
      field: 'swatch',
      related_collection: 'directus_files',
      schema: { on_delete: 'SET NULL' },
    });
    ok('Relation swatch → directus_files');
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Models → Torres → Color exterior → uvidíš nové pole Swatch');
  console.log('    Nahraj malé PNG/SVG ikony barvy (cca 60×60px).');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
