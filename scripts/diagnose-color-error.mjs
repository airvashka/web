#!/usr/bin/env node
/**
 * SFR Motor — diagnose "model: Value can't be null" při save modelu.
 *
 * Vypíše:
 *   1) Field config model_color_exterior.model
 *   2) Relation config model_color_exterior.model → models
 *   3) Field config models.color_exterior (alias)
 *   4) Sample records z model_color_exterior (jejich model FK)
 *   5) Pokus o vytvoření test record přes API (uvidíme jaký error skutečně přijde)
 *
 * Použití:
 *   cd web && node scripts/diagnose-color-error.mjs
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
  return { ok: r.ok, status: r.status, body: j };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Diagnose color error');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.body.data.access_token;
  console.log('✓ Auth OK\n');

  // 1) Field model_color_exterior.model
  console.log('═══ 1) Field model_color_exterior.model ═══');
  const f1 = await api('GET', '/fields/model_color_exterior/model');
  console.log(JSON.stringify(f1.body?.data, null, 2));

  // 2) Relation
  console.log('\n═══ 2) Relation model_color_exterior.model → models ═══');
  const r1 = await api('GET', '/relations/model_color_exterior/model');
  console.log(JSON.stringify(r1.body?.data, null, 2));

  // 3) Alias models.color_exterior
  console.log('\n═══ 3) Field models.color_exterior (alias) ═══');
  const f2 = await api('GET', '/fields/models/color_exterior');
  console.log(JSON.stringify(f2.body?.data, null, 2));

  // 4) Sample 3 records s model FK
  console.log('\n═══ 4) Sample records (prvních 5) ═══');
  const samples = await api('GET', '/items/model_color_exterior?limit=5&fields=id,name,model,photo');
  console.log(JSON.stringify(samples.body?.data, null, 2));

  // 5) Najdi Actyon model_id
  const actyon = await api('GET', '/items/models?filter[slug][_eq]=actyon&limit=1&fields=id,slug,name');
  const actyonId = actyon.body?.data?.[0]?.id;
  console.log(`\nActyon model_id: ${actyonId}`);

  // 6) Pokus o vytvoření nového records via direct POST (bez model)
  console.log('\n═══ 5) Test POST nový record BEZ model field ═══');
  const test1 = await api('POST', '/items/model_color_exterior', {
    name: 'TEST_DIAGNOSE_DELETE_ME',
  });
  console.log(`Status: ${test1.status}`);
  console.log(JSON.stringify(test1.body, null, 2));

  // 7) Pokud první uspěl, smaž ho
  if (test1.ok && test1.body?.data?.id) {
    await api('DELETE', `/items/model_color_exterior/${test1.body.data.id}`);
    console.log(`(test record id=${test1.body.data.id} smazán)`);
  }

  // 8) Pokus o PATCH modelu s embedded create
  console.log('\n═══ 6) Test PATCH model s embedded O2M create ═══');
  if (actyonId) {
    const test2 = await api('PATCH', `/items/models/${actyonId}`, {
      color_exterior: {
        create: [{ name: 'TEST_EMBEDDED_DELETE_ME' }],
        update: [],
        delete: [],
      },
    });
    console.log(`Status: ${test2.status}`);
    console.log(JSON.stringify(test2.body, null, 2));

    // Cleanup
    if (test2.ok) {
      const test3 = await api('GET', `/items/model_color_exterior?filter[name][_eq]=TEST_EMBEDDED_DELETE_ME&limit=10&fields=id`);
      for (const r of test3.body?.data ?? []) {
        await api('DELETE', `/items/model_color_exterior/${r.id}`);
      }
      console.log(`(test records smazány)`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Pošli mi tento celý output, pak budu vědět co je špatně.');
  console.log('═══════════════════════════════════════════════');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
