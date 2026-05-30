# Dokumentace — SFR Motor web

Kompletní dokumentace projektu. Vytvořeno 30. 5. 2026.

> ⚠️ **Bezpečnost:** žádný z těchto dokumentů neobsahuje reálná hesla ani API klíče — jen seznamy „co kam patří". Tajné hodnoty patří do password manageru a do ENV (Vercel / VPS `.env`), **nikdy do gitu**.
>
> ⚠️ **Aktuálnost:** infrastrukturní údaje (IP, kontejnery, retence) jsou k datu vzniku — před kritickou akcí ověř proti živému stavu.

## Obsah

| Dokument | O čem |
|---|---|
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Architektura, stack, struktura repa, datový model, build/deploy, konvence |
| [ONBOARDING.md](./ONBOARDING.md) | Rychlý start pro nového člověka — od cloneu po běžící web |
| [HANDOVER.md](./HANDOVER.md) | Převzetí projektu: účty, přístupy, ENV proměnné, otevřené úkoly (placeholdery, ne hesla) |
| [SECURITY.md](./SECURITY.md) | Bezpečnostní analýza + priorizovaná doporučení (P0/P1/P2) |
| [DEPENDENCIES.md](./DEPENDENCIES.md) | `npm audit` nálezy + plán aktualizací závislostí |
| [CODE-AUDIT.md](./CODE-AUDIT.md) | Mrtvý/starý/duplicitní kód + návrhy úklidu |
| [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md) | Zálohy a obnova — co dělat, když něco spadne |
| [MONITORING.md](./MONITORING.md) | Co hlídat (uptime, sync, zálohy, náklady) a čím |

## Nejdůležitější zjištění (TL;DR)

**Bezpečnost:**
- ✅ **Hotovo (30.5., čeká push):** smazán debug endpoint `/api/leasing/test`; Astro stack updatován v rámci major 5/8; `devalue` HIGH opraven (`npm audit fix`).
- ❌ `overrides: undici` zkoušeno → rozbilo build (jsdom) → revertováno.
- 🔄 **Plánovaný úkol:** MAJOR upgrade Astro 6 + Vercel adapter 10 (opraví zbylé HIGH: path-to-regexp, x-astro-path, astro XSS). Breaking → testovat. Není akutní.
- 🟠 Rate-limiting je na Vercel serverless neúčinný (in-memory) → přesunout na Vercel KV / Upstash.
- 🟠 SSH/VPS hardening + obnova zapomenutého root hesla.

**Kód (úklid):**
- 2 mrtvé komponenty (`LeasingCalculator.astro`, `YouTubeSection.astro`).
- Duplicitní rate-limit logika ve 3 endpointech.
- `scripts/` má 148 souborů, živých 6 → archivovat zbytek.
- `.env.example` neúplný → doplnit.

**Provoz:**
- Zálohy běží (snapshoty 7 dní + pg_dump 14 dní + Vercel Blob 30 dní), ale **chybí off-site pg záloha**.
- **Chybí externí uptime monitoring** a **heartbeaty cron jobů** → doporučeno doplnit.

> Všechno výše je **analýza/doporučení** — v kódu nebylo nic změněno (dle zadání). Implementace čeká na rozhodnutí majitele.
