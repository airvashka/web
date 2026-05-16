#!/usr/bin/env node
/**
 * SFR Motor — přidá hero_video + hero_image_card do models.
 *
 *   - `hero_image_card`  M2O file → fotka na kartu v brand listingu (portrait/4:3)
 *                                   Pokud chybí, fallback na hero_image.
 *   - `hero_video`       M2O file → background autoplay-mute-loop video na detail
 *                                   stránce. Pokud chybí, jen statická hero_image.
 *
 * Idempotentní.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/add-hero-media-fields.mjs
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

async function addField(field, meta) {
  if (await fieldExists('models', field)) {
    info(`models.${field} už existuje.`);
    return false;
  }
  await api('POST', '/fields/models', {
    field,
    type: 'uuid',
    schema: { is_nullable: true },
    meta: { ...meta, special: ['file'] },
  });
  // Relation → directus_files
  await api('POST', '/relations', {
    collection: 'models',
    field,
    related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
  ok(`models.${field} přidán (M2O → directus_files)`);
  return true;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Add hero_image_card + hero_video');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  await addField('hero_image_card', {
    interface: 'file-image',
    width: 'half',
    sort: 12,
    note: 'Fotka na kartu modelu v brand listingu — doporučeno portrait/4:3 nebo square (např. 1200×900). Pokud chybí, použije se hero_image. Pro detail stránku použij hero_image (cinematic 21:9).',
  });

  await addField('hero_video', {
    interface: 'file',
    width: 'half',
    sort: 13,
    note: 'Volitelné background video pro detail stránku (autoplay, mute, loop). MP4 doporučeno, WebM funguje taky. Pokud chybí, na detailu se ukáže jen hero_image. Drž to krátké (5-15s) a malé (< 5 MB), browser ho stáhne hned.',
  });

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. V adminu (Ctrl+Shift+R):');
  console.log('    Models → libovolný model →');
  console.log('      Hero Image (existující) — pro detail stránku');
  console.log('      Hero Image Card (nové)  — pro kartu na brand listingu');
  console.log('      Hero Video (nové)       — volitelné, autoplay na detailu');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
