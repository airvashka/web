#!/usr/bin/env node
/**
 * Postgres VACUUM ANALYZE — používá DATABASE_URL z env (injected via Railway CLI).
 *
 * Použití (nutné spustit přes Railway CLI, který injektuje DATABASE_URL):
 *   railway run --service PostGIS node scripts/postgres-vacuum-quick.mjs
 */
import pg from 'pg';

const url = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;
if (!url) {
  console.error('❌ DATABASE_URL nenastaveno. Spusť přes: railway run --service PostGIS node scripts/postgres-vacuum-quick.mjs');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

try {
  console.log('Připojuji k Postgres...');
  await client.connect();
  console.log('✅ Připojeno.\n');

  // Stat před VACUUM
  console.log('▶ Top tabulky (řádky / mrtvé / last vacuum):');
  const before = await client.query(`
    SELECT relname, n_live_tup, n_dead_tup,
           CASE WHEN last_analyze IS NULL THEN 'nikdy' ELSE to_char(last_analyze, 'YYYY-MM-DD HH24:MI') END AS last_analyze
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC
    LIMIT 10;
  `);
  console.table(before.rows);

  console.log('\n▶ Spouštím VACUUM ANALYZE...');
  const t0 = Date.now();
  await client.query('VACUUM ANALYZE;');
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✅ VACUUM ANALYZE dokončeno za ${dt}s.\n`);

  console.log('═══ Hotovo ═══');
  console.log('Co se stalo:');
  console.log('  • Uvolněny mrtvé řádky');
  console.log('  • Refresh statistik pro query planner');
  console.log('  • Query plánovač teď vybere lepší indexy');
  console.log('\nOtevři web v incognito → /sklad/[vůz] → měl by být rychlejší.');
} catch (err) {
  console.error(`❌ Chyba: ${err.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
