#!/usr/bin/env node
/**
 * Quick fix: interior_color_ref template byl Mustache section syntax
 * ({{#material}}…{{/material}}) což Directus nepodporuje a házelo FORBIDDEN
 * na neexistující "#material" a "/material" pole.
 *
 * Fix: prostý "{{name}}" template.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

async function main() {
  const URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();

  const authR = await fetch(`${URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { data } = await authR.json();
  const TOKEN = data.access_token;

  // Načti stávající meta
  const curR = await fetch(`${URL}/fields/stock_vehicles/interior_color_ref`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const cur = await curR.json();
  const meta = cur.data?.meta ?? {};

  // Patch jen template
  const patchR = await fetch(`${URL}/fields/stock_vehicles/interior_color_ref`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      meta: {
        ...meta,
        options: {
          ...(meta.options ?? {}),
          template: '{{name}}',
          filter: { model: { _eq: '{{model}}' } },
        },
      },
    }),
  });
  if (!patchR.ok) {
    console.error('Patch selhal:', await patchR.text());
    process.exit(1);
  }
  console.log('✓ interior_color_ref template → "{{name}}" (Ctrl+Shift+R v adminu)');
  rl.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
