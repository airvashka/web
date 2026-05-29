#!/usr/bin/env node
/**
 * Přidá volbu "Manuál" (value: manual) do číselníku pole model_documents.type.
 * Idempotentní — když už volba existuje, nic nemění.
 * Použití: cd web && node scripts/add-manual-doc-type.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);
let URL = '', TOKEN = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

const MANUAL = { text: 'Manuál', value: 'manual' };
const MANUAL_DISP = { text: 'Manuál', value: 'manual', foreground: '#FFFFFF', background: '#5B4B8A' };

function addBeforeOther(arr, item) {
  arr = Array.isArray(arr) ? arr.slice() : [];
  if (arr.some((c) => c && c.value === item.value)) return { arr, added: false };
  const idx = arr.findIndex((c) => c && c.value === 'other');
  if (idx >= 0) arr.splice(idx, 0, item); else arr.push(item);
  return { arr, added: true };
}

async function main() {
  URL = (await prompt('Directus URL [https://admin.sfr-motor.cz]: ')).trim() || 'https://admin.sfr-motor.cz';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  const authRes = await fetch(`${URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const auth = await authRes.json();
  if (!authRes.ok) throw new Error('Login selhal: ' + JSON.stringify(auth?.errors ?? auth));
  TOKEN = auth.data.access_token;

  const field = await api('GET', '/fields/model_documents/type');
  const meta = field.data.meta ?? {};
  const options = meta.options ?? {};
  const display_options = meta.display_options ?? {};

  const c1 = addBeforeOther(options.choices, MANUAL);
  const c2 = addBeforeOther(display_options.choices, MANUAL_DISP);

  if (!c1.added && !c2.added) {
    console.log('i  Manuál už v číselníku je — nic neměním.');
    rl.close(); return;
  }
  options.choices = c1.arr;
  display_options.choices = c2.arr;
  await api('PATCH', '/fields/model_documents/type', { meta: { options, display_options } });
  console.log('OK  Přidáno: Manuál (value=manual) do model_documents.type');
  rl.close();
}
main().catch((e) => { console.error('CHYBA:', e.message); process.exit(1); });
