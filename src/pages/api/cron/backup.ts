/**
 * Daily backup Directus collections → Vercel Blob Storage.
 *
 * Triggered by Vercel Cron — viz `vercel.json` (schedule "0 3 * * *" = 3:00 ráno).
 *
 * Co dělá:
 *   1) Fetchne všechny klíčové collections z Directusu (přes static token)
 *   2) Serializuje do JSON souboru
 *   3) Uloží do Vercel Blob s timestamp v názvu
 *   4) Vrátí summary
 *
 * Bezpečnost:
 *   - Endpoint chráněn CRON_SECRET (Authorization: Bearer <secret>)
 *   - Pouze Vercel Cron může volat (s correct secretem v request)
 *
 * Env vars potřebné na Vercel:
 *   DIRECTUS_STATIC_TOKEN  — static token z Directusu (user s read all permissions)
 *   CRON_SECRET            — náhodný string pro auth (vygenerovat: crypto.randomUUID())
 *   BLOB_READ_WRITE_TOKEN  — automaticky dodá Vercel po Blob setup
 */
import type { APIRoute } from 'astro';
import { put, list, del } from '@vercel/blob';

export const prerender = false;

const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || import.meta.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = import.meta.env.DIRECTUS_STATIC_TOKEN;
const CRON_SECRET = import.meta.env.CRON_SECRET;

const COLLECTIONS = [
  'brands',
  'sub_brands',
  'models',
  'model_years',
  'trim_levels',
  'option_packages',
  'model_highlights',
  'model_color_exterior',
  'model_color_interior',
  'stock_vehicles',
  'branches',
  'employees',
  'articles',
  'leads',
  'knowledge_documents',
  'site_settings',
  'stock_vehicles_option_packages',
  'stock_vehicles_files',
  'models_files',
];

const RETENTION_DAYS = 30; // kolik dní zpět držet backupů

async function fetchCollection(collection: string): Promise<any[]> {
  const url = `${DIRECTUS_URL}/items/${collection}?limit=-1&fields=*`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
  });
  if (!r.ok) {
    if (r.status === 404 || r.status === 403) return [];
    throw new Error(`Fetch ${collection} failed: ${r.status}`);
  }
  const json = await r.json();
  return Array.isArray(json.data) ? json.data : [];
}

export const GET: APIRoute = async ({ request }) => {
  // ── Auth: pouze Vercel Cron s CRON_SECRET ──
  if (CRON_SECRET) {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!DIRECTUS_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'DIRECTUS_STATIC_TOKEN not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); // 2026-05-18-03-00-00
  const summary: Record<string, { count: number; bytes?: number; error?: string }> = {};
  const backupData: Record<string, any[]> = {};

  // ── Fetch each collection ──
  for (const collection of COLLECTIONS) {
    try {
      const data = await fetchCollection(collection);
      backupData[collection] = data;
      summary[collection] = { count: data.length };
    } catch (e: any) {
      summary[collection] = { count: 0, error: e.message };
    }
  }

  // ── Serialize + upload ──
  const json = JSON.stringify({
    backup_date: new Date().toISOString(),
    directus_url: DIRECTUS_URL,
    summary,
    data: backupData,
  });

  const blob = await put(`directus-backup-${today}.json`, json, {
    access: 'public', // (Blob URL je secret; pouze ten kdo má URL může stáhnout)
    contentType: 'application/json',
    addRandomSuffix: false, // konzistentní filename
    allowOverwrite: true,
  });

  // ── Cleanup: smaž backupy starší než RETENTION_DAYS ──
  let deletedCount = 0;
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const { blobs } = await list({ prefix: 'directus-backup-' });
    const toDelete = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
    for (const b of toDelete) {
      await del(b.url);
      deletedCount++;
    }
  } catch (e) {
    console.warn('cleanup error:', e);
  }

  const elapsed = Date.now() - startedAt;
  const totalRecords = Object.values(summary).reduce((acc, s) => acc + s.count, 0);

  return new Response(
    JSON.stringify({
      ok: true,
      timestamp: new Date().toISOString(),
      duration_ms: elapsed,
      total_records: totalRecords,
      total_bytes: json.length,
      backup_url: blob.url,
      deleted_old_backups: deletedCount,
      summary,
    }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
