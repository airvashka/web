# scripts/

Pomocné Node skripty. **Většina je jednorázová** (migrace/setup/seed dat v Directusu) — spustily se jednou při budování a dál se nepoužívají. Níže je seznam, **které jsou „živé"** (běží opakovaně) vs. jednorázové.

> ⚠️ Před spuštěním jakéhokoli skriptu zkontroluj, co dělá — některé **zapisují/mažou data v Directusu**.

## 🟢 Živé skripty (běží opakovaně — NEMAZAT)

Volané z `package.json` nebo GitHub Actions:

| Skript | Kdy běží | Co dělá |
|---|---|---|
| `sync-stock-kgm.mjs` | cron (VPS, 12/17/21) | import KGM skladu (Playwright scrape) |
| `sync-stock-omoda-jaecoo.mjs` | cron (VPS) | import OMODA/JAECOO skladu (feed) |
| `generate-build-to-order.mjs` | cron / ručně | vozy „na objednání" z trim_levels |
| `compute-teaser-payments.mjs` | cron | spočítá orientační splátky přes UCL proxy |
| `trigger-deploy.mjs` | po syncu | spustí Vercel rebuild (potřebuje `VERCEL_DEPLOY_HOOK`) |
| `fetch-google-reviews.mjs` | GitHub Action (týdně) | stáhne Google recenze do `data/google-reviews.json` |

Spouštěče: `npm run sync:stock`, `sync:stock:kgm`, `sync:stock:omoda`, `teaser:payments`, `build-to-order:apply`, `fetch-reviews`.

## 🟡 Jednorázové (historické — drženy pro referenci)

Většina z ~140 zbývajících skriptů jsou jednorázové nástroje, spuštěné jednou při setupu:

- `add-*` — přidání polí/kolekcí do Directus schématu (~31 ks)
- `fix-*` — jednorázové opravy dat (~17 ks)
- `seed-*` — naplnění dat (~14 ks)
- `setup-*` — počáteční nastavení (~9 ks)
- `migrate-*`, `refactor-*`, `import-*` — přesuny/transformace dat

## 🔴 Destruktivní / explorativní — POZOR

Tyhle **nespouštět**, pokud přesně nevíš proč (mažou data nebo jsou jen průzkumné):

- `wipe-stock.mjs` — smaže skladové vozy
- `delete-*.mjs` — mazací skripty
- `probe-mobile-de*.mjs`, `sniff-mobile-de-api.mjs` — průzkum cizího API (mrtvé)
- `recover-bad-clone.mjs`, `recreate-webhook-flow.mjs`, `reorganize-models.mjs` (revertnuto) — jednorázové opravy
- `test-build-request.mjs` — testovací

> Doporučení (až bude čas): jednorázové přesunout do `scripts/archive/`. Zatím necháno na místě, aby se nerozbily případné relativní importy.
