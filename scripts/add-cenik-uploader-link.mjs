#!/usr/bin/env node
/**
 * SFR Motor — přidá info-banner s linkem na ceník uploader nahoru do model_years editoru.
 *
 * Co skript dělá:
 *   Vytvoří/aktualizuje field `_cenik_uploader_link` na collection `model_years`.
 *   Je to presentation-notice (alias, no-data) — žádný DB sloupec, jen vizuální banner.
 *
 *   V adminu pak když otevřeš jakýkoli model_year, nahoře uvidíš modrý banner:
 *     📄 Pro upload PDF ceníku (AI extrakce trim levels + paketů + tech data)
 *        → otevřít Ceník uploader [link]
 *
 * Idempotentní — pokud field existuje, updatne content.
 *
 * Použití:
 *   cd web && node scripts/add-cenik-uploader-link.mjs
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

const FIELD_NAME = '_cenik_uploader_link';
// Template literal s reálnými newlines + HTML anchor s target="_blank" (otevře v novém tab/okně)
const NOTICE_TEXT = `📄 **Hromadný upload ceníku z PDF**

Potřebuješ nahrát nové trim levels, pakety nebo technická data? Použij AI Ceník uploader — drag & drop PDF, AI extrahuje strukturu, ty zreviewuješ a uložíš.

→ <a href="https://sfr-motor-test.vercel.app/admin/cenik" target="_blank" rel="noopener">Otevřít Ceník uploader v novém okně ↗</a>`;

async function fieldExists() {
  try {
    await api('GET', `/fields/model_years/${FIELD_NAME}`);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add Ceník uploader link → model_years editor');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  const exists = await fieldExists();

  const fieldConfig = {
    field: FIELD_NAME,
    type: 'alias',
    schema: null,
    meta: {
      interface: 'presentation-notice',
      special: ['alias', 'no-data'],
      width: 'full',
      sort: 1, // nahoru
      options: {
        icon: 'upload_file',
        color: 'primary',
        text: NOTICE_TEXT,
      },
    },
  };

  if (exists) {
    info(`Field model_years.${FIELD_NAME} existuje — updatuji content`);
    await api('PATCH', `/fields/model_years/${FIELD_NAME}`, fieldConfig);
    ok('Banner content updated');
  } else {
    info(`Vytvářím nový field model_years.${FIELD_NAME}`);
    await api('POST', '/fields/model_years', fieldConfig);
    ok('Banner field vytvořen');
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Modelové roky → otevři libovolný rok:');
  console.log('    Nahoře uvidíš modrý banner s linkem na Ceník uploader.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
