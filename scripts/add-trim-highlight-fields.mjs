#!/usr/bin/env node
/**
 * SFR Motor — přidá `is_highlighted` + `highlight_label` do trim_levels.
 *
 *   - is_highlighted (boolean) → zapne badge na trim kartě (klient sám určí,
 *     která výbava je "doporučovaná").
 *   - highlight_label (string)  → text badge (např. "Doporučujeme", "Nejprodávanější",
 *     "Akce", "Nejlepší volba"). Default "Doporučujeme" pokud prázdné.
 *
 * Dříve byl badge automaticky na posledním (nejdražším) trimu. Teď to klient
 * ovládá ručně.
 *
 * Idempotentní.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-trim-highlight-fields.mjs
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
  console.log('  Add trim_levels.is_highlighted + highlight_label');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (!(await fieldExists('trim_levels', 'is_highlighted'))) {
    await api('POST', '/fields/trim_levels', {
      field: 'is_highlighted',
      type: 'boolean',
      schema: { is_nullable: true, default_value: false },
      meta: {
        interface: 'boolean',
        special: ['cast-boolean'],
        width: 'half',
        sort: 14,
        note: 'Zapne zvýrazněnou trim kartu na model detailu (tmavé pozadí + badge). Doporučeno mít zapnuté max na 1 trimu per model.',
        options: { label: 'Zvýraznit jako doporučenou výbavu' },
      },
    });
    ok('trim_levels.is_highlighted přidán');
  } else {
    info('trim_levels.is_highlighted už existuje');
  }

  if (!(await fieldExists('trim_levels', 'highlight_label'))) {
    await api('POST', '/fields/trim_levels', {
      field: 'highlight_label',
      type: 'string',
      schema: { is_nullable: true },
      meta: {
        interface: 'input',
        width: 'half',
        sort: 15,
        note: 'Text badge na zvýrazněné kartě (např. "Doporučujeme", "Nejprodávanější", "Akce", "Nejlepší volba"). Pokud prázdné, použije se "Doporučujeme".',
        options: { placeholder: 'Doporučujeme' },
      },
    });
    ok('trim_levels.highlight_label přidán');
  } else {
    info('trim_levels.highlight_label už existuje');
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Trim Levels → otevři libovolný trim → uvidíš:');
  console.log('      ✅ Zvýraznit jako doporučenou výbavu (toggle)');
  console.log('      📝 Highlight Label (text badge)');
  console.log('  Klikneš checkbox + napíšeš text → po deployi se zobrazí na frontendu.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
