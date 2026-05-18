#!/usr/bin/env node
/**
 * SFR Motor — Import PDF brožury do `knowledge_documents` collection.
 *
 * Co dělá:
 *   1) Extrahuje text z PDF (pdfjs-dist)
 *   2) Rozdělí na chunky po ~500 slovech (s mírným overlapem)
 *   3) Pro každý chunk vytvoří záznam v Directus
 *   4) Volitelně značí stránku v PDF kde se text nachází
 *
 * Použití:
 *   # interaktivně (zeptá se na metadata)
 *   node scripts/import-brochure.mjs path/to/brochure.pdf
 *
 *   # nebo s parametry (CI / hromadný import)
 *   node scripts/import-brochure.mjs path/to/file.pdf --brand=kgm --model=torres --tag=brozura --title="Torres EVX brožura 2025"
 *
 * Pre-req:
 *   - npm install (přidá pdfjs-dist do dependencies)
 *   - Spusť napřed: node scripts/setup-knowledge-documents.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

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

/* ──────────── PDF EXTRACTION ──────────── */

async function extractPdfText(filePath) {
  // pdfjs-dist legacy build (ESM friendly in Node)
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

/* ──────────── CHUNKING ──────────── */

/**
 * Rozdělí text na chunky po ~targetWords slovech, s overlapWords slovy overlapu.
 * Zachovává informaci o tom z které stránky chunk pochází.
 */
function chunkPages(pages, targetWords = 500, overlapWords = 50) {
  // Naskládej všechen text s page markery, poté splitni na chunky podle slov.
  // Každý token: { word, page } — zachováváme z které stránky chunk pochází.
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
    const content = slice.map((t) => t.word).join(' ');
    const startPage = slice[0].page;
    const endPage = slice[slice.length - 1].page;
    chunks.push({
      content,
      page_number: startPage,
      page_range: startPage === endPage ? `${startPage}` : `${startPage}-${endPage}`,
      word_count: slice.length,
    });
    i += targetWords - overlapWords;
  }
  return chunks;
}

/* ──────────── ARG PARSING ──────────── */

function parseArgs(argv) {
  const result = { _: [] };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      result[k] = v ?? true;
    } else {
      result._.push(arg);
    }
  }
  return result;
}

/* ──────────── MAIN ──────────── */

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Import PDF brožury → knowledge_documents');
  console.log('═══════════════════════════════════════════════\n');

  const args = parseArgs(process.argv);
  const filePath = args._[0];
  if (!filePath) {
    console.error('Použití: node scripts/import-brochure.mjs <pdf-path> [--brand=kgm] [--model=torres] [--tag=brozura] [--title="..."]');
    process.exit(1);
  }

  let fileBuf;
  try {
    fileBuf = readFileSync(filePath);
  } catch (e) {
    console.error(`✗ Nemohu otevřít ${filePath}: ${e.message}`);
    process.exit(1);
  }
  info(`PDF: ${filePath} (${(fileBuf.length / 1024 / 1024).toFixed(2)} MB)`);

  // ── Metadata ──
  const title = args.title || (await prompt(`Název dokumentu [${basename(filePath, '.pdf')}]: `)).trim() || basename(filePath, '.pdf');
  const brand = args.brand ?? (await prompt('Značka (kgm / omoda-jaecoo / farizon / prázdné=univerzální): ')).trim();
  const model = args.model ?? (await prompt('Model slug (např. torres, korando, prázdné=pro celou značku): ')).trim();
  const tag = args.tag || (await prompt('Typ (brozura / manual / servis / cenik / financovani / zaruka / general) [brozura]: ')).trim() || 'brozura';
  console.log('');

  // ── Auth ──
  URL = (args.directus_url || 'https://directus-production-3e67.up.railway.app');
  if (!args.email) {
    const email = (await prompt(`Email pro Directus: `)).trim();
    const password = (await prompt(`Heslo: `)).trim();
    const auth = await api('POST', '/auth/login', { email, password });
    TOKEN = auth.data.access_token;
  } else {
    const auth = await api('POST', '/auth/login', { email: args.email, password: args.password });
    TOKEN = auth.data.access_token;
  }
  ok('Auth OK\n');

  // ── Extract ──
  info('Extracting text from PDF...');
  const pages = await extractPdfText(filePath);
  const totalWords = pages.reduce((acc, p) => acc + (p.text?.split(/\s+/).filter(Boolean).length ?? 0), 0);
  ok(`${pages.length} stránek, ${totalWords} slov celkem`);

  // ── Chunk ──
  const chunks = chunkPages(pages, 500, 50);
  ok(`${chunks.length} chunků (~500 slov + 50 overlap)\n`);

  // ── Smaž existující chunky pro tento source_filename (idempotent) ──
  const sourceFilename = basename(filePath);
  const existing = await api('GET',
    `/items/knowledge_documents?filter[source_filename][_eq]=${encodeURIComponent(sourceFilename)}&fields=id&limit=-1`);
  if (existing?.data?.length) {
    info(`Mažu ${existing.data.length} existujících chunků pro ${sourceFilename}...`);
    const ids = existing.data.map((d) => d.id);
    await api('DELETE', '/items/knowledge_documents', ids);
    ok('hotovo, prostor uvolněn\n');
  }

  // ── Upload chunků ──
  console.log('─── Upload do Directus ───');
  let created = 0, failed = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    try {
      await api('POST', '/items/knowledge_documents', {
        title,
        source_filename: sourceFilename,
        brand_slug: brand || null,
        model_slug: model || null,
        tag,
        content: c.content,
        chunk_index: i + 1,
        total_chunks: chunks.length,
        page_number: c.page_number,
        sort: i + 1,
        status: 'active',
      });
      created++;
      if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
        process.stdout.write(`  ✓  ${i + 1}/${chunks.length}\r`);
      }
    } catch (e) {
      console.log('');
      console.error(`  ✗ chunk ${i + 1}: ${e.message}`);
      failed++;
    }
  }
  console.log('');
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Hotovo. ${created} chunků vytvořeno, ${failed} chyb.`);
  console.log(`  Můžeš zkontrolovat v Directus → Znalostní dokumenty`);
  console.log(`═══════════════════════════════════════════════`);
  rl.close();
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  rl.close();
  process.exit(1);
});
