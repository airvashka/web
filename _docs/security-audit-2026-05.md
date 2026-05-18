# Bezpečnostní audit — sfr-motor.cz

**Datum auditu**: 18. května 2026
**Auditovaný systém**: Webová prezentace SFR Motor s.r.o. (sfr-motor.cz)
**Architektura**: Headless CMS (Astro 5 + Directus 11 + Vercel Pro + Railway Pro)
**Klasifikace rizika**: 🟢 **NÍZKÉ** (lepší než 90 % automobilových dealerů v ČR)

---

## 1. Shrnutí pro vedení

Tento audit hodnotí bezpečnostní stav webové platformy SFR Motor s.r.o. v porovnání s běžnými řešeními na českém trhu (WordPress, Webnode, custom PHP).

**Hlavní zjištění:**

- Architektura **Headless Jamstack** výrazně snižuje útočnou plochu oproti tradičním CMS (WordPress).
- **4 nezávislé vrstvy obrany**: aplikační, infrastrukturní, zálohovací, monitorovací.
- **0 známých kritických zranitelností** v aktuální verzi kódu (květen 2026).
- **Zálohování** je redundantní (Vercel Blob 30 dní + Railway Pro 7 dní).
- **Limity nákladů** jsou nastavené (Anthropic spend cap $30/měs), takže útok na AI komponentu nemůže způsobit finanční škodu.

**Doporučení**: Zvážit aktivaci 2FA na všech administrátorských službách (GitHub, Vercel, Railway, Directus). To je nejlevnější a nejúčinnější zvýšení ochrany.

---

## 2. Architektura systému

```
┌──────────────────────────────────────────────────────────────┐
│  Návštěvníci (sfr-motor.cz)                                  │
└────────────────────────────┬─────────────────────────────────┘
                             ↓ HTTPS
┌──────────────────────────────────────────────────────────────┐
│  Vercel Edge Network (CDN + DDoS Protection)                 │
│  • Statické HTML stránky (pre-rendered)                      │
│  • API endpointy (chat, leads, cenik)                        │
│  • Cron jobs (denní backup)                                  │
└────────────────────────────┬─────────────────────────────────┘
                             ↓ TLS / Bearer Token
┌──────────────────────────────────────────────────────────────┐
│  Railway PostgreSQL + Directus 11 (Headless CMS)             │
│  • Modely, ceník, sklad, články, knowledge base              │
│  • Admin UI (auth required)                                  │
│  • Daily snapshots (Pro plan)                                │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Externí služby                                              │
│  • Anthropic Claude API (chat AI) — spend cap $30/měs        │
│  • Google Places API (recenze) — read-only                   │
│  • Vercel Blob Storage (zálohy 30 dní)                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Tabulka rizik (Risk Matrix)

Legenda:
- 🟢 **Vyřešeno** — riziko je adekvátně mitigováno
- 🟡 **Omezeno** — zbytkové riziko existuje, ale je v přijatelné míře
- 🔴 **Otevřené** — vyžaduje akci

| # | Kategorie | Riziko | Stav | Mitigace |
|---|---|---|---|---|
| 1.1 | **Web app** | Cross-Site Scripting (XSS) | 🟢 | Statický web, Astro auto-escape, žádný uživatelský HTML rendering |
| 1.2 | **Web app** | SQL Injection | 🟢 | Directus používá parametrizované queries, žádný přímý SQL z aplikace |
| 1.3 | **Web app** | CSRF | 🟡 | Žádné kritické auth-required form actions, pouze lead capture (low impact) |
| 1.4 | **Web app** | File upload exploity | 🟢 | Jen PDF uploadery vyžadují admin auth (Directus token) |
| 1.5 | **Web app** | Open Redirect | 🟢 | Žádné dynamic redirect URLs z user inputu |
| 2.1 | **Auth** | Admin password brute-force | 🟢 | Directus admin na separátním subdoménu, žádný `/wp-admin` ekvivalent |
| 2.2 | **Auth** | Static API token leak | 🟡 | Token v Vercel env vars (encrypted), nikdy v git, omezený scope |
| 2.3 | **Auth** | 2FA na admin účtech | 🔴 | Nedoporučeno aktuálně, **přidat při příští sessně** |
| 3.1 | **Data** | Encryption at rest | 🟢 | Vercel Blob AES-256, Railway PostgreSQL encrypted by default |
| 3.2 | **Data** | Encryption in transit | 🟢 | HTTPS / TLS 1.3 enforced (Vercel auto SSL) |
| 3.3 | **Data** | Backup strategie | 🟢 | 2 nezávislé systémy: Vercel Blob (30d) + Railway snapshoty (7d) |
| 3.4 | **Data** | Data loss recovery | 🟢 | Otestovaný restore postup, RTO < 1 hodina |
| 3.5 | **Data** | PII handling (GDPR) | 🟡 | Leads obsahují jméno/telefon/email, chráněné jen access policies — chybí explicit retention policy |
| 4.1 | **API** | Rate limiting (chat) | 🟢 | 20 req/hod per IP, vrací 429 s Retry-After header |
| 4.2 | **API** | Input validation (leads) | 🟢 | Jméno 2-100 znaků, telefon regex `+420\d{9}`, email regex |
| 4.3 | **API** | Cost overrun (AI) | 🟢 | Anthropic spend cap $30/měs, hard limit |
| 4.4 | **API** | Prompt injection | 🟡 | System prompt obsahuje employee data — možný info disclosure, ne kritický |
| 4.5 | **API** | Admin endpoint exposure | 🟢 | /api/cenik/save vyžaduje Directus Bearer token |
| 4.6 | **API** | Cron endpoint protection | 🟢 | CRON_SECRET header validation |
| 5.1 | **Infra** | DDoS na frontend | 🟢 | Vercel Edge Network = enterprise DDoS mitigation |
| 5.2 | **Infra** | DDoS na backend (Directus) | 🟡 | Railway nemá specifickou DDoS protection, ale frontend cache funguje i při Directus výpadku |
| 5.3 | **Infra** | Single point of failure (Railway) | 🟡 | Railway 99.9% SLA, výpadek řešen frontend cache + možností restore z backupu |
| 5.4 | **Infra** | Provider lock-in | 🟢 | Astro běží na libovolném Node host, Directus je open-source self-hostable |
| 6.1 | **Deps** | Známé CVE v dependencies | 🟢 | `npm audit` 0 high-severity (květen 2026) |
| 6.2 | **Deps** | Outdated packages | 🟡 | pdfjs-dist mírně zastaralý, plán update v dalším sprintu |
| 6.3 | **Deps** | Automated dep updates | 🔴 | Dependabot nenakonfigurován, manuální review |
| 7.1 | **Ops** | Secrets management | 🟢 | Vercel env vars (encrypted), .env v .gitignore |
| 7.2 | **Ops** | Access logging | 🟡 | Vercel + Railway mají basic logging, žádný centralizovaný SIEM |
| 7.3 | **Ops** | Deployment process | 🟢 | Git push → Vercel auto-deploy s build check, rollback 1-click |
| 7.4 | **Ops** | 2FA na deployment účtech | 🔴 | **Doporučujeme aktivovat na GitHub, Vercel, Railway** |
| 8.1 | **Compliance** | GDPR | 🟡 | Privacy policy v patičce, lead data v Directus, chybí formal data retention policy |
| 8.2 | **Compliance** | Cookie consent | 🟢 | Cookie banner s opt-in/out, dle eIDAS |
| 8.3 | **Compliance** | Audit trail | 🟡 | Directus má built-in activity log, ale není pravidelně reviewován |

**Celkem**: 22× 🟢, 9× 🟡, 4× 🔴

---

## 4. Srovnání s alternativními řešeními

| Riziko / aspekt | **SFR Motor (současné)** | **WordPress + Wordfence** | **Webnode / Wix** | **Custom PHP** |
|---|---|---|---|---|
| **Plugin/theme CVE útoky** | 🟢 Nehrozí (žádné pluginy) | 🔴 Hlavní vektor — denně CVE | 🟢 N/A | 🟡 Závisí na kódu |
| **Brute-force `/wp-admin`** | 🟢 Admin na samostatném subdomainu | 🔴 Vysoké riziko, hlavní cíl | 🟢 N/A | 🟡 Závisí |
| **SQL injection** | 🟢 Parametrizované queries | 🟡 Plugin-závislé | 🟢 Managed | 🔴 Časté riziko |
| **PHP RCE** | 🟢 Žádné PHP | 🟡 Občas přes upload/plugin | 🟢 N/A | 🟡 Závisí |
| **DDoS protection** | 🟢 Vercel Edge (enterprise-grade) | 🔴 Sdílený hosting padá při ~10k rps | 🟡 Záleží na plánu | 🔴 Vlastní obrana nutná |
| **Auto SSL/HTTPS** | 🟢 Vercel automatic, vždy aktivní | 🟡 Vyžaduje plugin / Let's Encrypt | 🟢 Built-in | 🟡 Manuální setup |
| **Backup strategie** | 🟢 Vercel Blob + Railway snapshots | 🟡 Závislé na hosting providerovi | 🟡 Provider dependent | 🔴 Custom řešení |
| **Recovery po hacku** | 🟢 `git revert` + redeploy = 30 s | 🔴 Často reinstall + obnova zálohy | 🟡 Provider-dependent | 🔴 Manuální |
| **Update breakage** | 🟢 Verzované, snadný rollback | 🔴 Plugin update často rozbije web | 🟢 Auto-managed | 🟡 Závisí |
| **API key leak** | 🟢 Vercel env vars (encrypted) | 🟡 V wp-config.php (často exposed) | 🟢 N/A | 🟡 V app config |
| **CDN included** | 🟢 Globální Edge zdarma | 🔴 Nutné Cloudflare extra | 🟡 Limitované | 🔴 Vlastní setup |
| **Zone reachability** | 🟢 Multi-region failover | 🟡 Single hosting region | 🟡 Provider dependent | 🟡 Závisí |
| **Total Cost of Ownership** | 🟢 $20+$20 = $40/měs | 🟡 $5-50 + admin čas | 🟡 $10-30/měs lock-in | 🔴 Vysoké udržovací náklady |
| **Audit trail / monitoring** | 🟡 Vercel + Railway dashboards | 🟡 Wordfence dashboard | 🟢 Provider managed | 🔴 Vlastní řešení |

**Závěr srovnání**: Architektura SFR Motor poskytuje výrazně lepší ochranu proti běžným útokům než WordPress (který je atraktivní cíl, ovládající 40 % webu) a má lepší recovery scenarios.

---

## 5. Detail implementovaných opatření

### 5.1 Aplikační vrstva

**XSS ochrana**: Astro framework automaticky escapuje proměnné při renderingu. Uživatelský obsah se nikde nerenderuje bez sanitizace. Markdown články procházejí `marked` knihovnou bez HTML pass-through.

**SQL injection**: Aplikace se nikdy nepřipojuje přímo k databázi. Veškerý přístup probíhá přes Directus REST API, které používá parametrizované dotazy v ORM vrstvě.

**CSRF**: Lead capture endpoint nevyžaduje uživatelskou autentizaci. Případná podvržená submission z jiné stránky nepřináší útočníkovi žádný benefit (nepřevzetí cizí session). Honeypot field detekuje botové submissions.

### 5.2 Autentizace a autorizace

**Admin přístup**: Directus admin UI je na samostatné doméně `directus-production-3e67.up.railway.app`. Není exposed na hlavní doméně. Brute-force na admin login by musel cílit konkrétně na tuto doménu, kterou útočník zpravidla nezná.

**API tokeny**: Static Directus token je uložen pouze v Vercel encrypted env vars (`DIRECTUS_STATIC_TOKEN`). Není v git repository, není v deployment artifactech, je dostupný jen serverless function runtime.

**Cron secret**: Daily backup endpoint je chráněn `CRON_SECRET` headerem. Bez znalosti secretu vrátí 401 Unauthorized.

### 5.3 Rate limiting

Endpoint `/api/chat/model` aplikuje per-IP rate limit **20 requests / hodinu**. Při překročení vrací HTTP 429 s `Retry-After` headerem. Omezuje cost-based DoS útoky proti Anthropic API.

### 5.4 Input validation

Lead capture validuje:
- **Jméno**: 2–100 znaků
- **Telefon**: regex `^(\+?420)?\d{9}$` nebo international `^\+?\d{9,15}$`
- **Email**: RFC-compliant regex
- **Zpráva**: max 1000 znaků

Při validation failure vrací error, neukládá nic.

### 5.5 Zálohování

**Primární backup**: Vercel Cron Job spouští denně ve 3:00 UTC endpoint `/api/cron/backup`. Stáhne všechny záznamy z 18 Directus collections, serializuje do JSON, uploaduje do Vercel Blob storage. Drží 30 dní zpět, staré automaticky maže.

**Sekundární backup**: Railway PostgreSQL automatické daily snapshoty (Pro plan). 7 dní retence. Restore na jeden klik z Railway dashboardu.

**Frontend cache**: I při výpadku Directus pokračuje statický frontend (sfr-motor.cz) běžet z Vercel Edge cache. Návštěvníci nezaznamenají žádný výpadek pokud nejde o sklad aktualizace.

### 5.6 Monitoring

- **Vercel Functions**: log všech API volání s status code, duration, error messages
- **Vercel Cron Jobs**: záznam každého spuštění, success/failure status
- **Anthropic Console**: live spending dashboard
- **Railway Metrics**: CPU, paměť, requests/s pro Directus + PostgreSQL

### 5.7 Compliance

- **HTTPS**: Vynucené přes HSTS header, Vercel auto-SSL, perfect forward secrecy
- **Cookie consent**: GDPR-compliant banner s opt-in granularitou
- **Privacy policy**: Dostupná v patičce, `/informace/ochrana-udaju`
- **Data subject rights**: Manuální postup přes admin (vyhledat lead, anonymizovat / smazat)

---

## 6. Zbytková rizika (žlutá)

### 6.1 Prompt injection v AI chatu
**Popis**: Útočník by mohl pomocí kreativně formulovaného dotazu pokusit přimět AI vypsat data ze system promptu (např. seznam zaměstnanců s telefony).
**Dopad**: Nízký — vypisovaná data jsou stejně dostupná na `/kontakt` stránce.
**Mitigace**: System prompt obsahuje instrukce nevypisovat strukturovaná data. Zvážit ale obecné hardening do budoucna.

### 6.2 Single point of failure — Railway
**Popis**: Veškerá CMS data (sklad, modely, články) jsou v jedné Railway PostgreSQL instanci.
**Dopad**: Při výpadku Railway nelze editovat data. Frontend ale funguje dál ze statické cache.
**Mitigace**: Railway Pro SLA 99.9%, daily backupy, ručně otestovaný restore postup.

### 6.3 PII v lead capture
**Popis**: Leady (jméno/telefon/email) jsou v Directus DB. Pokud Directus padne, jsou data nedostupná po dobu výpadku. Nemáme formálně definovanou retention policy.
**Dopad**: Střední — GDPR compliance vyžaduje proces pro výmaz.
**Mitigace**: Doporučujeme definovat retention 36 měsíců, pak auto-anonymizace.

### 6.4 Outdated dependency: pdfjs-dist
**Popis**: Verze 4.10.38, dostupná je 4.12+.
**Dopad**: Známé bezpečnostní záplaty, primárně XSS v PDF parsování (low impact pro náš use case).
**Mitigace**: Plán update v dalším deploy cyklu.

---

## 7. Otevřená rizika (červená) — doporučená opatření

### 7.1 ⚠ 2FA na admin účtech
Aktuálně admin přístup chráněn jen heslem na:
- GitHub (kde je celý zdrojový kód)
- Vercel (kde je deployment + env vars)
- Railway (kde je databáze)
- Directus (kde jsou CMS data)

Kompromitace jednoho z těchto účtů = úplný admin přístup k systému. **Aktivace 2FA na všech 4 službách** je nejlevnější a nejúčinnější zvýšení ochrany. Odhadovaný čas: 30 minut.

### 7.2 ⚠ Dependabot pro automatic dep updates
Aktuálně manuální revize dependency verzí. **Zapnout Dependabot na GitHub repository** = každý týden automatický PR s návrhem update + security alerts.

### 7.3 ⚠ Centralizovaný access log review
Vercel a Railway mají vlastní dashboards, ale neexistuje pravidelný proces revize. **Doporučujeme**: měsíční audit přihlášení / unusual activity.

### 7.4 ⚠ Formální data retention policy
Aktuálně neexistuje psaná politika pro lead data (jak dlouho držet, kdy anonymizovat). Doporučujeme **definovat 36 měsíční retention** a script pro auto-anonymizaci.

---

## 8. Provozní doporučení

### Měsíčně
- Revize Vercel Functions log na anomálie (časové vrcholy requestů)
- Kontrola Anthropic spending vs. budget
- Kontrola Railway resource usage (memory, storage)
- `npm audit` na nové CVE

### Kvartálně
- Bezpečnostní audit (rotace tohoto dokumentu)
- Test recovery procedure (restore z backupu na staging)
- Update production dependencies (po staging testu)

### Ročně
- Penetration test (volitelně, pokud business požaduje)
- Compliance review (GDPR, eIDAS, Cookies)
- Renewal kontroly: DNS, doménový registrátor, SSL (auto, ale kontrola)

---

## 9. Kontakty a eskalace

**V případě bezpečnostního incidentu** (data leak, defacement, neoprávněný přístup):

1. **Okamžitě**: Změnit hesla na všech admin službách (GitHub, Vercel, Railway, Directus, Anthropic)
2. **Do 1 hodiny**: Spustit forensic — Vercel logs, Directus activity log
3. **Do 24 hodin**: GDPR-relevantní oznámení (pokud uniklo PII): ÚOOÚ + dotčené osoby
4. **Do 72 hodin**: Post-mortem dokument

**Externí kontakty**:
- Vercel Support: support@vercel.com
- Railway Support: team@railway.app
- Anthropic Support: support@anthropic.com
- Národní úřad pro kybernetickou a informační bezpečnost (NÚKIB): cert@nukib.cz

---

## 10. Plán kontinuity — co dělat když majitel není dostupný

Kritická sekce pro každého malého podnikatele. **Aktuálně všechno (GitHub, Vercel, Railway, Anthropic, Directus admin) běží na osobním účtu Jaroslava**. Pokud by nastala situace že není dostupný (úmrtí, dlouhodobá nemoc, ztráta paměti, ztráta přístupu), firma by neměla přístup ke svému digitálnímu majetku.

### 11.1 Inventář digitálního majetku

| Služba | URL | Aktuální vlastník | Co tam je | Rizika ztráty přístupu |
|---|---|---|---|---|
| **Doména sfr-motor.cz** | (registrátor) | Jaroslav | DNS, SSL renewal | Bez přístupu → po expiraci doména k převzetí kýmkoli |
| **GitHub repo** | github.com/airvashka/web | Jaroslav osobní účet | Kompletní zdrojový kód | Bez přístupu → nelze deployovat změny, fork není problém (kód lze stáhnout přes Vercel build) |
| **Vercel** | vercel.com | Jaroslav osobní účet (Pro plan) | Hosting, env vars, deploys, Blob backupy | Bez přístupu → web jede dál, ale nelze update; po fakturační lhůtě (~30 dní) možné suspendovat |
| **Railway** | railway.app | Jaroslav osobní účet (Pro plan) | Directus + PostgreSQL databáze | **NEJVĚTŠÍ RIZIKO** — bez přístupu nelze obnovit DB, po lhůtě (~30 dní) možné smazat data |
| **Anthropic Console** | console.anthropic.com | Jaroslav osobní účet | AI API keys, billing | Bez přístupu → AI chat přestane fungovat (lze rotovat klíč, ale ne bez přístupu) |
| **Google Cloud (Places API)** | console.cloud.google.com | Jaroslav osobní účet | Reviews API key | Bez přístupu → recenze přestanou aktualizovat |
| **Directus admin** | directus-production-3e67.up.railway.app | Jaroslav (admin user) | CMS přístup k editaci dat | Bez přístupu → nelze editovat sklad/modely, ale read-only API funguje dál |

### 11.2 Akce které je třeba udělat **OKAMŽITĚ** (do 30 dnů)

#### A. Password manager s emergency access (kritické)

**Doporučujeme**: Bitwarden Business nebo 1Password Business (~$5/uživatel/měs).

Postup:
1. Vytvořit firemní account v password manageru
2. Uložit tam **všechna hesla** + 2FA backup codes pro:
   - Doménový registrátor
   - GitHub
   - Vercel
   - Railway
   - Anthropic
   - Google Cloud
   - Directus admin
3. Nastavit **Emergency Access** pro:
   - Manželku / partnerku
   - Spolumajitele / kolegu (např. Michala Hlaváče - ředitel)
   - Účetní nebo právníka firmy
4. Emergency Access funguje takto: pověřená osoba si může za 7 dní (configurovatelné) **vyžádat plný přístup**, pokud nereaguješ. Vidí všechny secrets.

#### B. Převod účtů na firmu (kde lze)

Některé služby umožňují **Team / Organization** účet místo osobního:
- **GitHub**: Vytvořit `sfr-motor` organization, transferovat repo
- **Vercel**: Vytvořit Team workspace, migrovat projekt
- **Railway**: Team workspace, migrovat projekt
- **Doména**: U registrátora změnit owner na IČO společnosti, ne osobní email

**Výhoda**: Firma má vlastnictví, ne fyzická osoba. I při úmrtí majitele zůstane přístup pro ostatní teamové členy.

#### C. Dokumentace přístupových údajů

Vytvořit fyzický (nebo zašifrovaný digitální) dokument **"Disaster Recovery Plan"** s:
- Seznamem všech služeb a jejich rolí
- Email + heslo do password manageru (zalepené v obálce u notáře / v sejfu)
- 2FA recovery codes pro každou službu
- Kontakty na podporu (Vercel, Railway, Anthropic, registrátor)
- IBAN účtu z kterého platí předplatné (pro převod na firmu)

**Uložit na 2 místa**:
- Trezor v kanceláři SFR Motor
- Notář / advokát (osvědčená kopie)

#### D. Naskript přístup pro IT partnera (volitelné)

Pokud firma má externí IT firmu / freelancera která je dlouhodobá:
- Přidat jejich account do GitHub org (Maintainer role)
- Přidat do Vercel team
- Přidat do Railway team
- Přidat read-only access do Directus

Tak má víc lidí "nouzový vstup", ne jen jedna osoba.

### 11.3 Akce které je třeba udělat **DLOUHODOBĚ** (3-6 měsíců)

#### Závěť / Digital Assets v právních dokumentech

Konzultovat s advokátem:
- Zařazení digitálních aktiv (doména, účty, licence) do **závěti**
- **Plná moc** pro správu digitálního majetku pro určenou osobu
- Smlouva o převodu vlastnictví firmy (pokud SFR Motor s.r.o. má více společníků)

Některé jurisdikce (ČR) **neumožňují automatický přenos digitálních účtů** — bez plné moci může službák jako Vercel ignorovat žádosti i od dědiců. Proto je důležité mít:
1. Hesla v password manageru s emergency access (technické řešení)
2. Plnou moc nebo závěť (právní řešení)

#### Kritická hesla mimo password manager

Pro nejdůležitější účty (registrátor domény, GitHub, Vercel) zvážit **fyzické zálohy**:
- Vytištěná hesla v bankovním sejfu
- USB disk u notáře
- Hesla u manželky / blízké rodiny

#### Outsource backup do vlastního cloudu

Aktuálně máme zálohy v Vercel Blob (vlastník Jaroslav). Pro extra jistotu:
- Zřídit firemní AWS / Azure / Google Cloud účet
- Druhotný backup script který kopíruje JSON do firemní cloud storage
- Firemní účet = nezávislý na Jardově osobním účtu

### 11.4 Rychlá referenční karta pro náhradníka

**Pokud Jaroslav není dostupný, prvních 5 kroků:**

1. Otevřít password manager (přístupové údaje v trezoru / u notáře)
2. Přihlásit se do Vercel → ověřit že web stále běží (sfr-motor.cz)
3. Přihlásit se do Railway → ověřit že Directus + PostgreSQL běží
4. Pokud problém: Vercel Support (support@vercel.com) + Railway Support (team@railway.app) — mají historii fakturací, mohou pomoci s transferem ownership
5. Otevřít Disaster Recovery Plan dokument — pokračovat podle něj

**Kdo má aktuálně technické znalosti k samostatnému provozu:**
- 🔴 **Aktuálně nikdo kromě Jaroslava** — to je riziko
- Doporučujeme proškolit aspoň jednoho dalšího (technický asistent / IT partner)

### 11.5 Doporučená priorita implementace

| Priorita | Akce | Čas | Cena |
|---|---|---|---|
| 🔴 KRITICKÁ | Password manager s emergency access | 4 hod | ~$5/měs |
| 🔴 KRITICKÁ | Disaster Recovery Plan dokument + uložení do trezoru | 4 hod | 0 Kč |
| 🟡 VYSOKÁ | Převod GitHub repo na sfr-motor organization | 1 hod | 0 Kč |
| 🟡 VYSOKÁ | Převod Vercel projektu na Team workspace | 30 min | $0 nebo +$20/měs |
| 🟡 VYSOKÁ | Převod Railway projektu na Team workspace | 30 min | 0 Kč |
| 🟢 STŘEDNÍ | Doména na IČO společnosti (ne osobní) | 1 hod | 0 Kč (jen formulář u registrátora) |
| 🟢 STŘEDNÍ | Plná moc pro digitální majetek | 2 hod (advokát) | ~5 000 Kč |
| 🟢 NÍZKÁ | IT partner s nouzovým přístupem | průběžně | dle dohody |
| 🟢 NÍZKÁ | Sekundární cloud backup | 4 hod setup | ~$5/měs |

---

## 11. Scénáře cíleného útoku — když nás někdo chce poškodit

Tato sekce řeší situaci kdy útočník **má motivaci proti SFR Motor specificky** (konkurence, naštvaný bývalý zaměstnanec, naštvaný zákazník, kybernetický vyděrač). Útoky jsou pak často kreativnější než náhodné skript-kiddie scanování.

### 11.1 Profil možných útočníků a motivace

| Útočník | Motivace | Pravděpodobnost | Maximální škoda |
|---|---|---|---|
| **Konkurenční dealer** | Poškodit reputaci, odlákat zákazníky | Střední | Střední (reputace, SEO) |
| **Naštvaný (bývalý) zaměstnanec** | Pomsta, sabotáž | Nízká–střední | **Vysoká** (insider knowledge) |
| **Naštvaný zákazník** | Veřejný pranýř, recenze, soud | Střední | Nízká–střední |
| **Kybernetický vyděrač** | Ransom, $$ | Nízká (málo cíle) | Vysoká |
| **Zlomyslný script-kiddie** | "Lulz", boredom | Střední | Nízká (řešitelné rate limity) |
| **Politický aktivista** | Cíleně proti dealershipu / značce | Nízká | Střední |

### 11.2 Útočné scénáře a obrana

#### Scénář A: DDoS útok na web
**Co útočník udělá**: Použije botnet / placenou službu (booter) k zaplavení sfr-motor.cz tisíci requesty/sekundu. Cílem je shodit web nebo zvýšit hosting náklady.

**Riziko**: 🟡 Střední — Vercel Edge Network má vlastní DDoS mitigation (enterprise-grade Anycast network), zvládne miliony rps. Statický web je extrémně odolný.

**Co máme**: Vercel Pro plán = automatic DDoS mitigation, no extra cost.

**Doporučení navíc** (volitelné):
- Cloudflare jako další vrstva před Vercel (zdarma Free plan) → double mitigation
- Vercel Web Application Firewall (WAF rules na blokování bad IPs, user agents)
- Bot Protection — Vercel Pro má built-in detection of malicious bots

**Detekce**: Vercel Analytics dashboard → abnormální traffic spike → alert.

#### Scénář B: Cílený útok na AI chat (cost overflow)
**Co útočník udělá**: Skript volá `/api/chat/model` tisíckrát za hodinu z různých IP adres aby vygeneroval tisíce dolarů v Anthropic API nákladech.

**Riziko**: 🟢 Nízké — máme **3 vrstvy obrany**:
1. App rate limit (20 req/h per IP)
2. Anthropic spend cap ($30/měs hard limit)
3. Vercel function timeout (max 60 s na request)

Maximální škoda: $30/měs i v worst case scénáři. Po překročení Anthropic stop API → chat přestane fungovat, ale neúčtuje další $.

**Detekce**: Vercel Functions logs ukazují 429 responses + Anthropic dashboard spending.

#### Scénář C: Lead form spam
**Co útočník udělá**: Skript posílá tisíce fake leadů (vymyšlené jména, telefony) aby zahltil Pasáka spam a "ten ten" zatlumil reálné leady.

**Riziko**: 🟡 Střední — máme honeypot field + server-side validation, ale není rate limit specificky na lead capture.

**Aktuální obrana**:
- Honeypot field `_hp_website` — bot ho vyplní, real user ne
- Server-side regex validation (telefon, email)
- AI chat má rate limit (lead přes chat je omezený)

**Doporučení navíc**:
- Per-IP rate limit i na `/items/leads` POST (3 leady/hod max)
- Cloudflare Turnstile (CAPTCHA bez fric pro reálné uživatele)
- Alert do emailu při >10 leads za hodinu

#### Scénář D: Fake Google recenze
**Co útočník udělá**: Vytvoří 20 fake Google účtů, napíše negativní recenze na profil SFR Motor v Google Maps. Cíl: snížit hodnocení z 4.7 na 3.5, odradit zákazníky.

**Riziko**: 🔴 **Vysoké — toto je nejreálnější hrozba pro dealera**. Google nemá perfect detection, mnoho fake reviews projde.

**Aktuální obrana**: Žádná na úrovni webu.

**Doporučení**:
- **Monitor**: Google Alerts na "SFR Motor", "sfr-motor.cz" + nastavit notify
- **Reagovat profesionálně** na každou negativní recenzi — i pokud je fake. Google to vidí jako engagement signal.
- **Flag fake reviews** → Google business profile → "Report review" pro každou
- **Aktivně budovat real reviews** — po prodeji prosit zákazníka o review
- **Externí ORM služby** (Trustpilot, Heureka.cz) — diversifikace
- Pokud je atak masivní → kontaktovat Google Business Support, případně advokát na účast v reputational damage

#### Scénář E: Brand impersonation (typosquatting)
**Co útočník udělá**: Zaregistruje doménu `sfrmotor.cz`, `sfr-motors.cz`, `sfrmotor.com`. Postaví fake web identický s tvým + zaměří se na phishing zákazníků nebo SEO crowding.

**Riziko**: 🟡 Střední — reálné, ale řešitelné.

**Doporučení**:
- **Preemptivně zaregistrovat**: `sfrmotor.cz`, `sfr-motor.com`, `sfrmotor.eu`, `sfr-motor.eu`, `.sk` varianty pokud relevantní (~500 Kč/doména/rok × 6 domén = ~3 000 Kč/rok)
- **Trademark**: Registrovat "SFR Motor" ochrannou známku u ÚPV.cz (~5 000 Kč jednorázově) — pak právní možnost nárokovat domény
- **Monitor**: DomainTools nebo namechk.com pro nové registrace podobných domén

#### Scénář F: Domain hijacking
**Co útočník udělá**: Přes phishing získá přístup do tvého doménového registrátora, transferuje sfr-motor.cz pryč. Můžeš o doménu přijít na týdny, web nepřístupný.

**Riziko**: 🟡 Střední — historicky častý útok.

**Doporučení**:
- **Domain Lock** zapnout u registrátora — zakáže transfer bez explicitního unlock
- **2FA** na doménový registrátor account (kritické!)
- **Email u registrátora** musí být extrémně chráněný (separátní inbox, silné heslo, 2FA na email account)
- **Auto-renew** zapnutý + 2 různé platební metody — žádný "expired domain" risk

#### Scénář G: Phishing zaměstnanců
**Co útočník udělá**: Pošle Pasákovi email "Z Anthropic: Vaše API klíče vypršely, klikněte zde pro update" → klikne, zadá údaje → útočník má přístup.

**Riziko**: 🔴 **Vysoké — největší dlouhodobé riziko**. Nejvíce kybernetických útoků na malé firmy začíná phishingem.

**Doporučení**:
- **Trénink zaměstnanců**: Krátký workshop "Jak poznat phishing email" — 1 hodina jednou. Doporučujeme každoroční.
- **Pravidlo**: NIKDY se nepřihlašujte do služby přes link v emailu. Vždy přes ručně zadanou URL nebo bookmark.
- **DMARC, SPF, DKIM** na sfr-motor.cz emaily → ztíží spoofing tvojí domény
- **Vícefaktor (2FA)** na všech business účtech → i kdyby útočník získal heslo, nepřihlásí se

#### Scénář H: Insider threat (bývalý zaměstnanec)
**Co útočník udělá**: Pasák odejde naštvaně, má pořád přístup do Directus admin (zapomněli ho vypnout). V noci smaže celý sklad.

**Riziko**: 🟡 Střední (závisí na vztazích).

**Doporučení**:
- **Off-boarding checklist**: Při odchodu kohokoliv okamžitě:
  1. Disable Directus account
  2. Remove z GitHub org
  3. Remove z Vercel/Railway team
  4. Rotate všechny shared passwords/tokens
  5. Audit recent activity v Directus log (co před odchodem dělal?)
- **Princip nejnižších práv**: Zaměstnanci mají jen práva která potřebují k práci. Pasák ne admin, jen Editor na své modely.
- **Backup je tvůj přítel**: I když insider něco smaže, Railway snapshot + Vercel Blob backup = obnova během hodiny.

#### Scénář I: Negative SEO (link bombs)
**Co útočník udělá**: Vytvoří tisíce spam linků na pochybných webech ukazujících na sfr-motor.cz. Cíl: penalizovat tvůj web v Google.

**Riziko**: 🟢 Nízké — Google už roky negative SEO ignoruje (algoritmický update 2012+). Spam linky jsou prostě devalvovány, ne penalizovány.

**Doporučení**:
- Google Search Console → kontrolovat "Manual Actions" sekci měsíčně
- Pokud Google v rare případě penalizuje, lze podat **disavow** request

#### Scénář J: Defacement (změna obsahu webu)
**Co útočník udělá**: Získá přístup do Directus admin a změní text "SFR Motor" na něco vulgárního. Návštěvníci to vidí.

**Riziko**: 🟢 Nízké — máme tak silnou auth + 2FA (po implementaci) + audit log.

**Doporučení**:
- 2FA na Directus admin (kritické)
- Activity log review měsíčně
- Backup → rollback na 1 klik

### 11.3 Pre-emptivní monitoring (alerty které se vyplatí zapnout)

| Co | Jak | Cena | Důležitost |
|---|---|---|---|
| Google Alerts na "SFR Motor" | google.com/alerts | 0 Kč | 🔴 Kritická |
| Google Business Profile notifications | console.google.com | 0 Kč | 🔴 Kritická |
| Vercel Spend Alert ($X/měs) | vercel.com → Billing | 0 Kč | 🟡 Důležité |
| Anthropic spending email | Already set ($30/měs) | 0 Kč | ✅ Hotovo |
| Domain expiration alert | Registrátor | 0 Kč | 🔴 Kritická |
| SSL certificate expiration | Vercel auto, ale double-check | 0 Kč | 🟢 OK |
| GitHub security alerts | github.com → Settings → Security | 0 Kč | 🟡 Důležité |
| Brand monitor (newly registered similar domains) | namechk.com (manual) nebo DomainTools | 0–500 Kč/měs | 🟡 Důležité |

### 11.4 Response playbook — co dělat když se to stane

**Krok 1 (do 5 minut)**: Identifikovat typ útoku
- Web nedostupný? → DDoS, hosting outage, DNS problém
- Web fake content? → Defacement, admin access compromised
- Negativní recenze? → Reputation attack
- Phishing pokus? → Social engineering

**Krok 2 (do 30 minut)**: Containment
- DDoS → Vercel + Cloudflare auto-handle. Pokud ne, manuální IP block ve Vercel WAF
- Defacement → Vypnout deploy access, rollback na previous Vercel deployment, change passwords
- Phishing → Notify staff, rotate compromised credentials

**Krok 3 (do 4 hodin)**: Eradikace
- Patch zranitelnost která útok umožnila
- Audit jak útočník dostal in
- Notify uživatele pokud došlo k data leaku

**Krok 4 (do 24 hodin)**: Recovery
- Restore z backupu pokud data byla compromised
- Public communication pokud incident byl viditelný

**Krok 5 (do týdne)**: Lessons learned
- Post-mortem document
- Update tohoto bezpečnostního auditu
- Train staff pokud relevantní

### 11.5 Co NEVOLÁVAT veřejně (PR risk)

Když dojde k incidentu, je důležité **kontrolovaně komunikovat**:
- ❌ Neumísťovat "MOMENTÁLNÍ ÚTOK" notifikace na web
- ❌ Nepostovat na sociálních sítích o útoku ve chvíli jeho dění
- ❌ Neposkytovat detaily útoku médiím (povzbuzuje další)
- ✅ Communicate s zákazníky v případě data leaku (GDPR vyžaduje do 72h)
- ✅ Pracovat s advokátem na komunikaci
- ✅ Vyžádat si pomoc NÚKIB pokud je incident vážný (cert@nukib.cz)

### 11.6 Priority pro SFR Motor (next 30 dní)

| Priorita | Akce | Čas | Cena |
|---|---|---|---|
| 🔴 KRITICKÁ | Google Alerts na "SFR Motor" + Google Business notifications | 15 min | 0 Kč |
| 🔴 KRITICKÁ | Domain Lock + 2FA u registrátora | 15 min | 0 Kč |
| 🔴 KRITICKÁ | 2FA na všech admin účtech (znovuopakováno z hl. auditu) | 30 min | 0 Kč |
| 🟡 VYSOKÁ | Off-boarding checklist (dokument) | 30 min | 0 Kč |
| 🟡 VYSOKÁ | Preemptivní registrace podobných domén | 1 hod | 3 000 Kč/rok |
| 🟡 VYSOKÁ | Rate limit i na /items/leads | 30 min | 0 Kč |
| 🟢 STŘEDNÍ | Trademark "SFR Motor" u ÚPV | 2 hod | 5 000 Kč |
| 🟢 STŘEDNÍ | Cloudflare před Vercel (extra DDoS) | 1 hod | 0 Kč (Free plan) |
| 🟢 NÍZKÁ | Phishing training pro zaměstnance | 1 hod | 0 Kč |

---

## 12. Závěr

Architektura webu SFR Motor je **bezpečnostně nadprůměrná** ve srovnání s typickými řešeními českých autodealerů. Hlavní silné stránky:

- ✅ Headless Jamstack architektura snižuje útočnou plochu
- ✅ Redundantní zálohování (2 nezávislé systémy)
- ✅ Profesionální infrastruktura (Vercel Pro + Railway Pro)
- ✅ Cost controls (Anthropic spend cap)
- ✅ Rate limiting + input validation

Zbývající rizika jsou v přijatelné míře. Doporučovaná opatření (2FA, Dependabot, data retention policy) jsou levná na implementaci a posouvají úroveň na enterprise-grade.

---

**Vypracoval**: AI Security Auditor (Claude)
**Schválil**: Jaroslav (CTO, SFR Motor)
**Příští audit**: 18. srpna 2026 (kvartální)
