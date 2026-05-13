#!/usr/bin/env node
/**
 * SFR Motor — diagnose model_documents permission + O2M fetch.
 *
 * Ověří:
 *   1) Permission model_documents public read (existuje, je published)
 *   2) Direct GET /items/model_documents bez auth — vrátí data?
 *   3) GET /items/models?filter[slug]=tivoli&fields=documents.* — vrátí expanded?
 *
 * Použití:
 *   cd web && node scripts/diagnose-documents.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '';

async function publicGet(path) {
  const r = await fetch(`${URL}${path}`);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { ok: r.ok, status: r.status, body: j };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Diagnose model_documents');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  console.log('');

  // 1. Direct unauthenticated GET na collection
  console.log('Test 1: GET /items/model_documents (anonymous)');
  const t1 = await publicGet('/items/model_documents?limit=10');
  if (t1.ok) {
    console.log(`✓ Status ${t1.status}, count=${t1.body?.data?.length ?? 0}`);
    if (t1.body?.data?.length > 0) {
      console.log('  Sample:');
      console.log('  ', JSON.stringify(t1.body.data[0], null, 2));
    }
  } else {
    console.log(`✗ Status ${t1.status}: ${JSON.stringify(t1.body?.errors ?? t1.body)}`);
  }
  console.log('');

  // 2. Models s documents expand
  console.log('Test 2: GET /items/models s expanded documents');
  const t2 = await publicGet('/items/models?filter[slug][_eq]=tivoli&fields=id,slug,name,documents.id,documents.title,documents.type,documents.file&limit=1');
  if (t2.ok) {
    console.log(`✓ Status ${t2.status}`);
    console.log(JSON.stringify(t2.body?.data, null, 2));
  } else {
    console.log(`✗ Status ${t2.status}: ${JSON.stringify(t2.body?.errors ?? t2.body)}`);
  }
  console.log('');

  // 3. Models s documents.*
  console.log('Test 3: GET /items/models s documents.* (wildcard expand)');
  const t3 = await publicGet('/items/models?filter[slug][_eq]=tivoli&fields=id,slug,name,documents.*&limit=1');
  if (t3.ok) {
    console.log(`✓ Status ${t3.status}`);
    console.log(JSON.stringify(t3.body?.data, null, 2));
  } else {
    console.log(`✗ Status ${t3.status}: ${JSON.stringify(t3.body?.errors ?? t3.body)}`);
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); }).finally(() => rl.close());
