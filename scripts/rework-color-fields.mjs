#!/usr/bin/env node
/**
 * SFR Motor — rework color_options + interior_options fields.
 *
 * Cíl: admin přidá `Foto` (file upload) + `Popisek` → to se zobrazí.
 * Vše ostatní (code, hex, type, material) zachovat jako advanced fields,
 * ale top priority dát photo + name.
 *
 * Kroky:
 *   1) PATCH model_years.color_options s novou strukturou (priority: photo_file, name)
 *   2) PATCH model_years.interior_options
 *   3) Auto-fill: pro každý model_year zkopírovat existující swatch_file → photo_file
 *      (aby admin viděl současné UUIDs jako preset a mohl upravit)
 *
 * Použití:
 *   cd web && node scripts/rework-color-fields.mjs
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

// ===== Schema definitions =====

const EXTERIOR_FIELDS = [
  {
    field: 'photo_file',
    type: 'uuid',
    name: 'Foto barvy',
    meta: {
      interface: 'file-image',
      special: ['file'],
      width: 'half',
      note: 'Foto karoserie v dané barvě (nebo barevný swatch). Tato fotka se zobrazí na webu.',
    },
  },
  {
    field: 'name',
    type: 'string',
    name: 'Popisek',
    meta: {
      interface: 'input',
      width: 'half',
      note: 'Název barvy, např. "Bílá perleťová" nebo "Grand bílá"',
    },
  },
  {
    field: 'hex',
    type: 'string',
    name: 'Hex (fallback)',
    meta: {
      interface: 'input',
      width: 'half',
      note: 'Volitelně. Pokud foto chybí, zobrazí se barva jako kolečko v této barvě.',
    },
  },
  {
    field: 'type',
    type: 'string',
    name: 'Typ',
    meta: {
      interface: 'select-dropdown',
      width: 'half',
      options: {
        choices: [
          { text: 'V ceně (základní)', value: 'základní' },
          { text: 'Metalíza (příplatek)', value: 'metalíza' },
          { text: 'Perleť (příplatek)', value: 'perleť' },
        ],
      },
      note: 'Označení jak se barva platí.',
    },
  },
];

const INTERIOR_FIELDS = [
  {
    field: 'photo_file',
    type: 'uuid',
    name: 'Foto interiéru',
    meta: {
      interface: 'file-image',
      special: ['file'],
      width: 'half',
      note: 'Velká fotka interiéru (16:9 landscape ideal). Tato fotka se zobrazí na webu.',
    },
  },
  {
    field: 'name',
    type: 'string',
    name: 'Popisek',
    meta: {
      interface: 'input',
      width: 'half',
      note: 'Název interiéru, např. "Černá kůže (standardní)"',
    },
  },
  {
    field: 'material',
    type: 'string',
    name: 'Materiál',
    meta: {
      interface: 'input',
      width: 'half',
      note: 'Volitelně. Materiál, např. "pravá kůže", "textil", "syntetická kůže"',
    },
  },
  {
    field: 'hex',
    type: 'string',
    name: 'Hex (fallback)',
    meta: {
      interface: 'input',
      width: 'half',
      note: 'Volitelně. Pokud foto chybí.',
    },
  },
];

async function patchField(collection, field, isExterior) {
  const fields = isExterior ? EXTERIOR_FIELDS : INTERIOR_FIELDS;
  const note = isExterior
    ? 'Barvy karoserie. Přidej položku — nahraj foto barvy + napiš popisek. Co zde naklikáš, to se zobrazí na webu jako kolečko.'
    : 'Barvy / typy interiéru. Přidej položku — nahraj foto interiéru + napiš popisek. Co zde naklikáš, to se zobrazí na webu jako velká karta.';

  await api('PATCH', `/fields/${collection}/${field}`, {
    field,
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      hidden: false,
      readonly: false,
      width: 'full',
      note,
      options: {
        template: '{{name}}',
        addLabel: 'Přidat barvu',
        fields,
      },
    },
  });
  ok(`${collection}.${field} schema updated (${isExterior ? 'exterior' : 'interior'})`);
}

async function findAllModelYears() {
  const r = await api('GET', '/items/model_years?limit=200&fields=id,year,model,color_options,interior_options');
  return r?.data ?? [];
}

async function autoFillPhotoFile(modelYears) {
  console.log('Krok 3: Auto-fill photo_file z existujících swatch_file');
  let updated = 0, skipped = 0;
  for (const my of modelYears) {
    const patch = {};

    if (Array.isArray(my.color_options) && my.color_options.length > 0) {
      const updatedExt = my.color_options.map((c) => ({
        ...c,
        // photo_file ← swatch_file (pokud chybí)
        photo_file: c.photo_file ?? c.swatch_file ?? null,
      }));
      patch.color_options = updatedExt;
    }

    if (Array.isArray(my.interior_options) && my.interior_options.length > 0) {
      const updatedInt = my.interior_options.map((c) => ({
        ...c,
        // photo_file ← preview_file (velký) > swatch_file (malý)
        photo_file: c.photo_file ?? c.preview_file ?? c.swatch_file ?? null,
      }));
      patch.interior_options = updatedInt;
    }

    if (Object.keys(patch).length === 0) {
      skipped++;
      continue;
    }

    try {
      await api('PATCH', `/items/model_years/${my.id}`, patch);
      ok(`  model_year ${my.year} (id ${my.id}): photo_file auto-filled`);
      updated++;
    } catch (e) {
      warn(`  model_year ${my.id}: ${e.message}`);
    }
  }
  return { updated, skipped };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Rework color_options + interior_options');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // 1) Schema
  console.log('Krok 1: Schema color_options');
  await patchField('model_years', 'color_options', true);
  console.log('');
  console.log('Krok 2: Schema interior_options');
  await patchField('model_years', 'interior_options', false);
  console.log('');

  // 3) Auto-fill
  const modelYears = await findAllModelYears();
  const result = await autoFillPhotoFile(modelYears);
  console.log('');

  console.log('═══════════════════════════════════════════════');
  console.log(`  Hotovo. Auto-filled: ${result.updated}, Skipped: ${result.skipped}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus (Ctrl+Shift+R refresh):');
  console.log('  model_years → vyber rok → "Color Options" / "Interior Options"');
  console.log('  • U každé položky je teď nahoře "Foto barvy" (file picker)');
  console.log('  • + "Popisek" — to co napíšeš, to se zobrazí na webu');
  console.log('  • Hex + Typ + Materiál jsou volitelné (legacy / fallback)');
  console.log('');
  console.log('Pak npm run build a uvidíš změnu na /model/{slug}.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
