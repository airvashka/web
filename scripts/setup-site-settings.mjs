#!/usr/bin/env node
/**
 * SFR Motor — Site Settings singleton.
 *
 * Vytvoří v Directusu:
 *   1) Collection `site_settings` jako singleton (jediný řádek)
 *   2) Fieldy pro homepage hero + YouTube
 *   3) Public read permission
 *   4) První / jediný record s default hodnotami
 *
 * V adminu vypadá jako jediná položka "Site Settings" v sidebaru.
 * Klient klikne a edituje hero foto + texty + IDs videí.
 *
 * Použití:
 *   cd web && node scripts/setup-site-settings.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

async function collectionExists(name) {
  try { await api('GET', `/collections/${name}`); return true; } catch { return false; }
}

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; } catch { return false; }
}

async function ensureCollection() {
  if (await collectionExists('site_settings')) {
    info('site_settings collection už existuje');
    return;
  }
  await api('POST', '/collections', {
    collection: 'site_settings',
    meta: {
      singleton: true,
      icon: 'settings_suggest',
      note: 'Globální nastavení webu — titulka, sociální sítě.',
      display_template: 'Site Settings',
      sort_field: null,
      archive_field: null,
    },
    schema: {},
  });
  ok('site_settings collection vytvořena (singleton)');
}

async function ensureField(field, type, meta = {}, schema = {}) {
  if (await fieldExists('site_settings', field)) {
    info(`site_settings.${field} už existuje`);
    return;
  }
  await api('POST', '/fields/site_settings', {
    field,
    type,
    schema: { is_nullable: true, ...schema },
    meta: { width: 'full', ...meta },
  });
  ok(`site_settings.${field} vytvořeno`);
}

async function ensureFileField(field, note) {
  if (await fieldExists('site_settings', field)) {
    info(`site_settings.${field} už existuje`);
    return;
  }
  await api('POST', '/fields/site_settings', {
    field,
    type: 'uuid',
    schema: { foreign_key_table: 'directus_files', is_nullable: true },
    meta: { interface: 'file-image', special: ['file'], note, display: 'image', width: 'half' },
  });
  await api('POST', '/relations', {
    collection: 'site_settings',
    field,
    related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
  ok(`site_settings.${field} (file) vytvořeno`);
}

async function ensurePublicRead() {
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=policy');
  const policyId = access.data?.[0]?.policy;
  if (!policyId) { warn('Public access entry nenalezena — skipuji permission'); return; }

  const existing = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=site_settings&filter[action][_eq]=read&limit=1`);
  if (existing.data?.length > 0) {
    info('site_settings public read už existuje');
    return;
  }
  await api('POST', '/permissions', {
    policy: policyId,
    collection: 'site_settings',
    action: 'read',
    fields: ['*'],
    permissions: null,
  });
  ok('site_settings: public read přidáno');
}

async function ensureSingleRecord() {
  // Singleton v Directus 11: NE POST, ale PATCH /items/{collection}
  // Pokud řádek neexistuje, PATCH ho vytvoří. Pokud existuje, updatne (přepíše explicitně daná pole).
  const defaults = {
    homepage_hero_title: 'Tři značky.\nJeden servis.\nBez kompromisů.',
    homepage_hero_subtitle: 'Autorizovaný prodej a servis vozů KGM, OMODA & JAECOO a FARIZON.',
    homepage_hero_cta_label: 'Prohlédnout skladovku',
    homepage_hero_cta_url: '/sklad',
    homepage_hero_cta_secondary_label: 'Objednat servis',
    homepage_hero_cta_secondary_url: '/servis',
    homepage_youtube_video_ids: ['piG8UO24WUk', 'eSfJXjNV8Mg', 'SybpHjEJP1s', 'S9tdBpkwX_4'],
    instagram_url: 'https://www.instagram.com/sfrmotor/',
    youtube_channel_url: 'https://www.youtube.com/@sfrmotor',
  };

  // Zkus GET — pokud má hodnoty (alespoň jednu non-null), ponech
  try {
    const existing = await api('GET', '/items/site_settings');
    const item = existing?.data;
    if (item && typeof item === 'object' && (item.homepage_hero_title || item.homepage_hero_image)) {
      info('Singleton už má vyplněné hodnoty, ponechávám (admin upraví)');
      return;
    }
  } catch (e) {
    // 403 / not found OK, pokračujeme s PATCH
  }

  // PATCH = upsert pro singleton
  await api('PATCH', '/items/site_settings', defaults);
  ok('Default hodnoty nastaveny');
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SFR Motor — Site Settings singleton');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Collection
  console.log('Krok 1: Collection');
  await ensureCollection();
  console.log('');

  // 2) Fields — homepage hero
  console.log('Krok 2: Fields homepage hero');
  await ensureFileField('homepage_hero_image', 'Hlavní foto na titulce (doporučeno 2400×1200 px, JPG/WebP).');
  await ensureField('homepage_hero_title', 'text', {
    interface: 'input-multiline',
    note: 'Hlavní nadpis. Každý nový řádek (Enter) = další řádek na webu.',
    width: 'half',
  });
  await ensureField('homepage_hero_subtitle', 'text', {
    interface: 'input-multiline',
    note: 'Podtitulek pod hlavním nadpisem.',
    width: 'full',
  });
  await ensureField('homepage_hero_cta_label', 'string', {
    interface: 'input',
    note: 'Text primárního tlačítka (např. "Prohlédnout skladovku")',
    width: 'half',
  });
  await ensureField('homepage_hero_cta_url', 'string', {
    interface: 'input',
    note: 'URL nebo cesta primárního tlačítka (např. /sklad)',
    width: 'half',
  });
  await ensureField('homepage_hero_cta_secondary_label', 'string', {
    interface: 'input',
    note: 'Text sekundárního tlačítka',
    width: 'half',
  });
  await ensureField('homepage_hero_cta_secondary_url', 'string', {
    interface: 'input',
    note: 'URL sekundárního tlačítka',
    width: 'half',
  });
  console.log('');

  // 3) Videa
  console.log('Krok 3: Fields videa');
  await ensureField('homepage_youtube_video_ids', 'json', {
    interface: 'tags',
    special: ['cast-json'],
    note: 'YouTube video ID (z URL ?v=XXX). Web náhodně vybere 4 a zobrazí.',
    options: { placeholder: 'Vlož ID a Enter (např. piG8UO24WUk)' },
  });
  console.log('');

  // 4) Social
  console.log('Krok 4: Social');
  await ensureField('instagram_url', 'string', {
    interface: 'input',
    note: 'URL na Instagram profil.',
    width: 'half',
  });
  await ensureField('youtube_channel_url', 'string', {
    interface: 'input',
    note: 'URL na YouTube kanál.',
    width: 'half',
  });
  console.log('');

  // 5) Public read
  console.log('Krok 5: Permissions');
  await ensurePublicRead();
  console.log('');

  // 6) Single record
  console.log('Krok 6: Default record');
  await ensureSingleRecord();
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo! V adminu Directus →');
  console.log('  → Site Settings (v levém panelu)');
  console.log('  → uprav hero foto + texty + YouTube IDs');
  console.log('  → Save → Vercel rebuild za ~30 s');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
