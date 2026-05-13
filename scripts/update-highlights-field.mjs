#!/usr/bin/env node
/**
 * SFR Motor — update models.highlights field s file picker.
 *
 * Změny:
 *   - Přidá nested field `photo_file` (interface: file-image) → admin uploadne přímo
 *   - Zachová `photo` (string filename) jako legacy/fallback referenci
 *   - Force update meta.hidden=false / sort=200 (pro jistotu)
 *
 * Použití:
 *   cd web && node scripts/update-highlights-field.mjs
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

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Update models.highlights — file picker + bez limitu');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  // PATCH highlights field meta s rozšířenou strukturou
  const fieldDef = {
    field: 'highlights',
    type: 'json',
    schema: { is_nullable: true },
    meta: {
      interface: 'list',
      special: ['cast-json'],
      hidden: false,
      readonly: false,
      sort: 200,
      width: 'full',
      note: 'Tech highlights pro sekci "Technologie" na detailu modelu. Doporučeno 4 nebo 8 položek (vejde se pěkně do gridu). Bez limitu — vše se zobrazí.',
      options: {
        template: '{{title}}',
        addLabel: 'Přidat highlight',
        fields: [
          {
            field: 'title',
            type: 'string',
            name: 'Titulek',
            meta: { interface: 'input', width: 'half', note: 'Krátký název, např. "Pohon 4×4"' },
          },
          {
            field: 'subtitle',
            type: 'string',
            name: 'Popis',
            meta: { interface: 'input', width: 'half', note: 'Jedna věta podrobnosti' },
          },
          {
            field: 'photo_file',
            type: 'uuid',
            name: 'Foto upload',
            meta: {
              interface: 'file-image',
              special: ['file'],
              width: 'half',
              note: 'Nahraj fotku přímo (priority field — má přednost před filename).',
            },
          },
          {
            field: 'photo',
            type: 'string',
            name: 'Foto filename (legacy)',
            meta: {
              interface: 'input',
              width: 'half',
              note: 'Volitelně: filename z brožury (img-pXXX-YY.jpg). Použije se jen pokud Foto upload chybí.',
            },
          },
        ],
      },
    },
  };

  await api('PATCH', '/fields/models/highlights', fieldDef);
  ok('models.highlights updated — přidán photo_file (file picker) + bez limitu\n');

  console.log('═══════════════════════════════════════════════');
  console.log('  Hotovo!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('V adminu Directus (Ctrl+Shift+R refresh):');
  console.log('  models → Torres EVX → Highlights');
  console.log('  • U každého řádku přibyl "Foto upload" — file picker.');
  console.log('  • Můžeš nahrát z PC nebo vybrat z existujících files.');
  console.log('  • "Foto filename" zůstává jako legacy (filename z brožury).');
  console.log('');
  console.log('Doporučení: dej 4 nebo 8 highlights pro hezký grid layout.');
  console.log('Pokud dáš víc (např. 6), vše se zobrazí v auto-fit gridu.\n');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
