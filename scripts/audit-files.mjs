/**
 * audit-files.mjs — READ-ONLY audit souboru v Directusu.
 *
 * Zjisti pres /relations VSECHNY vazby mirici na directus_files
 * (auta, modely, znacky, stranky, clanky, nastaveni, avatary...),
 * sesbira pouzite file ID a porovna s kompletnim seznamem souboru.
 * Vypise: celkem souboru/velikost, pouzite, orphany (po slozkach).
 *
 * NIC NEMAZE. Slouzi jen k rozhodnuti, co je bezpecne smazat.
 *
 * Pouziti:  cd web && node scripts/audit-files.mjs [--list-orphans]
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const args = process.argv.slice(2);
const LIST_ORPHANS = args.includes('--list-orphans');

let DIRECTUS_URL = '', TOKEN = '', EMAIL = '', PASSWORD = '';
const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);
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
  if (!r.ok) throw new Error(`login -> ${r.status}: ${JSON.stringify(j?.errors ?? j)}`);
  TOKEN = j.data.access_token;
}

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function pushId(set, v) {
  if (!v) return;
  if (isUuid(v)) set.add(v);
  else if (typeof v === 'object' && isUuid(v.id)) set.add(v.id);
}

async function main() {
  console.log('\n=== Audit souboru (READ-ONLY) ===\n');
  DIRECTUS_URL = (await prompt('Directus URL [https://sfr-motor-directus.onrender.com]: ')).trim() || 'https://sfr-motor-directus.onrender.com';
  EMAIL = (await prompt('Admin email: ')).trim();
  PASSWORD = (await prompt('Admin heslo: ')).trim();
  console.log('');
  await login(); ok('Auth OK');

  // 1) Vsechny relace mirici na directus_files
  const rel = await api('GET', '/relations');
  const fileRels = (rel.data ?? []).filter((r) => r.related_collection === 'directus_files');
  ok(`Nalezeno ${fileRels.length} vazeb na soubory`);

  const used = new Set();

  // 2) Pro kazdou vazbu posbirej pouzite ID
  for (const r of fileRels) {
    const c = r.collection, f = r.field;
    try {
      if (c === 'directus_settings') {
        const s = await api('GET', `/settings?fields=${f}`);
        pushId(used, s.data?.[f]);
      } else if (c === 'directus_users') {
        const u = await api('GET', `/users?limit=-1&fields=${f}`);
        for (const row of (u.data ?? [])) pushId(used, row[f]);
      } else if (c.startsWith('directus_')) {
        warn(`  systemova vazba ${c}.${f} — preskakuji (povazuji za pouzite)`);
        // konzervativne: nemazat nic z techto, ale neumime snadno cist -> jen upozorneni
      } else {
        const rows = await api('GET', `/items/${c}?limit=-1&fields=${f}`);
        // singleton vraci objekt, kolekce vraci pole -> sjednotit
        const data = rows.data;
        const arr = Array.isArray(data) ? data : (data ? [data] : []);
        let n = 0;
        for (const row of arr) { const before = used.size; pushId(used, row[f]); n += used.size - before; }
        info(`  ${c}.${f}: +${n} ref`);
      }
    } catch (e) { warn(`  ${c}.${f} preskoceno: ${e.message}`); }
  }

  // 3) Vsechny soubory
  const filesRes = await api('GET', '/files?limit=-1&fields=id,filename_download,filesize,folder.name,folder.id');
  const files = filesRes.data ?? [];

  let totalBytes = 0, orphanBytes = 0;
  const byFolder = {};   // folderName -> { total, used, orphan, orphanBytes }
  const orphanList = [];

  for (const file of files) {
    const sz = Number(file.filesize) || 0;
    totalBytes += sz;
    const folder = file.folder?.name ?? '(bez slozky)';
    byFolder[folder] ??= { total: 0, used: 0, orphan: 0, bytes: 0, orphanBytes: 0 };
    byFolder[folder].total++;
    byFolder[folder].bytes += sz;
    if (used.has(file.id)) byFolder[folder].used++;
    else {
      byFolder[folder].orphan++;
      byFolder[folder].orphanBytes += sz;
      orphanBytes += sz;
      orphanList.push({ id: file.id, name: file.filename_download, folder, sz });
    }
  }

  const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
  console.log('\n=== SOUHRN ===');
  console.log(`  Souboru celkem: ${files.length}  (${mb(totalBytes)})`);
  console.log(`  Pouzitych:      ${files.length - orphanList.length}`);
  console.log(`  Orphan:         ${orphanList.length}  (${mb(orphanBytes)})  <- bezpecne smazat`);

  console.log('\n=== PO SLOZKACH ===');
  const folders = Object.entries(byFolder).sort((a, b) => b[1].orphan - a[1].orphan);
  for (const [name, s] of folders) {
    console.log(`  ${name}`);
    console.log(`     celkem ${s.total} (${mb(s.bytes)})  |  pouzito ${s.used}  |  orphan ${s.orphan} (${mb(s.orphanBytes)})`);
  }

  if (LIST_ORPHANS && orphanList.length) {
    console.log('\n=== ORPHAN SOUBORY (prvnich 200) ===');
    for (const o of orphanList.slice(0, 200)) console.log(`  ${o.folder}  |  ${o.name}  |  ${o.id}`);
    if (orphanList.length > 200) console.log(`  ... a dalsich ${orphanList.length - 200}`);
  } else if (orphanList.length) {
    console.log('\n  (spust s --list-orphans pro vypis konkretnich souboru)');
  }
  console.log('');
  rl.close();
}

main().catch((e) => { console.error(`X ${e.message}`); rl.close(); process.exit(1); });
