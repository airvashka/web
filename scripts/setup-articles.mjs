#!/usr/bin/env node
/**
 * SFR Motor — Magazín collection (články).
 *
 * Vytvoří collection `articles` s těmito poli:
 *   - slug, title, excerpt
 *   - body (markdown, rendered přes marked.js na webu)
 *   - cover_image (M2O directus_files)
 *   - category (enum)
 *   - author (string — později M2O employees)
 *   - read_time (string, např. "8 min")
 *   - date (datetime)
 *   - featured (bool)
 *   - status (published/draft/archived)
 *   - sort
 *
 * Plus public read s status=published.
 *
 * Použití:
 *   cd web && node scripts/setup-articles.mjs
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

async function ensureField(collection, field, type, meta = {}, schema = {}) {
  if (await fieldExists(collection, field)) return;
  await api('POST', `/fields/${collection}`, {
    field, type,
    schema: { is_nullable: true, ...schema },
    meta: { width: 'full', ...meta },
  });
}

async function ensureM2OFile(collection, field, label, note) {
  if (await fieldExists(collection, field)) return;
  await api('POST', `/fields/${collection}`, {
    field, type: 'uuid',
    schema: { foreign_key_table: 'directus_files', is_nullable: true },
    meta: { interface: 'file-image', special: ['file'], note, display: 'image', width: 'full' },
  });
  await api('POST', '/relations', {
    collection, field, related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
}

async function ensurePublicRead(collection, publishedFilter = true) {
  const access = await api('GET', '/access?filter[user][_null]=true&filter[role][_null]=true&fields=policy');
  const policyId = access.data?.[0]?.policy;
  if (!policyId) { warn('Public policy nenalezena'); return; }
  const existing = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=read&limit=1`);
  if (existing.data?.length > 0) return;
  await api('POST', '/permissions', {
    policy: policyId, collection, action: 'read', fields: ['*'],
    permissions: publishedFilter ? { _and: [{ status: { _eq: 'published' } }] } : null,
  });
  ok(`${collection}: public read přidáno (${publishedFilter ? 'published only' : 'všechny'})`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Magazín — articles collection');
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
  console.log('Krok 1: Collection articles');
  if (!(await collectionExists('articles'))) {
    await api('POST', '/collections', {
      collection: 'articles',
      meta: {
        icon: 'article',
        note: 'Články magazínu — recenze, testy, novinky.',
        sort_field: 'sort',
        archive_field: 'status',
        archive_value: 'archived',
        unarchive_value: 'draft',
        display_template: '{{title}}',
      },
      schema: {},
      fields: [
        {
          field: 'id', type: 'integer',
          meta: { hidden: true, interface: 'input', readonly: true },
          schema: { is_primary_key: true, has_auto_increment: true },
        },
      ],
    });
    ok('Collection articles vytvořena');
  } else {
    info('Collection articles už existuje');
  }
  console.log('');

  // 2) Fields
  console.log('Krok 2: Fields');

  await ensureField('articles', 'status', 'string', {
    interface: 'select-dropdown',
    width: 'half',
    options: {
      choices: [
        { text: 'Publikováno', value: 'published' },
        { text: 'Koncept', value: 'draft' },
        { text: 'Archivováno', value: 'archived' },
      ],
    },
    display: 'labels',
    display_options: {
      showAsDot: true,
      choices: [
        { text: 'Publikováno', value: 'published', foreground: '#FFFFFF', background: '#1F8A4D' },
        { text: 'Koncept', value: 'draft', foreground: '#FFFFFF', background: '#B27516' },
        { text: 'Archivováno', value: 'archived', foreground: '#FFFFFF', background: '#6B6B72' },
      ],
    },
  }, { default_value: 'draft' });

  await ensureField('articles', 'featured', 'boolean', {
    interface: 'boolean',
    width: 'half',
    note: 'Zaškrtni 1 článek jako "Doporučujeme" (zobrazí se velký nahoře v magazínu).',
  }, { default_value: false });

  await ensureField('articles', 'sort', 'integer', { interface: 'input', hidden: true });

  await ensureField('articles', 'title', 'string', {
    interface: 'input',
    width: 'full',
    note: 'Titulek článku (max ~80 znaků).',
    required: true,
  });

  await ensureField('articles', 'slug', 'string', {
    interface: 'input',
    width: 'half',
    note: 'URL slug, např. "torres-evx-5000km". Lowercase, pomlčky.',
  });

  await ensureField('articles', 'category', 'string', {
    interface: 'select-dropdown',
    width: 'half',
    options: {
      choices: [
        { text: 'Recenze', value: 'recenze' },
        { text: 'Test', value: 'test' },
        { text: 'Novinka', value: 'novinka' },
        { text: 'Srovnání', value: 'srovnani' },
        { text: 'Technologie', value: 'technologie' },
        { text: 'Servisní tipy', value: 'servis' },
        { text: 'Značka', value: 'znacka' },
        { text: 'Zprávy', value: 'zpravy' },
      ],
    },
  });

  await ensureField('articles', 'excerpt', 'text', {
    interface: 'input-multiline',
    width: 'full',
    note: 'Krátký úvod (max ~200 znaků). Zobrazí se na kartě v listingu.',
  });

  await ensureField('articles', 'body', 'text', {
    interface: 'input-rich-text-md',
    width: 'full',
    note: 'Obsah článku v Markdown. Podporuje **bold**, *italic*, ## nadpisy, > pullquoty, [link](url), ![alt](image-url), seznamy.',
  });

  await ensureM2OFile('articles', 'cover_image', 'Cover image', 'Hlavní obrázek článku (16:9, 1920×1080 ideal).');

  await ensureField('articles', 'author', 'string', {
    interface: 'input',
    width: 'half',
    note: 'Jméno autora, např. "Petr Paseka".',
  });

  await ensureField('articles', 'read_time', 'string', {
    interface: 'input',
    width: 'half',
    note: 'Doba čtení, např. "8 min".',
  });

  await ensureField('articles', 'date_published', 'timestamp', {
    interface: 'datetime',
    width: 'half',
    display: 'datetime',
    display_options: { relative: true },
    note: 'Datum publikace článku.',
  });

  ok('Všechny fieldy vytvořené');
  console.log('');

  // 3) Permissions
  console.log('Krok 3: Permissions');
  await ensurePublicRead('articles', true);
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus (Ctrl+Shift+R):');
  console.log('  • Sidebar → "Articles" (ikona article)');
  console.log('  • + Create New → vyplň title/slug/category/body/cover_image/author/date');
  console.log('  • Status: Koncept (default) → po dokončení změnit na Publikováno');
  console.log('  • Featured: zaškrtnout 1 článek = "Doporučujeme" v magazínu');
  console.log('');
  console.log('Volitelně spusť seed-articles.mjs pro 4 ukázkové články.');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
