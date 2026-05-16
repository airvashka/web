#!/usr/bin/env node
/**
 * SFR Motor — přidá `eyebrow` text field do model_highlights.
 *
 * KGM-style tech-card design má 3 textové úrovně:
 *   - eyebrow (např. "Drive economically" / "Eco-friendly drive") — small uppercase nad titulkem
 *   - title (např. "Idle Stop & Go system") — bold heading
 *   - subtitle (popisek/description odstavec)
 *
 * V Directus model_highlights teď doplníme `eyebrow`. Volitelné — pokud prázdné,
 * frontend nic neukáže.
 *
 * Idempotentní.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-highlight-eyebrow.mjs
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
  console.log('  Add model_highlights.eyebrow (string)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('model_highlights', 'eyebrow')) {
    info('model_highlights.eyebrow už existuje.');
    rl.close();
    return;
  }

  await api('POST', '/fields/model_highlights', {
    field: 'eyebrow',
    type: 'string',
    schema: { is_nullable: true },
    meta: {
      interface: 'input',
      width: 'full',
      sort: 8,
      note: 'Malý uppercase text nad titulkem (např. "Drive economically", "Eco-friendly drive", "V základní ceně"). Volitelné — pokud prázdné, frontend nic neukáže.',
      options: { placeholder: 'např. Drive economically, V základní ceně, Eco-friendly drive' },
    },
  });
  ok('model_highlights.eyebrow přidán');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Models → libovolný model → Highlights → uvidíš nové pole Eyebrow');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
