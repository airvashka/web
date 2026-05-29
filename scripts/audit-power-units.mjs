#!/usr/bin/env node
/**
 * Audit jednotek výkonu — kde je výkon v koních (k) místo kW.
 * Primárně models.hero_stats (to se zobrazuje na /model), technical_data je bonus
 * (když k němu účet nemá práva, přeskočí se). READ-ONLY, nic nemění.
 * Použití: cd web && node scripts/audit-power-units.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';
async function get(path) {
  const r = await fetch(`${URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j?.data, errors: j?.errors };
}

function rows(td) {
  if (!td) return [];
  if (Array.isArray(td)) return td.map((r) => Array.isArray(r) ? r : [r.label ?? r.title ?? r.k ?? r.name ?? '', String(r.value ?? r.v ?? '')]).filter(([k]) => k);
  if (typeof td === 'object') return Object.entries(td).map(([k, v]) => [k, String(v)]);
  return [];
}
const isPower = (label) => /výkon/i.test(label || '');
function flagUnit(value) {
  const v = String(value); const low = v.toLowerCase();
  if (!/\d/.test(v)) return null;
  const hasKW = low.includes('kw');
  if (hasKW && v.includes('/')) return 'MIX (kW i kone)';
  if (!hasKW) return 'BEZ kW (nejspis kone)';
  return null;
}

async function run() {
  URL = (await prompt('Directus URL [https://admin.sfr-motor.cz]: ')).trim() || 'https://admin.sfr-motor.cz';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  const authRes = await fetch(`${URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const auth = await authRes.json();
  if (!authRes.ok) throw new Error('Login selhal: ' + JSON.stringify(auth?.errors ?? auth));
  TOKEN = auth.data.access_token;

  // Zkus s technical_data; když 403/chybí, vynech ho
  let withTd = true;
  let res = await get('/items/models?limit=-1&fields=slug,name,fuel_type,hero_stats,technical_data');
  if (!res.ok) {
    console.log('  (technical_data nedostupné: ' + (res.errors?.[0]?.message?.slice(0, 60) || res.status) + ') — jedu jen hero_stats\n');
    withTd = false;
    res = await get('/items/models?limit=-1&fields=slug,name,fuel_type,hero_stats');
  }
  if (!res.ok) throw new Error('Nelze načíst models: ' + JSON.stringify(res.errors ?? res.status));
  const models = res.data;

  const flagged = [];
  console.log('=== Vykon napric modely (hero_stats' + (withTd ? ' + technical_data' : '') + ') ===\n');
  for (const m of models) {
    const hs = Array.isArray(m.hero_stats) ? m.hero_stats : [];
    const td = withTd ? rows(m.technical_data) : [];
    const hsPower = hs.filter((s) => isPower(s.label));
    const tdPower = td.filter(([k]) => isPower(k));
    if (!hsPower.length && !tdPower.length) {
      if (hs.length === 0) console.log(`- ${m.slug} (${m.fuel_type || '?'})   [hero_stats PRAZDNE -> auto-extract z technical_data]`);
      continue;
    }
    console.log(`- ${m.slug} (${m.fuel_type || '?'})`);
    for (const s of hsPower) {
      const f = flagUnit(s.value);
      console.log(`    hero_stats: "${s.label}" = "${s.value}"${f ? '   [!] ' + f : ''}`);
      if (f) flagged.push(`${m.slug}  "${s.label}" = "${s.value}"  -> ${f}`);
    }
    for (const [k, v] of tdPower) {
      const f = flagUnit(v);
      console.log(`    tdata:      "${k}" = "${v}"${f ? '   [!] ' + f : ''}`);
    }
  }
  console.log('\n=== K OPRAVE: hero_stats vykon bez kW / mix (to se zobrazuje na webu) ===');
  if (flagged.length) flagged.forEach((f) => console.log('  [!] ' + f));
  else console.log('  (zadne hero_stats v konich - cyste)');
  console.log('\nPozn.: prazdne hero_stats = hero bere auto-extract z technical_data.');
}

run()
  .catch((e) => { console.error('CHYBA:', e.message); process.exitCode = 1; })
  .finally(() => rl.close());
