#!/usr/bin/env node
/**
 * SFR Motor — Batch import všech PDF z folder struktury.
 *
 * Očekává strukturu:
 *   <root>/
 *     ACTYON/   *.pdf
 *     TORRES/   *.pdf
 *     korando/  *.pdf
 *     ...
 *
 * Folder name → model slug (lowercase, mezery → pomlčky):
 *   ACTYON       → actyon
 *   TORRES       → torres
 *   TORRES EVX   → torres-evx
 *   korando      → korando
 *   ...
 *
 * Tag inferuje z filename:
 *   *_manual_majitele*  → manual
 *   *_audio*            → manual
 *   *_tomtom*           → manual
 *   ostatní             → brozura
 *
 * Všechny modely v této složce → značka **KGM**.
 *
 * Použití:
 *   node scripts/import-brochures-batch.mjs "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\_downloads-todo\manualy"
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 400)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

/* ──────────── PDF EXTRACTION + CHUNKING ──────────── */

async function extractPdfText(filePath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dataBuffer = readFileSync(filePath);
  const uint8Array = new Uint8Array(dataBuffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ page: i, text });
  }
  return pages;
}

function chunkPages(pages, targetWords = 500, overlapWords = 50) {
  const tokens = [];
  for (const p of pages) {
    const words = (p.text || '').split(/\s+/).filter(Boolean);
    for (const w of words) tokens.push({ word: w, page: p.page });
  }
  const chunks = [];
  let i = 0;
  while (i < tokens.length) {
    const slice = tokens.slice(i, i + targetWords);
    if (!slice.length) break;
    chunks.push({
      content: slice.map((t) => t.word).join(' '),
      page_number: slice[0].page,
      word_count: slice.length,
    });
    i += targetWords - overlapWords;
  }
  return chunks;
}

/* ──────────── METADATA INFERENCE ──────────── */

function folderToModelSlug(folderName) {
  return folderName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function inferTag(filename) {
  const lc = filename.toLowerCase();
  if (/manual_majitele|owner|uzivatelsky/.test(lc)) return 'manual';
  if (/audio|tomtom|navigace|infotain/.test(lc)) return 'manual';
  if (/servis|service|udrzba/.test(lc)) return 'servis';
  if (/cenik|price/.test(lc)) return 'cenik';
  if (/zaruka|warranty/.test(lc)) return 'zaruka';
  if (/finan|leasing/.test(lc)) return 'financovani';
  return 'brozura';
}

function inferTitle(filename, modelName) {
  // Vyhoď doc_<timestamp>_ prefix
  let clean = filename.replace(/^doc_\d+_/, '').replace(/\.pdf$/i, '');
  // Vyhoď suffixy
  clean = clean.replace(/-compressed$/i, '').replace(/_cz(_\d+)?$/i, '').replace(/_/g, ' ');
  // Capitalize words
  clean = clean.replace(/\b\w/g, (c) => c.toUpperCase());
  return `${modelName} — ${clean}`;
}

/* ──────────── PROCESS ONE FILE ──────────── */

async function processPdf({ filePath, brand, modelSlug, modelName, tag, title }) {
  const sourceFilename = basename(filePath);
  process.stdout.write(`  📄 ${sourceFilename} ...`);

  // Skip if already imported
  const existing = await api('GET',
    `/items/knowledge_documents?filter[source_filename][_eq]=${encodeURIComponent(sourceFilename)}&fields=id&limit=1`);
  if (existing?.data?.length) {
    console.log(' SKIP (už nahrané)');
    return { status: 'skipped' };
  }

  let pages;
  try {
    pages = await extractPdfText(filePath);
  } catch (e) {
    console.log(` ✗ extract: ${e.message}`);
    return { status: 'failed', reason: 'extract' };
  }
  const chunks = chunkPages(pages, 500, 50);
  console.log(` ${pages.length} stránek → ${chunks.length} chunků`);

  let created = 0, failed = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    try {
      await api('POST', '/items/knowledge_documents', {
        title,
        source_filename: sourceFilename,
        brand_slug: brand,
        model_slug: modelSlug || null,
        tag,
        content: c.content,
        chunk_index: i + 1,
        total_chunks: chunks.length,
        page_number: c.page_number,
        sort: i + 1,
        status: 'active',
      });
      created++;
    } catch (e) {
      failed++;
    }
  }
  console.log(`     ✓ ${created} chunků${failed ? `, ✗ ${failed} chyb` : ''}`);
  return { status: 'imported', created, failed };
}

/* ──────────── MAIN ──────────── */

async function main() {
  const rootArg = process.argv[2];
  if (!rootArg) {
    console.error('Použití: node scripts/import-brochures-batch.mjs <root-folder>');
    console.error('Příklad: node scripts/import-brochures-batch.mjs "C:\\Users\\antos\\Desktop\\Claude\\SFR WEB\\SFR WEB\\_downloads-todo\\manualy"');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════');
  console.log('  Batch import brožur do knowledge_documents');
  console.log('═══════════════════════════════════════════════\n');

  // Brand — pro tuto složku všechno KGM (z parametru by šlo, ale tady víme)
  const BRAND = 'kgm';

  // ── Auth ──
  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // ── Walk folders ──
  let folders;
  try {
    folders = readdirSync(rootArg).filter((f) => statSync(join(rootArg, f)).isDirectory());
  } catch (e) {
    console.error(`✗ Nemohu otevřít ${rootArg}: ${e.message}`);
    process.exit(1);
  }

  info(`Nalezeno ${folders.length} model složek: ${folders.join(', ')}\n`);

  let totalImported = 0, totalSkipped = 0, totalFailed = 0;

  for (const folder of folders) {
    const modelSlug = folderToModelSlug(folder);
    const modelName = folder.toUpperCase();
    const folderPath = join(rootArg, folder);

    console.log(`\n─── ${folder} → model_slug="${modelSlug}", brand="${BRAND}" ───`);

    const pdfs = readdirSync(folderPath).filter((f) => extname(f).toLowerCase() === '.pdf');
    if (!pdfs.length) {
      info('  (žádné PDF)');
      continue;
    }

    for (const pdf of pdfs) {
      const filePath = join(folderPath, pdf);
      const tag = inferTag(pdf);
      const title = inferTitle(pdf, modelName);
      try {
        const r = await processPdf({ filePath, brand: BRAND, modelSlug, modelName, tag, title });
        if (r.status === 'imported') totalImported++;
        else if (r.status === 'skipped') totalSkipped++;
        else totalFailed++;
      } catch (e) {
        console.log(`  ✗ ${pdf}: ${e.message}`);
        totalFailed++;
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Importováno ${totalImported}, skipnuto ${totalSkipped}, chyb ${totalFailed}.`);
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  rl.close();
  process.exit(1);
});
