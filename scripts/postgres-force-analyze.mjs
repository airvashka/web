#!/usr/bin/env node
/**
 * FORCE ANALYZE — explicitní ANALYZE každé user tabulky.
 *
 * Důvod: `VACUUM ANALYZE;` bez table list někdy skipne tabulky (locked,
 * read-only state, atd.). Tento skript vyjmenuje VŠECHNY user tabulky
 * a spustí ANALYZE na každé zvlášť. Garantuje refresh statistik.
 *
 * Použití (přes Railway CLI, injektuje DATABASE_URL):
 *   railway run --service PostGIS node scripts/postgres-force-analyze.mjs
 */
import pg from 'pg';

const url = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;
if (!url) {
  console.error('❌ DATABASE_URL nenastaveno');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  console.log('✅ Připojeno.\n');

  // Najdi všechny user tabulky (žádné system/pg_* tabulky)
  const tables = await client.query(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY tablename;
  `);

  console.log(`Nalezeno ${tables.rows.length} tabulek. Spouštím ANALYZE per tabulku...\n`);

  const t0 = Date.now();
  let ok = 0;
  let fail = 0;
  for (const row of tables.rows) {
    const fullName = `"${row.schemaname}"."${row.tablename}"`;
    try {
      const t1 = Date.now();
      await client.query(`ANALYZE ${fullName};`);
      const dt = Date.now() - t1;
      console.log(`  ✓ ${row.tablename.padEnd(40)} ${dt}ms`);
      ok++;
    } catch (e) {
      console.log(`  ✗ ${row.tablename.padEnd(40)} ERROR: ${e.message}`);
      fail++;
    }
  }
  const total = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDokončeno za ${total}s. OK: ${ok}, chyby: ${fail}`);

  // Po ANALYZE — ověřit row counts
  console.log('\n▶ Skutečné row counts (po ANALYZE):');
  const stats = await client.query(`
    SELECT relname, n_live_tup, last_analyze
    FROM pg_stat_user_tables
    WHERE n_live_tup > 0 OR relname IN ('models','brands','stock_vehicles','employees','trim_levels','model_years')
    ORDER BY n_live_tup DESC
    LIMIT 30;
  `);
  console.table(stats.rows.map((r) => ({
    table: r.relname,
    rows: r.n_live_tup,
    lastAnalyze: r.last_analyze?.toISOString?.()?.slice(11, 19) ?? 'nikdy',
  })));

  console.log('\n═══ Hotovo ═══');
  console.log('Pokud teď vidíš real row counts (ne 0), ANALYZE proběhl.');
  console.log('Pokud `lastAnalyze` ukazuje aktuální čas, statistiky jsou fresh.');
  console.log('Otestuj build.');
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
