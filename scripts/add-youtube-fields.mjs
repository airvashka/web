#!/usr/bin/env node
/**
 * SFR Motor — přidání `youtube_video_ids` polí do Directus.
 *
 * Přidá:
 *   - brands.youtube_video_ids (JSON array of strings)
 *   - models.youtube_video_ids (JSON array of strings)
 *
 * Po spuštění: v adminu Directus uvidíš nové pole "YouTube Video IDs"
 * u každého brandu / modelu. Vyplň 5–10 IDs (z URL: youtube.com/watch?v=XXX → XXX).
 * Při buildu Astro náhodně vybere 4 a vykreslí na brand / model stránce.
 *
 * Použití:
 *   cd web && node scripts/add-youtube-fields.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

async function fieldExists(collection, field) {
  try {
    const r = await api('GET', `/fields/${collection}/${field}`);
    return !!r?.data;
  } catch {
    return false;
  }
}

async function addYoutubeField(collection) {
  if (await fieldExists(collection, 'youtube_video_ids')) {
    warn(`${collection}.youtube_video_ids už existuje, přeskakuji`);
    return;
  }
  await api('POST', `/fields/${collection}`, {
    field: 'youtube_video_ids',
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'tags',
      special: ['cast-json'],
      note: 'Seznam YouTube video ID (z URL youtube.com/watch?v=XXX → XXX). Web náhodně vybere 4 a zobrazí na stránce.',
      options: {
        placeholder: 'Vlož ID a stiskni Enter (např. piG8UO24WUk)',
      },
      width: 'full',
    },
  });
  ok(`${collection}.youtube_video_ids přidáno`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Add youtube_video_ids fields');
  console.log('═══════════════════════════════════════════════\n');

  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  console.log('Přidávám pole youtube_video_ids:');
  await addYoutubeField('brands');
  await addYoutubeField('models');

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════\n');
  console.log('Nyní v adminu:');
  console.log('  1) Otevři Brands → KGM (nebo libovolný)');
  console.log('  2) Najdi "Youtube Video Ids" pole dole');
  console.log('  3) Vlož 5–10 ID (např. piG8UO24WUk) — každé enter');
  console.log('  4) Save → Vercel rebuild → zobrazí se náhodně 4 na /kgm');
  console.log('');
  console.log('Stejně i u Models — videa specifická pro model.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
