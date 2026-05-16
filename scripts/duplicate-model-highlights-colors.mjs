#!/usr/bin/env node
/**
 * SFR Motor — Duplikuj highlights + barvy z jednoho modelu na druhý.
 *
 * Co dělá:
 *   - Stáhne všechny `model_highlights` ze ZDROJOVÉHO modelu
 *   - Stáhne všechny `model_color_exterior` ze zdrojového modelu
 *   - Stáhne všechny `model_color_interior` ze zdrojového modelu
 *   - Pro každou kolekci POSTne kopie s `model` = cílový ID (id se vygeneruje nově)
 *
 * Fotky NEDUPLIKUJE — drží reference na stejné directus_files UUID,
 * takže zdroj i cíl ukazují na stejnou fyzickou fotku v Directusu.
 *
 * Bezpečnost:
 *   - Pokud cíl už má v dané kolekci data, vyžádá si POTVRZENÍ (prevence duplicit).
 *   - --force přeskočí potvrzení (a duplikáty vytvoří navíc — pozor!)
 *   - --dry jen vypíše co by se stalo, nic nezapíše.
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/duplicate-model-highlights-colors.mjs torres torres-hev
 *   node scripts/duplicate-model-highlights-colors.mjs torres torres-hev --dry
 *   node scripts/duplicate-model-highlights-colors.mjs torres torres-evx --force
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (n) => argv.includes(n);

if (positional.length < 2) {
  console.error('Použití: node scripts/duplicate-model-highlights-colors.mjs <zdroj-slug> <cíl-slug> [--dry] [--force]');
  console.error('Příklad: node scripts/duplicate-model-highlights-colors.mjs torres torres-hev');
  process.exit(1);
}

const SOURCE_SLUG = positional[0];
const TARGET_SLUG = positional[1];
const DRY = flag('--dry');
const FORCE = flag('--force');

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

const ok   = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

/** Vrátí kopii recordu bez systemových polí + s přemapovaným `model`. */
function prepareCopy(record, targetModelId) {
  const copy = { ...record };
  // Smazat systémová pole — Directus si je vygeneruje
  delete copy.id;
  delete copy.date_created;
  delete copy.date_updated;
  delete copy.user_created;
  delete copy.user_updated;
  // Přemapovat model FK
  copy.model = targetModelId;
  return copy;
}

async function findModel(slug) {
  const r = await api('GET', `/items/models?filter[slug][_eq]=${encodeURIComponent(slug)}&fields=id,slug,name&limit=1`);
  return (r.data && r.data[0]) || null;
}

async function duplicateCollection(collection, sourceModelId, targetModelId, label) {
  console.log(`\n─── ${label} (${collection}) ───`);

  // Source items
  const srcResp = await api('GET', `/items/${collection}?filter[model][_eq]=${sourceModelId}&limit=200&fields=*`);
  const items = srcResp.data || [];
  if (items.length === 0) {
    warn(`Zdroj nemá žádné položky v ${collection}, přeskakuji.`);
    return { copied: 0, skipped: 0 };
  }
  info(`Nalezeno ${items.length} položek na zdroji.`);

  // Target items (potvrzení) — jen id, ne všechna pole (mode_highlights nemá `name`)
  const dstResp = await api('GET', `/items/${collection}?filter[model][_eq]=${targetModelId}&limit=10&fields=id`);
  const existing = dstResp.data || [];
  if (existing.length > 0) {
    warn(`Cíl už má ${existing.length} položek v ${collection}.`);
    if (FORCE) {
      info('--force → vytvořím navíc duplikáty.');
    } else {
      const ans = (await prompt(`Pokračovat a přidat ${items.length} dalších položek? (a/n): `)).trim().toLowerCase();
      if (ans !== 'a' && ans !== 'y' && ans !== 'ano' && ans !== 'yes') {
        info('Přeskakuji.');
        return { copied: 0, skipped: items.length };
      }
    }
  }

  let copied = 0;
  for (const it of items) {
    const payload = prepareCopy(it, targetModelId);
    if (DRY) {
      info(`[DRY] by se vytvořilo: ${payload.name ?? payload.title ?? '(unnamed)'}`);
      copied++;
      continue;
    }
    try {
      await api('POST', `/items/${collection}`, payload);
      ok(`Vytvořeno: ${payload.name ?? payload.title ?? '(unnamed)'}`);
      copied++;
    } catch (e) {
      warn(`Selhalo "${payload.name ?? payload.title ?? '?'}": ${e.message}`);
    }
  }
  return { copied, skipped: 0 };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Duplikace ${SOURCE_SLUG} → ${TARGET_SLUG}`);
  console.log('═══════════════════════════════════════════════');
  console.log(`  Highlights + Barvy (exteriér + interiér)`);
  if (DRY)   info('DRY-RUN — nic se nezapíše.');
  if (FORCE) info('FORCE — bez potvrzení (může vytvářet duplikáty).');
  console.log('');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  const source = await findModel(SOURCE_SLUG);
  if (!source) { console.error(`✗ Model "${SOURCE_SLUG}" nenalezen.`); rl.close(); process.exit(1); }
  const target = await findModel(TARGET_SLUG);
  if (!target) { console.error(`✗ Model "${TARGET_SLUG}" nenalezen.`); rl.close(); process.exit(1); }

  ok(`Zdroj: ${source.name} (id=${source.id}, slug=${source.slug})`);
  ok(`Cíl:   ${target.name} (id=${target.id}, slug=${target.slug})`);

  if (source.id === target.id) {
    console.error('✗ Zdroj a cíl jsou stejný model — nelze duplikovat na sebe.');
    rl.close();
    process.exit(1);
  }

  const results = {
    highlights: await duplicateCollection('model_highlights',      source.id, target.id, 'Highlights (tech-grid karty)'),
    ext:        await duplicateCollection('model_color_exterior',  source.id, target.id, 'Barvy exteriér'),
    int:        await duplicateCollection('model_color_interior',  source.id, target.id, 'Barvy interiér'),
  };

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hotovo');
  console.log(`  Highlights:     ${results.highlights.copied} vytvořeno, ${results.highlights.skipped} přeskočeno`);
  console.log(`  Barvy exteriér: ${results.ext.copied} vytvořeno, ${results.ext.skipped} přeskočeno`);
  console.log(`  Barvy interiér: ${results.int.copied} vytvořeno, ${results.int.skipped} přeskočeno`);
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
