/**
 * cleanup-orphans.mjs — smaze ORPHAN soubory v jedne slozce (throttled).
 *
 * Bezpecnostni pojistky:
 *   - pred mazanim si CERSTVE spocita "pouzite" soubory (pres /relations),
 *     takze nikdy nesmaze nic, co je na neco napojene
 *   - maze jen soubory ve zvolene slozce, ktere jsou orphan
 *   - throttle 250 ms/soubor -> R2 nedostane 429, Render nespadne
 *   - default DRY-RUN; realne mazani az s --confirm
 *
 * Pouziti:
 *   node scripts/cleanup-orphans.mjs --folder="Import - OMODA & JAECOO"            # dry-run
 *   node scripts/cleanup-orphans.mjs --folder="Import - OMODA & JAECOO" --confirm  # smaze
 *   ...                                            --confirm --remove-folder        # + smaze prazdnou slozku
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const REMOVE_FOLDER = args.includes('--remove-folder');
const FOLDER_NAME = args.find((a) => a.startsWith('--folder='))?.split('=').slice(1).join('=');
const THROTTLE_MS = 250;

if (!FOLDER_NAME) { console.error('Chybi --folder="Nazev slozky"'); process.exit(1); }

let DIRECTUS_URL = '', TOKEN = '', EMAIL = '', PASSWORD = '';
const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log(`  [ok]  ${m}`);
const info = (m) => console.log(`  [i]   ${m}`);
const warn = (m) => console.log(`  [!]   ${m}`);

async function api(method, path, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}` } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  return j;
}
async function login() {
  const r = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login -> ${r.status}`);
  TOKEN = j.data.access_token;
}
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function pushId(set, v) {
  if (!v) return;
  if (isUuid(v)) set.add(v);
  else if (typeof v === 'object' && isUuid(v.id)) set.add(v.id);
}

async function buildUsedSet() {
  const rel = await api('GET', '/relations');
  const fileRels = (rel.data ?? []).filter((r) => r.related_collection === 'directus_files');
  const used = new Set();
  for (const r of fileRels) {
    const c = r.collection, f = r.field;
    try {
      if (c === 'directus_settings') { const s = await api('GET', `/settings?fields=${f}`); pushId(used, s.data?.[f]); }
      else if (c === 'directus_users') { const u = await api('GET', `/users?limit=-1&fields=${f}`); for (const row of (u.data ?? [])) pushId(used, row[f]); }
      else if (c.startsWith('directus_')) { /* skip system */ }
      else {
        const rows = await api('GET', `/items/${c}?limit=-1&fields=${f}`);
        const data = rows.data; const arr = Array.isArray(data) ? data : (data ? [data] : []);
        for (const row of arr) pushId(used, row[f]);
      }
    } catch (e) { warn(`vazba ${c}.${f} preskocena: ${e.message}`); }
  }
  return used;
}

async function main() {
  console.log(`\n=== Cleanup orphanu ve slozce "${FOLDER_NAME}" ===`);
  console.log(CONFIRM ? '  [REALNE MAZANI]' : '  [DRY-RUN] nic se nesmaze\n');
  DIRECTUS_URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim() || 'https://sfr-motor-directus.onrender.com';
  EMAIL = (await prompt('Admin email: ')).trim();
  PASSWORD = (await prompt('Admin heslo: ')).trim();
  console.log('');
  await login(); ok('Auth OK');

  const fr = await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent(FOLDER_NAME)}&limit=1&fields=id,name`);
  const folder = fr.data?.[0];
  if (!folder) { warn(`Slozka "${FOLDER_NAME}" nenalezena — konec.`); rl.close(); return; }
  ok(`Slozka id=${folder.id}`);

  info('Pocitam pouzite soubory (cerstvy sken vazeb)...');
  const used = await buildUsedSet();
  ok(`Pouzitych souboru celkem: ${used.size}`);

  const filesRes = await api('GET', `/files?filter[folder][_eq]=${folder.id}&limit=-1&fields=id,filename_download,filesize`);
  const files = filesRes.data ?? [];
  const orphans = files.filter((f) => !used.has(f.id));
  const bytes = orphans.reduce((s, f) => s + (Number(f.filesize) || 0), 0);

  console.log(`\n  Souboru ve slozce: ${files.length}`);
  console.log(`  Orphan (smazat):   ${orphans.length}  (${(bytes/1024/1024).toFixed(1)} MB)`);
  console.log(`  Pouzitych (necham): ${files.length - orphans.length}`);

  if (!orphans.length) { info('\nNic k mazani.'); rl.close(); return; }

  if (!CONFIRM) {
    console.log('\n  [DRY-RUN] Pro realne smazani spust znovu s --confirm');
    rl.close(); return;
  }

  console.log('\nMazu (throttle 250 ms)...');
  let del = 0;
  for (const f of orphans) {
    try { await api('DELETE', `/files/${f.id}`); del++; if (del % 20 === 0) info(`  ...smazano ${del}/${orphans.length}`); }
    catch (e) { warn(`  ${f.filename_download} (${f.id}) selhalo: ${e.message}`); }
    await sleep(THROTTLE_MS);
  }
  ok(`Smazano ${del} souboru.`);

  if (REMOVE_FOLDER) {
    const left = await api('GET', `/files?filter[folder][_eq]=${folder.id}&limit=1&fields=id`);
    if ((left.data ?? []).length === 0) { try { await api('DELETE', `/folders/${folder.id}`); ok('Prazdna slozka smazana.'); } catch (e) { warn(`Slozku nelze smazat: ${e.message}`); } }
    else info('Slozka neni prazdna — nechavam.');
  }
  console.log('');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
