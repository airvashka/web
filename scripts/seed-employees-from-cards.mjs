#!/usr/bin/env node
/**
 * SFR Motor — Naplnění `employees` collection real daty z vizitek.
 *
 * Hardcoded list 11 zaměstnanců (4 prodej + 7 servis), upsert by email.
 *
 * Pokud zaměstnanec existuje (matched podle email) → UPDATE.
 * Pokud neexistuje → CREATE.
 *
 * Pole `photo` a `business_card_pdf` skript nenastavuje — můžeš si je doplnit
 * ručně v Directus admin (drag&drop).
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   node scripts/seed-employees-from-cards.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const opts = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 400)}`);
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);

/* ──────────── DATA Z VIZITEK ──────────── */

const EMPLOYEES = [
  // ── PRODEJ (SFR Motor s.r.o.) ──
  {
    full_name: 'Michal Hlaváč',
    role: 'Ředitel',
    department: 'management',
    email: 'hlavac@sfr-motor.cz',
    phone: '+420 721 438 916',
    sort: 1,
  },
  {
    full_name: 'Marek Šafarčík',
    role: 'Jednatel',
    department: 'management',
    email: 'safarcik@sfr-motor.cz',
    phone: '+420 774 274 234',
    sort: 2,
  },
  {
    full_name: 'Petr Paseka',
    role: 'Vedoucí prodeje nových vozů',
    department: 'sales',
    email: 'paseka@sfr-motor.cz',
    phone: '+420 771 235 458',
    sort: 10,
  },
  {
    full_name: 'Lukáš Jiránek',
    role: 'Prodejce nových vozů',
    department: 'sales',
    email: 'jiranek@sfr-motor.cz',
    phone: '+420 774 196 589',
    sort: 11,
  },

  // ── SERVIS (SFR Motor servis s.r.o.) ──
  {
    full_name: 'Jiří Hertl',
    role: 'Vedoucí servisu',
    department: 'service',
    email: 'hertl@sfr-motor.cz',
    phone: '+420 602 224 794',
    sort: 20,
  },
  {
    full_name: 'Karel Mařík',
    role: 'Servisní poradce',
    department: 'service',
    email: 'marik@sfr-motor.cz',
    phone: '+420 771 259 323',
    sort: 21,
  },
  {
    full_name: 'Štěpán Záruba',
    role: 'Servisní poradce',
    department: 'service',
    email: 'zaruba@sfr-motor.cz',
    phone: '+420 775 050 375',
    sort: 22,
  },
  {
    full_name: 'Radek Melíšek',
    role: 'Přijímací technik',
    department: 'service',
    email: 'melisek@sfr-motor.cz',
    phone: '+420 606 681 579, +420 286 001 121',
    sort: 23,
  },
  {
    full_name: 'Zdeněk Bursík',
    role: 'Nehody a pojistné události',
    department: 'service',
    email: 'bursik@sfr-motor.cz',
    phone: '+420 602 112 306',
    sort: 24,
  },
  {
    full_name: 'Jiří Patzelt',
    role: 'Prodej náhradních dílů',
    department: 'parts',
    email: 'patzelt@sfr-motor.cz',
    phone: '+420 602 359 966',
    sort: 30,
  },
  {
    full_name: 'Karel Zelenka',
    role: 'Prodej náhradních dílů',
    department: 'parts',
    email: 'zelenka@sfr-motor.cz',
    phone: '+420 608 397 449',
    sort: 31,
  },
];

/* ──────────── EXECUTION ──────────── */

async function findByEmail(email) {
  const r = await api(
    'GET',
    `/items/employees?filter[email][_eq]=${encodeURIComponent(email)}&limit=1&fields=id`,
  );
  return r.data?.[0] ?? null;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Seed employees z vizitek (11 lidí)');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK\n');

  let created = 0, updated = 0, failed = 0;

  for (const emp of EMPLOYEES) {
    try {
      const existing = await findByEmail(emp.email);
      if (existing) {
        await api('PATCH', `/items/employees/${existing.id}`, emp);
        ok(`UPDATED  ${emp.full_name.padEnd(20)}  ${emp.department.padEnd(11)}  ${emp.role}`);
        updated++;
      } else {
        await api('POST', '/items/employees', emp);
        ok(`CREATED  ${emp.full_name.padEnd(20)}  ${emp.department.padEnd(11)}  ${emp.role}`);
        created++;
      }
    } catch (e) {
      warn(`FAILED   ${emp.full_name}: ${e.message}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Hotovo. Vytvořeno ${created}, updated ${updated}, chyb ${failed}.`);
  console.log('');
  console.log('  Pak si v Directus admin → Pracovníci doplň ke každému:');
  console.log('    • photo (portrétová foto)');
  console.log('    • business_card_pdf (vizitka)');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`\n✗ ${e.message}\n`); rl.close(); process.exit(1); });
