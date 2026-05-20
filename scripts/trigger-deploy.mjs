#!/usr/bin/env node
/**
 * trigger-deploy.mjs — po importu skladovek pingne Vercel Deploy Hook,
 * takže se web (statický build na Vercelu) přebuilduje s čerstvými daty.
 *
 * No-op, pokud VERCEL_DEPLOY_HOOK není nastaven (lokální běh nic nespustí).
 * Nastav env VERCEL_DEPLOY_HOOK na Render cronu (URL z Vercel → Settings → Git → Deploy Hooks).
 */
const hook = process.env.VERCEL_DEPLOY_HOOK;
if (!hook) {
  console.log('  [i]   VERCEL_DEPLOY_HOOK nenastaven — přeskakuji rebuild webu.');
  process.exit(0);
}
try {
  const r = await fetch(hook, { method: 'POST' });
  console.log(r.ok ? `  [ok]  Vercel rebuild spuštěn (HTTP ${r.status})` : `  [!]   Deploy hook vrátil ${r.status}`);
} catch (e) {
  console.log(`  [!]   Deploy hook selhal: ${e.message}`);
}
