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

---

# 📌 STAV — bezpečnost & kód (aktualizováno 30. 5. 2026)

Jeden přehled na jednom místě. Detaily k jednotlivým bodům jsou v příslušných dokumentech.

## ✅ Hotovo a nasazeno (na betě OK)

| Co | Kde |
|---|---|
| Smazaný debug endpoint `/api/leasing/test` | SECURITY P0-2 |
| Upgrade na **Astro 6 + Vercel adapter 10** → opraveno astro XSS, x-astro-path auth override, devalue | DEPENDENCIES |
| `undici` HIGH dořešen (update `@vercel/blob`) | DEPENDENCIES |
| Smazané 2 mrtvé komponenty (`LeasingCalculator`, `YouTubeSection`) | CODE-AUDIT |
| **Turnstile** přidán i na newsletter | SECURITY P1-2 |
| Rate-limit sjednocen do `lib/rateLimit.ts` | CODE-AUDIT |
| **Chatbot vypnutý** (widget skrytý + endpoint 503) → uzavřené riziko nákladů na AI | SECURITY P1-1 |
| `.env.example` doplněn na úplný seznam | SECURITY P2-4 |
| `scripts/README.md` (živé vs jednorázové skripty) | CODE-AUDIT |
| `/admin/cenik` má `noindex` (už bylo) | SECURITY P2-1 |

## ✅ Zajištěno na straně majitele

- Anthropic Console — měsíční spend limit ($100, notifikace na $50).
- Google Maps klíč — omezen na referrer `*.sfr-motor.cz` + Maps Embed API.
- Google Places (recenze) klíč — omezen na Places API.
- VPS — ověřeno: root zamčený, admin přes sudo `sfr`, ufw (jen 22/80/443), fail2ban běží, DB/Redis/MinIO/UCL nevystavené ven.

## ⏳ Odloženo / vědomé rozhodnutí (není akutní)

- **key-only SSH** (vypnout heslo) — necháno na fail2banu; lze dodělat kdykoli.
- **Legacy fallbacky** v kódu (features/technicalData/vybavy) — nechat; nejde bezpečně ověřit, že jsou data zmigrovaná.
- **scripts/** fyzický přesun do `archive/` — zatím jen README (přesun = zbytečný churn 140 souborů).
- **`global.css`** (5 869 řádků) rozdělit — nízká priorita, kosmetika.
- **Off-site záloha DB + uptime monitoring + heartbeaty** — vyžaduje účty (Backblaze/Healthchecks/UptimeRobot), odloženo.

## ⛔ Mimo naše ruce (čekáme na upstream)

- `path-to-regexp` (HIGH, uvnitř `@astrojs/vercel`) a `yaml` (moderate, jen dev) — fix musí vydat Astro/Vercel. Nízké riziko. **Doporučení: zapnout Dependabot na GitHubu** → automatický PR, až oprava vyjde.

---

> Pozn.: značky „✅ HOTOVO (30.5.)" uvnitř jednotlivých dokumentů jsou detail k tomuto souhrnu.
