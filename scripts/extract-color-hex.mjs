#!/usr/bin/env node
/**
 * Extrakce barev ze swatch PNG (Directus) -> hex / hex2 v model_color_exterior.
 * Stáhne swatch (fallback photo), přes sharp určí dominantní 1-2 barvy (dvoutón).
 *
 *   node scripts/extract-color-hex.mjs           # DRY-RUN (jen vypíše návrhy)
 *   node scripts/extract-color-hex.mjs --apply   # zapíše hex/hex2 do Directu
 *   node scripts/extract-color-hex.mjs --force    # přepíše i barvy co už hex mají
 *
 * Vyžaduje: běžet v ./web (kvůli sharp z node_modules) + admin login.
 */
import sharp from 'sharp';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

let URL = '', TOKEN = '';
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j.data;
}
async function assetBuffer(uuid) {
  const r = await fetch(`${URL}/assets/${uuid}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`asset ${uuid} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function toHex(o) { return '#' + [o.r, o.g, o.b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('').toUpperCase(); }

async function colorsFromBuffer(buf) {
  const size = 64;
  const { data, info } = await sharp(buf).resize(size, size, { fit: 'cover', position: 'center' }).flatten({ background: { r: 255, g: 255, b: 255 } }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const lo = Math.floor(size * 0.2), hi = Math.ceil(size * 0.8);
  const buckets = new Map();
  let total = 0;
  for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) {
    const idx = (y * size + x) * ch;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
    let e = buckets.get(key); if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
    e.n++; e.r += r; e.g += g; e.b += b; total++;
  }
  if (!total) return { hex: null, hex2: null };
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const avg = (e) => ({ r: Math.round(e.r / e.n), g: Math.round(e.g / e.n), b: Math.round(e.b / e.n) });
  const c1 = avg(sorted[0]);
  let c2 = null;
  for (let i = 1; i < sorted.length; i++) {
    const cand = avg(sorted[i]);
    const dist = Math.abs(cand.r - c1.r) + Math.abs(cand.g - c1.g) + Math.abs(cand.b - c1.b);
    if (sorted[i].n / total > 0.18 && dist > 100) { c2 = cand; break; }
  }
  return { hex: toHex(c1), hex2: c2 ? toHex(c2) : null };
}

async function ensureHex2Field() {
  try { await api('GET', '/fields/model_color_exterior/hex2'); return; } catch {}
  await api('POST', '/fields/model_color_exterior', {
    field: 'hex2', type: 'string',
    meta: { interface: 'input', width: 'half', note: 'Druhá barva (dvoutón) — auto z extrakce swatche.' },
    schema: {},
  });
  console.log('  (vytvořeno pole model_color_exterior.hex2)');
}

async function run() {
  URL = (await prompt('Directus URL [https://admin.sfr-motor.cz]: ')).trim() || 'https://admin.sfr-motor.cz';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  const ar = await fetch(`${URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const auth = await ar.json();
  if (!ar.ok) throw new Error('Login selhal: ' + JSON.stringify(auth?.errors ?? auth));
  TOKEN = auth.data.access_token;

  if (APPLY) await ensureHex2Field();

  const colors = await api('GET', '/items/model_color_exterior?limit=-1&fields=id,name,hex,swatch,photo');
  console.log(`\nNačteno ${colors.length} barev. Režim: ${APPLY ? 'APPLY (zápis)' : 'DRY-RUN'}${FORCE ? ' +force' : ''}\n`);
  let done = 0, skip = 0, fail = 0;
  for (const c of colors) {
    const asset = c.swatch || c.photo;
    if (!asset) { console.log(`- ${c.name}: bez swatche/foto -> preskok`); skip++; continue; }
    if (c.hex && !FORCE) { console.log(`- ${c.name}: uz ma hex ${c.hex}${c.hex2 ? '/' + c.hex2 : ''} -> preskok (--force pro prepis)`); skip++; continue; }
    try {
      const buf = await assetBuffer(asset);
      const { hex, hex2 } = await colorsFromBuffer(buf);
      console.log(`- ${c.name}: ${hex}${hex2 ? '  +  ' + hex2 + '  (dvouton)' : ''}`);
      if (APPLY && hex) { await api('PATCH', `/items/model_color_exterior/${c.id}`, { hex, hex2: hex2 ?? null }); done++; }
    } catch (e) { console.log(`- ${c.name}: CHYBA ${e.message}`); fail++; }
  }
  console.log(`\nHotovo. ${APPLY ? 'Zapsano: ' + done : 'Navrhy vyse (DRY-RUN)'} | preskoceno: ${skip} | chyby: ${fail}`);
  if (!APPLY) console.log('Pro zapis spust znovu s  --apply  (a --force kdyz chces prepsat existujici hex).');
}
run().catch((e) => { console.error('CHYBA:', e.message); process.exitCode = 1; }).finally(() => rl.close());
