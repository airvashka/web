#!/usr/bin/env node
/**
 * Přidá `content_normalized` field do knowledge_documents + backfillne existující chunky.
 *
 * Normalizace: lowercase + strip diakritika (`spotřeba` → `spotreba`).
 * Search v chat endpointu pak hledá v této verzi se stejně normalizovanými keywords —
 * uživatel může psát s/bez diakritiky a stále dostane match.
 *
 * Použití:
 *   node scripts/add-content-normalized-field.mjs
 *
 * Idempotentní — pokud field existuje, jen backfillne chunky které ho ještě nemají.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '', AUTH_TIME = 0, AUTH_EMAIL = '', AUTH_PASSWORD = '';
const TOKEN_LIFETIME_MS = 13 * 60 * 1000;

async function login() {
  const auth = await fetch(`${URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
  }).then((r) => r.json());
  if (!auth?.data?.access_token) throw new Error(`Login failed: ${JSON.stringify(auth?.errors ?? auth)}`);
  TOKEN = auth.data.access_token;
  AUTH_TIME = Date.now();
}

async function api(method, path, body) {
  if (!TOKEN || Date.now() - AUTH_TIME > TOKEN_LIFETIME_MS) await login();
  const doFetch = async () => {
    const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(`${URL}${path}`, opts);
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    return { ok: r.ok, status: r.status, json: j };
  };
  let res = await doFetch();
  if (!res.ok && (res.status === 401 || JSON.stringify(res.json).includes('TOKEN_EXPIRED'))) {
    await login();
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(res.json?.errors ?? res.json).slice(0, 400)}`);
  return res.json;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);

/** Normalizace stringu: lowercase + strip diakritika. */
function normalize(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

async function fieldExists(collection, field) {
  try { await api('GET', `/fields/${collection}/${field}`); return true; }
  catch { return false; }
}

async function main() {
  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  AUTH_EMAIL = (await prompt('Email: ')).trim();
  AUTH_PASSWORD = (await prompt('Heslo: ')).trim();
  console.log('');

  await login();
  ok('Auth OK\n');

  // 1) Vytvoř field pokud chybí
  if (await fieldExists('knowledge_documents', 'content_normalized')) {
    info('field content_normalized už existuje');
  } else {
    await api('POST', '/fields/knowledge_documents', {
      field: 'content_normalized',
      type: 'text',
      meta: {
        hidden: true, // skrytý v adminu — interní pole
        note: 'Auto-generated: content s lowercase + bez diakritiky. Pro fulltext search.',
      },
      schema: { is_nullable: true },
    });
    ok('field content_normalized vytvořen');
  }

  // 2) Backfill — najdi chunky bez content_normalized
  console.log('\n─── Backfill ───');
  const PAGE = 100;
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;

  while (true) {
    const res = await api('GET',
      `/items/knowledge_documents?filter[content_normalized][_null]=true&fields=id,content&limit=${PAGE}&offset=${offset}`);
    const chunks = res?.data ?? [];
    if (!chunks.length) break;

    info(`Načteno ${chunks.length} chunků (offset ${offset})`);
    for (const c of chunks) {
      const normalized = normalize(c.content);
      try {
        await api('PATCH', `/items/knowledge_documents/${c.id}`, {
          content_normalized: normalized,
        });
        totalUpdated++;
      } catch (e) {
        console.log(`  ✗ chunk ${c.id}: ${e.message}`);
      }
      totalProcessed++;
      if (totalProcessed % 25 === 0) process.stdout.write(`    progress: ${totalProcessed}\r`);
    }
    offset += PAGE;
    if (chunks.length < PAGE) break;
  }

  console.log('');
  console.log(`\n✅ Hotovo. Zpracováno ${totalProcessed} chunků, updatováno ${totalUpdated}.`);
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
