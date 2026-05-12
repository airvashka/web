#!/usr/bin/env node
/**
 * Přidá filtrovatelné atributy na stock_vehicles:
 *   - transmission (manuál / automat / DCT / CVT / DHT)
 *   - drivetrain (FWD / AWD / 4WD / RWD)
 *   - color_category (bílá / černá / šedá / ...)
 *
 * Tyto pole pohánějí filtry skladovky bez nutnosti canonical features.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let DIRECTUS_URL = '', TOKEN = '';
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) {
    const e = new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
    e.status = r.status; throw e;
  }
  return j;
}

const FIELDS = [
  {
    field: 'transmission',
    type: 'string',
    meta: {
      interface: 'select-dropdown',
      width: 'half',
      note: 'Typ převodovky (pro filtr skladovky)',
      options: {
        choices: [
          { text: 'Manuální', value: 'manual' },
          { text: 'Automatická', value: 'automatic' },
          { text: 'DCT (dvouspojková)', value: 'dct' },
          { text: 'CVT (variátor)', value: 'cvt' },
          { text: 'DHT (hybridní)', value: 'dht' },
          { text: 'Redukční (EV)', value: 'reduction' },
        ],
      },
    },
    schema: { is_nullable: true, max_length: 50 },
  },
  {
    field: 'drivetrain',
    type: 'string',
    meta: {
      interface: 'select-dropdown',
      width: 'half',
      note: 'Typ pohonu',
      options: {
        choices: [
          { text: 'Přední pohon (FWD)', value: 'fwd' },
          { text: 'Zadní pohon (RWD)', value: 'rwd' },
          { text: 'Pohon všech kol (AWD)', value: 'awd' },
          { text: 'Pohon 4×4 (4WD)', value: '4wd' },
        ],
      },
    },
    schema: { is_nullable: true, max_length: 20 },
  },
  {
    field: 'color_category',
    type: 'string',
    meta: {
      interface: 'select-dropdown',
      width: 'half',
      note: 'Kategorie barvy pro filtr (specifický kód je v color_code)',
      options: {
        choices: [
          { text: 'Bílá', value: 'white' },
          { text: 'Černá', value: 'black' },
          { text: 'Šedá', value: 'gray' },
          { text: 'Stříbrná', value: 'silver' },
          { text: 'Modrá', value: 'blue' },
          { text: 'Červená', value: 'red' },
          { text: 'Zelená', value: 'green' },
          { text: 'Žlutá', value: 'yellow' },
          { text: 'Oranžová', value: 'orange' },
          { text: 'Hnědá / Béžová', value: 'brown' },
          { text: 'Jiná', value: 'other' },
        ],
      },
    },
    schema: { is_nullable: true, max_length: 30 },
  },
];

async function main() {
  DIRECTUS_URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim() || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  const auth = await fetch(`${DIRECTUS_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json());
  TOKEN = auth.data.access_token;
  console.log('✅ Auth OK\n');

  for (const f of FIELDS) {
    try {
      // Existuje?
      const existing = await api('GET', `/fields/stock_vehicles/${f.field}`).catch(() => null);
      if (existing?.data) {
        console.log(`⏭️   ${f.field} už existuje`);
        continue;
      }
      await api('POST', '/fields/stock_vehicles', f);
      console.log(`✅  ${f.field} (${f.meta.options.choices.length} voleb)`);
    } catch (e) {
      if (e.status === 400 && e.message.includes('exists')) {
        console.log(`⏭️   ${f.field} už existuje`);
      } else {
        console.log(`❌  ${f.field}: ${e.message}`);
      }
    }
  }

  console.log('\nHotovo. Po refresh adminu uvidíš v Stock Vehicles 3 nové dropdowny.');
  rl.close();
}
main().catch(e => { console.log(`❌ ${e.message}`); rl.close(); });
