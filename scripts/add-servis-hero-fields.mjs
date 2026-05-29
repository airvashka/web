#!/usr/bin/env node
/**
 * SFR Motor — přidá do site_settings sekci "Servis — hero":
 *   - servis_hero_image     (M2O file → directus_files) — hero foto na /servis
 *   - servis_hero_title     (string)                    — hlavní nadpis
 *   - servis_hero_subtitle  (text)                      — podnadpis / perex
 *
 * Idempotentní — co už existuje, přeskočí.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-servis-hero-fields.mjs
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

const COLLECTION = 'site_settings';

async function fieldExists(field) {
  try { await api('GET', `/fields/${COLLECTION}/${field}`); return true; } catch { return false; }
}

async function addFileField(field, meta) {
  if (await fieldExists(field)) { info(`${COLLECTION}.${field} už existuje.`); return; }
  await api('POST', `/fields/${COLLECTION}`, {
    field, type: 'uuid', schema: { is_nullable: true },
    meta: { ...meta, special: ['file'] },
  });
  await api('POST', '/relations', {
    collection: COLLECTION, field, related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
  ok(`${COLLECTION}.${field} přidán (M2O → directus_files)`);
}

async function addTextField(field, type, meta) {
  if (await fieldExists(field)) { info(`${COLLECTION}.${field} už existuje.`); return; }
  await api('POST', `/fields/${COLLECTION}`, {
    field, type, schema: { is_nullable: true }, meta,
  });
  ok(`${COLLECTION}.${field} přidán (${type})`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add Servis hero → site_settings');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://admin.sfr-motor.cz]: ')).trim() || 'https://admin.sfr-motor.cz';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  await addFileField('servis_hero_image', {
    interface: 'file-image', width: 'full', sort: 50,
    note: 'Hero foto na stránce /servis. Doporučeno široké/landscape, min. 1920px na šířku. Pokud chybí, hero se zobrazí jako textový bez fotky.',
  });
  await addTextField('servis_hero_title', 'string', {
    interface: 'input', width: 'full', sort: 51,
    note: 'Hlavní nadpis hero na /servis. Pokud prázdné → "Servis pro všechny značky".',
  });
  await addTextField('servis_hero_subtitle', 'text', {
    interface: 'input-multiline', width: 'full', sort: 52,
    note: 'Podnadpis pod hero nadpisem na /servis. Pokud prázdné → výchozí text.',
  });

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Nastavení webu (site_settings) → sekce Servis:');
  console.log('      Servis Hero Image     — nahraj foto');
  console.log('      Servis Hero Title     — nadpis');
  console.log('      Servis Hero Subtitle  — podnadpis');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
