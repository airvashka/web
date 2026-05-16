#!/usr/bin/env node
/**
 * SFR Motor — přidá `pricelist_colors` JSON pole do model_years.
 *
 * Drží barvy přesně dle ceníku — name, code, type/material, pricing_per_trim.
 * Zobrazuje se v tabulce na /model/[slug]/vybavy pod komplet maticí výbav.
 *
 * Pozor: tohle je ČISTĚ pro tabulkové zobrazení cen barev z PDF ceníku.
 *   Showroom barvy s fotkami zůstávají v `model_color_exterior` + `_interior`
 *   (manually-curated, per-model).
 *
 * Struktura:
 * {
 *   exterior: [
 *     { name, code, type, pricing_per_trim: { trim_slug: price } }
 *   ],
 *   interior: [
 *     { name, code, material, pricing_per_trim }
 *   ]
 * }
 *
 * Idempotentní.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-pricelist-colors-field.mjs
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

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add model_years.pricelist_colors (JSON)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('model_years', 'pricelist_colors')) {
    info('model_years.pricelist_colors už existuje. Nic neměním.');
    rl.close();
    return;
  }

  await api('POST', '/fields/model_years', {
    field: 'pricelist_colors',
    type: 'json',
    schema: { is_nullable: true, default_value: null },
    meta: {
      interface: 'input-code',
      width: 'full',
      sort: 60,
      special: ['cast-json'],
      note: 'Barvy přesně dle ceníku — tabulkový výpis na /model/[slug]/vybavy. Struktura: { exterior: [{name,code,type,pricing_per_trim}], interior: [...] }. Generuje se z ceník uploaderu.',
      options: { language: 'JSON', lineNumber: true },
    },
  });
  ok('model_years.pricelist_colors přidán');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Model Years → Torres 2026 → Pricelist colors (JSON editor)');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
