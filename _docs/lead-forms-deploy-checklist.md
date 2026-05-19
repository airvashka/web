# Lead Forms — Deploy Checklist

Postupuj přesně. Refactor je hotový, ale **NEPUSHUJ DO PRODUKCE** dokud nebudou splněné kroky níže — jinak všechny formuláře přestanou fungovat.

---

## 1. Directus admin (BEFORE deploy)

### 1a) Vytvoř Static Token

1. Otevři Directus admin: `https://[directus-url]/admin`
2. Settings (vlevo) → **Access Tokens**
3. **+ Create new** token:
   - **Name**: `Lead API Token`
   - **Permissions**: vyber roli (nebo nech default admin role)
4. Po vytvoření **zkopíruj token** — zobrazí se jen jednou. Pokud zapomeneš, musíš vytvořit nový.

### 1b) Vytvoř custom roli s omezenými právy (doporučeno)

Pokud nechceš dát tokenu plné admin práva (správné):

1. Settings → **Roles** → **+ Create new role**
2. **Name**: `Lead Writer`
3. **App access**: No
4. Permissions tab → najdi collection `leads`:
   - Create: **All Access** (full)
   - Read/Update/Delete: **No Access**
5. Settings → Access Tokens → vytvoř token přiřazený k roli `Lead Writer`

### 1c) Zakaž anonymous write na `leads`

1. Settings → **Roles** → klikni na **Public** role
2. Permissions tab → najdi collection `leads`
3. Aktuální **Create** permission je pravděpodobně **All Access** (proto teď funguje anonymous POST)
4. Změň Create na **No Access**
5. Read taky **No Access** (nikdo nepotřebuje veřejně číst leadly)

### 1d) Rozšiř `leads` collection o nová pole

Settings → Data Model → `leads` → přidej fields:

| Field name | Type | Note |
|---|---|---|
| `source_brand` | M2O → `brands` | Značka odkud lead přišel |
| `source_model_slug` | String (100) | Snapshot slugu pro fallback |
| `source_vehicle_vin` | String (50) | VIN snapshot |
| `source_url` | String (500) | Full URL s query |
| `source_ip` | String (45) | IPv4/IPv6 |
| `source_user_agent` | String (500) | UA string |
| `source_referer` | String (500) | Referer header |

Pokud collection už pole má, nechej.

---

## 2. Vercel environment variables

V Vercel dashboard → **Settings → Environment Variables**:

| Var | Value | Environments |
|---|---|---|
| `DIRECTUS_LEAD_TOKEN` | token z Lead API uživatele (nový, omezený) | Production, Preview, Development |
| `DIRECTUS_STATIC_TOKEN` | **NECHEJ existující** (admin token pro backup) | Production, Preview, Development |
| `DIRECTUS_URL` | `https://[your-directus-url]` (bez trailing /) | Production, Preview, Development |
| `TURNSTILE_SECRET` | secret key z Cloudflare (krok 3) | Production, Preview |
| `PUBLIC_TURNSTILE_SITE_KEY` | site key z Cloudflare (krok 3) | Production, Preview |
| `ECOMAIL_LIST_ID` | `4` (jako v URL) | Production, Preview |
| `ECOMAIL_HASH` | `f67e22c6c3dacfc9b77b6b40399abc16` | Production, Preview |

**Důležité:** `PUBLIC_*` prefix v Astro znamená, že proměnná je dostupná i v browser bundle (OK pro site key, NEpoužívej pro secret).

---

## 3. Cloudflare Turnstile (pro invisible CAPTCHA)

1. Přihlas se na `https://dash.cloudflare.com` (vytvoř free účet pokud nemáš)
2. Levé menu → **Turnstile**
3. **+ Add site**:
   - **Site Name**: SFR Motor
   - **Hostnames**:
     - `sfr-motor.cz`
     - `sfr-motor-test.vercel.app`
     - `localhost` (pro dev)
   - **Widget Mode**: **Invisible** ← důležité, uživatel nic neuvidí
   - **Pre-clearance**: Off (není potřeba)
4. Po vytvoření zkopíruj:
   - **Site Key** → do Vercel env jako `PUBLIC_TURNSTILE_SITE_KEY`
   - **Secret Key** → do Vercel env jako `TURNSTILE_SECRET`

**Pokud Turnstile nechceš teď:** prostě env vary nevkládej. Server endpoint detekuje že `TURNSTILE_SECRET` chybí a verifikaci přeskočí. Můžeš zapnout později.

---

## 4. Deploy + smoke test

1. Push do `main` → Vercel auto-deploy
2. Otevři produkční web → zkus 5 formulářů:
   - **/kontakt** → vyplnit + odeslat. Status "✓ Děkujeme!".
   - **/servis** → vyplnit + odeslat. Stejně.
   - **/sklad/[id]** (libovolný vůz) → vyplnit + odeslat.
   - **AI chat** na /model/[slug] → požádej o "rezervaci testovací jízdy", vyplň jméno/email/telefon, lead se vytvoří.
   - **/magazin** → newsletter → vyplnit email → status "✓ Děkujeme!".
3. Otevři Directus admin → `leads` collection → zkontroluj že nový záznam přišel s vyplněnými context fields (source_vehicle, source_brand, source_model_slug, atd.)
4. Otevři Ecomail admin → list ID 4 → zkontroluj že email přišel jako "Pending" subscriber

### 4a) Security smoke test

V terminálu:
```bash
curl -X POST https://[directus-url]/items/leads \
  -H "Content-Type: application/json" \
  -d '{"customer_name":"Hacker","customer_email":"x@x.cz","customer_phone":"123"}'
```

Očekávaný výsledek: **403 Forbidden** (Directus odmítl anonymous write).

Pokud vrátí 200/201 → permissions v kroku 1c nejsou správně. Vrať se a oprav.

---

## 5. Co se může pokazit

| Symptom | Příčina | Fix |
|---|---|---|
| Všechny formy vrací 500 "Server config error" | `DIRECTUS_STATIC_TOKEN` chybí ve Vercel env | Přidej env var + redeploy |
| Form vrátí 400 "Ověření selhalo" pro VŠECHNY uživatele | `TURNSTILE_SECRET` nastaven ale token z frontendu nedorazil | Nastav i `PUBLIC_TURNSTILE_SITE_KEY` (oba musí být) NEBO smaž oba (Turnstile vypnutý) |
| Newsletter vrátí 502 | Ecomail public endpoint změnil URL nebo list neexistuje | Zkontroluj `ECOMAIL_LIST_ID` a `ECOMAIL_HASH` |
| Telefonní čísla pořád stejná po refresh | `employees` collection prázdná NEBO neaktivní | Vyplň `employees` v Directus admin s `phone` polem |
| Rate limit hlásí "Příliš mnoho požadavků" | Aktuální IP poslala 10+ leadů za 24h | Restart serverless function (deploy) — in-memory store se vymaže |

---

## 6. Po úspěšném deployu

- Smaž **PUBLIC_DIRECTUS_URL** z Vercel env? NE — drží se používá pro veřejné lookups (`/sklad`, `/model/[slug]` načítají data z prohlížeče nepřímo přes Astro SSR, ale URL je stejná). Nech ji.
- Zaktualizuj `_docs/lead-forms-audit-fix.md` na status: **DONE** s datem.

---

## 7. Co se DOKUMENTACÍ nemění (do budoucna)

- Pokud přidáš v Directus dalšího prodejce → automaticky se začne objevovat v rotaci telefonů. Žádný code change.
- Pokud změníš `phone` u existujícího prodejce → propaguje se ihned (cache je per-request).
- Pokud chceš pozastavit prodejce (např. dovolená) → smaž mu `phone` nebo přesuň do jiného `department`.
- Pokud chceš upravit rate limit → `RATE_LIMIT_MAX` v `src/pages/api/lead.ts` (dnes 10/den/IP).
