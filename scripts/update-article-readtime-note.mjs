#!/usr/bin/env node
/**
 * Přidá note (oranžová nápověda v adminu) k článkům — pole `read_time`:
 *   "Necháš-li prázdné, čas čtení se automaticky spočítá z body textu."
 *
 * Použití:
 *   node scripts/update-article-readtime-note.mjs
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
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}

async function main() {
  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  console.log('✅ Auth OK\n');

  const cur = await api('GET', '/fields/articles/read_time');
  const meta = (cur.data ?? cur).meta ?? {};
  await api('PATCH', '/fields/articles/read_time', {
    meta: {
      ...meta,
      note: 'Necháš-li prázdné, čas čtení se automaticky spočítá z body textu (200 slov/min). Vyplň jen pokud chceš override (např. "8 min").',
      translations: [
        ...(Array.isArray(meta.translations) ? meta.translations.filter((t) => t?.language !== 'cs-CZ') : []),
        { language: 'cs-CZ', translation: 'Čas čtení (auto)' },
      ],
    },
  });
  console.log('✅ Pole `read_time` v collection articles updatováno (cs-CZ label + note).');
  rl.close();
}

main().catch((e) => { console.error(`✗ ${e.message}`); rl.close(); process.exit(1); });
