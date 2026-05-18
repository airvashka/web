#!/usr/bin/env node
/**
 * SFR Motor — Setup Directus collection `knowledge_documents` pro RAG.
 *
 * Co dělá:
 *   1) Vytvoří collection `knowledge_documents`
 *   2) Vytvoří fields: title, source_filename, brand_slug, model_slug, tag,
 *      content, chunk_index, total_chunks, page_number
 *   3) Nastaví public permissions na READ (frontend musí číst pro chat search)
 *
 * Po doběhnutí:
 *   - V Directus admin uvidíš novou collection "Knowledge documents"
 *   - Spusť `node scripts/import-brochure.mjs` pro nahrání PDF
 *
 * Použití:
 *   cd web
 *   node scripts/setup-knowledge-documents.mjs
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
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

async function collectionExists(name) {
  try {
    await api('GET', `/collections/${name}`);
    return true;
  } catch (e) {
    return false;
  }
}

async function fieldExists(collection, field) {
  try {
    await api('GET', `/fields/${collection}/${field}`);
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureField(collection, field, def) {
  if (await fieldExists(collection, field)) {
    info(`field ${field} už existuje`);
    return;
  }
  await api('POST', `/fields/${collection}`, { field, ...def });
  ok(`field ${field} vytvořen`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Setup knowledge_documents collection');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // ── Create collection ──
  if (await collectionExists('knowledge_documents')) {
    info('collection knowledge_documents už existuje');
  } else {
    await api('POST', '/collections', {
      collection: 'knowledge_documents',
      meta: {
        icon: 'library_books',
        note: 'Brožury, manuály, ceníky — chunky textu pro RAG vyhledávání AI chatem.',
        display_template: '{{title}} #{{chunk_index}}',
        sort_field: 'sort',
        archive_field: null,
        singleton: false,
        translations: [{ language: 'cs-CZ', translation: 'Znalostní dokumenty', singular: 'Dokument', plural: 'Dokumenty' }],
      },
      schema: { name: 'knowledge_documents' },
    });
    ok('collection knowledge_documents vytvořena');
  }

  // ── Fields ──
  console.log('\n─── Fields ───');

  await ensureField('knowledge_documents', 'title', {
    type: 'string',
    meta: {
      required: true,
      width: 'half',
      note: 'Název dokumentu, např. "KGM Torres EVX — brožura 2025".',
      translations: [{ language: 'cs-CZ', translation: 'Název dokumentu' }],
    },
    schema: { is_nullable: false },
  });

  await ensureField('knowledge_documents', 'source_filename', {
    type: 'string',
    meta: {
      width: 'half',
      note: 'Původní soubor (např. "kgm-torres-evx-brozura.pdf"). Pro orientaci.',
      translations: [{ language: 'cs-CZ', translation: 'Zdrojový soubor' }],
    },
  });

  await ensureField('knowledge_documents', 'brand_slug', {
    type: 'string',
    meta: {
      width: 'half',
      interface: 'select-dropdown',
      options: {
        choices: [
          { text: 'KGM', value: 'kgm' },
          { text: 'OMODA & JAECOO', value: 'omoda-jaecoo' },
          { text: 'Farizon', value: 'farizon' },
          { text: '(univerzální — vše)', value: '' },
        ],
      },
      note: 'Pokud dokument patří ke konkrétní značce. Prázdné = univerzální.',
      translations: [{ language: 'cs-CZ', translation: 'Značka' }],
    },
  });

  await ensureField('knowledge_documents', 'model_slug', {
    type: 'string',
    meta: {
      width: 'half',
      note: 'Slug modelu (např. "torres", "korando", "rexton"). Prázdné = pro celou značku.',
      translations: [{ language: 'cs-CZ', translation: 'Model (slug)' }],
    },
  });

  await ensureField('knowledge_documents', 'tag', {
    type: 'string',
    meta: {
      width: 'half',
      interface: 'select-dropdown',
      options: {
        choices: [
          { text: 'Brožura', value: 'brozura' },
          { text: 'Technický manuál', value: 'manual' },
          { text: 'Servisní info', value: 'servis' },
          { text: 'Ceník (text)', value: 'cenik' },
          { text: 'Financování', value: 'financovani' },
          { text: 'Záruka', value: 'zaruka' },
          { text: 'Obecné', value: 'general' },
        ],
      },
      note: 'Pomáhá AI filtrovat dle typu otázky.',
      translations: [{ language: 'cs-CZ', translation: 'Typ' }],
    },
  });

  await ensureField('knowledge_documents', 'content', {
    type: 'text',
    meta: {
      required: true,
      interface: 'input-multiline',
      note: 'Vlastní text chunku (~500 slov). AI ho čte při vyhledání.',
      translations: [{ language: 'cs-CZ', translation: 'Obsah (text)' }],
    },
    schema: { is_nullable: false },
  });

  await ensureField('knowledge_documents', 'chunk_index', {
    type: 'integer',
    meta: {
      width: 'half',
      note: 'Pořadí kousku v rámci dokumentu (1, 2, 3...).',
      translations: [{ language: 'cs-CZ', translation: 'Pořadí chunku' }],
    },
  });

  await ensureField('knowledge_documents', 'total_chunks', {
    type: 'integer',
    meta: {
      width: 'half',
      note: 'Celkový počet chunků v tomto dokumentu.',
      translations: [{ language: 'cs-CZ', translation: 'Celkem chunků' }],
    },
  });

  await ensureField('knowledge_documents', 'page_number', {
    type: 'integer',
    meta: {
      width: 'half',
      note: 'Odhadovaná stránka v PDF kde se text nachází.',
      translations: [{ language: 'cs-CZ', translation: 'Stránka v PDF' }],
    },
  });

  await ensureField('knowledge_documents', 'sort', {
    type: 'integer',
    meta: {
      width: 'half',
      hidden: true,
    },
  });

  await ensureField('knowledge_documents', 'status', {
    type: 'string',
    meta: {
      width: 'half',
      interface: 'select-dropdown',
      options: {
        choices: [
          { text: 'Aktivní', value: 'active' },
          { text: 'Skrytý (do AI se nepošle)', value: 'hidden' },
        ],
      },
      note: 'Pokud "hidden", AI tento chunk nepoužije.',
    },
    schema: { default_value: 'active' },
  });

  // ── Public read permission ──
  console.log('\n─── Public read permission ───');
  try {
    const existingPerms = await api('GET', '/permissions?filter[collection][_eq]=knowledge_documents&filter[role][_null]=true&filter[action][_eq]=read');
    if (existingPerms?.data?.length) {
      info('public read permission už existuje');
    } else {
      await api('POST', '/permissions', {
        collection: 'knowledge_documents',
        action: 'read',
        role: null, // null = public
        fields: '*',
        permissions: { status: { _eq: 'active' } },
      });
      ok('public read permission vytvořen');
    }
  } catch (e) {
    warn(`permission setup: ${e.message}`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo. Collection připravena.');
  console.log('');
  console.log('  KROK 2: nahraj PDF brožuru přes:');
  console.log('    node scripts/import-brochure.mjs path/to/brochure.pdf');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
