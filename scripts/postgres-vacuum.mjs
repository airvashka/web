#!/usr/bin/env node
/**
 * Postgres VACUUM ANALYZE — refresh statistik pro query planner.
 *
 * Po schema changes (ALTER TABLE) Postgres drží zastaralé statistiky,
 * query planner pak volí pomalé indexy. VACUUM ANALYZE to vyřeší během 5-30s.
 *
 * Použití:
 *   node scripts/postgres-vacuum.mjs
 *
 * Skript se zeptá na DATABASE_URL. Najdeš ho:
 *   Railway → PostGIS service → Variables → DATABASE_URL
 *   (NE DATABASE_PRIVATE_URL — ta funguje jen uvnitř Railway sítě)
 *
 * Vypadá jako: postgres://railway:HESLO@viaduct.proxy.rlwy.net:12345/railway
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import pg from 'pg';

const rl = readline.createInterface({ input, output });

async function main() {
  console.log('═══ Postgres VACUUM ANALYZE ═══\n');
  console.log('Najdi DATABASE_URL: Railway → PostGIS → Variables → DATABASE_URL');
  console.log('Hodnota vypadá jako: postgres://railway:HESLO@viaduct.proxy.rlwy.net:PORT/railway\n');

  const url = (await rl.question('DATABASE_URL: ')).trim();
  if (!url || !url.startsWith('postgres')) {
    console.log('❌ Neplatná URL.');
    rl.close();
    process.exit(1);
  }

  console.log('\nPřipojuji k databázi...');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('✅ Připojeno.\n');

    // 1. List tabulek se statistikami
    console.log('▶ Tabulky v DB:');
    const tables = await client.query(`
      SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_analyze
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC
      LIMIT 15;
    `);
    console.table(tables.rows.map((r) => ({
      tabulka: r.relname,
      řádků: r.n_live_tup,
      mrtvých: r.n_dead_tup,
      lastVacuum: r.last_vacuum?.toISOString?.()?.slice(0, 19) ?? 'nikdy',
      lastAnalyze: r.last_analyze?.toISOString?.()?.slice(0, 19) ?? 'nikdy',
    })));

    // 2. VACUUM ANALYZE
    console.log('\n▶ Spouštím VACUUM ANALYZE (může trvat 5-60s)...');
    const t0 = Date.now();
    await client.query('VACUUM ANALYZE;');
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✅ VACUUM ANALYZE dokončeno za ${dt}s.`);

    console.log('\n═══ Hotovo ═══');
    console.log('Co se stalo:');
    console.log('  • Postgres uvolnil mrtvé řádky (po DELETE/UPDATE)');
    console.log('  • Refresh statistik pro query planner');
    console.log('  • Query plánovač teď vybere lepší indexy');
    console.log('\nOtevři web a sleduj Response Time graf v Railway → Directus → Metrics.');
  } catch (err) {
    console.log(`\n❌ Chyba: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
    rl.close();
  }
}

main();
