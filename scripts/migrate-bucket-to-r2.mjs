#!/usr/bin/env node
/**
 * Migrate files: Railway Bucket → Cloudflare R2
 *
 * Source: Railway Bucket (Tigris-style S3 storage)
 *   - Endpoint: https://t3.storageapi.dev
 *   - Virtual-hosted style URLs
 *
 * Target: Cloudflare R2 (EU)
 *   - Path-style URLs
 *
 * Použití:
 *   1. Naplň proměnné níže (Secret Access Keys oba)
 *   2. npm install @aws-sdk/client-s3 (pokud ještě nemáš)
 *   3. node scripts/migrate-bucket-to-r2.mjs
 *
 * Skript je idempotentní — pokud na R2 už soubor je, přeskočí.
 * Pokud chceš force overwrite, smaž R2 bucket předtím nebo nastav FORCE=1.
 */
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

// ===== SOURCE: Railway Bucket =====
const SOURCE_CONFIG = {
  endpoint: 'https://t3.storageapi.dev',
  region: 'auto',
  bucket: 'bucket-xtteuy8tyztsa6wtyg',
  accessKeyId: 'tid_wpjQrQokIGXjpidIuXEQsOsSzQXNWVEPkrbtZDkNbpRKZEMNUH',
  // Secret prompt at start
  secretAccessKey: '',
  forcePathStyle: false, // Virtual-hosted-style
};

// ===== TARGET: Cloudflare R2 =====
const TARGET_CONFIG = {
  endpoint: 'https://06d23bdf2ab2ff2f4f1a154f88db2d79.eu.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'sfr-motor-storage',
  accessKeyId: 'cca9d1e26ec56a8191cca052a2188ebe',
  secretAccessKey: '',
  forcePathStyle: true,
};

const FORCE = process.env.FORCE === '1';

async function main() {
  console.log('═══ Railway Bucket → Cloudflare R2 migration ═══\n');

  // Ask for both secrets
  SOURCE_CONFIG.secretAccessKey = (await rl.question('Railway Bucket SECRET_ACCESS_KEY: ')).trim();
  if (!SOURCE_CONFIG.secretAccessKey) { console.error('❌ Source secret required'); process.exit(1); }

  TARGET_CONFIG.secretAccessKey = (await rl.question('Cloudflare R2 Secret Access Key: ')).trim();
  if (!TARGET_CONFIG.secretAccessKey) { console.error('❌ Target secret required'); process.exit(1); }

  rl.close();
  console.log('');

  const source = new S3Client({
    endpoint: SOURCE_CONFIG.endpoint,
    region: SOURCE_CONFIG.region,
    credentials: {
      accessKeyId: SOURCE_CONFIG.accessKeyId,
      secretAccessKey: SOURCE_CONFIG.secretAccessKey,
    },
    forcePathStyle: SOURCE_CONFIG.forcePathStyle,
  });

  const target = new S3Client({
    endpoint: TARGET_CONFIG.endpoint,
    region: TARGET_CONFIG.region,
    credentials: {
      accessKeyId: TARGET_CONFIG.accessKeyId,
      secretAccessKey: TARGET_CONFIG.secretAccessKey,
    },
    forcePathStyle: TARGET_CONFIG.forcePathStyle,
  });

  // Step 1: List all objects from source
  console.log('▶ Listing files in Railway Bucket...');
  const allObjects = [];
  let continuationToken;
  do {
    const resp = await source.send(new ListObjectsV2Command({
      Bucket: SOURCE_CONFIG.bucket,
      ContinuationToken: continuationToken,
    }));
    if (resp.Contents) allObjects.push(...resp.Contents);
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  const totalSize = allObjects.reduce((sum, o) => sum + (o.Size ?? 0), 0);
  console.log(`✅ Nalezeno ${allObjects.length} souborů, celkem ${(totalSize / 1024 / 1024).toFixed(1)} MB.\n`);

  // Step 2: Copy each
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  const t0 = Date.now();

  for (let i = 0; i < allObjects.length; i++) {
    const obj = allObjects[i];
    const key = obj.Key;
    const sizeKB = ((obj.Size ?? 0) / 1024).toFixed(1);
    const progress = `[${i + 1}/${allObjects.length}]`;

    try {
      // Check if exists in target (skip)
      if (!FORCE) {
        try {
          await target.send(new HeadObjectCommand({ Bucket: TARGET_CONFIG.bucket, Key: key }));
          console.log(`${progress} ⏭️  ${key} (${sizeKB} KB) — již existuje, skip`);
          skipped++;
          continue;
        } catch (e) {
          // 404 = doesn't exist, continue with copy
          if (e.$metadata?.httpStatusCode !== 404 && e.name !== 'NotFound') {
            throw e;
          }
        }
      }

      // Download from source
      const getResp = await source.send(new GetObjectCommand({
        Bucket: SOURCE_CONFIG.bucket,
        Key: key,
      }));

      // Convert stream to buffer (R2 needs ContentLength known)
      const chunks = [];
      for await (const chunk of getResp.Body) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);

      // Upload to target
      await target.send(new PutObjectCommand({
        Bucket: TARGET_CONFIG.bucket,
        Key: key,
        Body: body,
        ContentType: getResp.ContentType,
        ContentLength: body.length,
        Metadata: getResp.Metadata,
      }));

      console.log(`${progress} ✓ ${key} (${sizeKB} KB)`);
      copied++;
    } catch (err) {
      console.log(`${progress} ✗ ${key} (${sizeKB} KB) — ${err.message}`);
      failed++;
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n═══ Hotovo za ${dt}s ═══`);
  console.log(`  Copied:  ${copied}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Total:   ${allObjects.length}\n`);

  if (failed > 0) {
    console.log('⚠️  Některé soubory selhaly. Spusť skript znovu — idempotentní (přeskočí už zkopírované).');
    process.exit(1);
  } else {
    console.log('✅ Vše OK. Soubory na Cloudflare R2.');
  }
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
