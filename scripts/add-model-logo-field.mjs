#!/usr/bin/env node
/**
 * SFR Motor — přidá `logo` field do models (M2O → directus_files).
 *
 * Logo (wordmark) modelu, které se v hero na /model/{slug} zobrazí MÍSTO
 * textového názvu. Když není nastaveno, hero ukáže text jako dosud.
 * Doporučeno: PNG/SVG s průhledným pozadím, světlá varianta (hero je tmavý).
 *
 * Idempotentní.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-model-logo-field.mjs
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
  console.log('\n=== Add models.logo (M2O -> directus_files) ===\n');

  URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim()
    || 'https://sfr-motor-directus.onrender.com';
  const email = (await prompt('Admin email: ')).trim();
  const password = (await prompt('Admin heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  if (await fieldExists('models', 'logo')) {
    info('models.logo uz existuje - nic nedelam.');
  } else {
    await api('POST', '/fields/models', {
      field: 'logo',
      type: 'uuid',
      schema: { is_nullable: true },
      meta: {
        interface: 'file-image',
        special: ['file'],
        width: 'half',
        sort: 14,
        note: 'Logo / wordmark modelu. Zobrazi se v hero na /model/{slug} MISTO textoveho nazvu. Doporuceno PNG/SVG s pruhlednym pozadim, svetla varianta (hero je tmavy). Kdyz prazdne, ukaze se text.',
      },
    });
    await api('POST', '/relations', {
      collection: 'models',
      field: 'logo',
      related_collection: 'directus_files',
      schema: { on_delete: 'SET NULL' },
    });
    ok('models.logo pridan (M2O -> directus_files)');
  }

  console.log('\n=== Hotovo. V adminu (Ctrl+Shift+R): ===');
  console.log('  Models -> libovolny model -> pole "Logo" -> nahraj obrazek');
  console.log('  Pak rebuild / deploy -> v hero /model se ukaze logo misto textu.\n');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
