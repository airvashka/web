# SFR Motor — Web (Astro)

Veřejný web pro SFR Motor s.r.o. — autorizovaný dealer KGM, OMODA & JAECOO, Farizon.

## Stack

- **Astro 5** — statický site generátor s opt-in serverovými ostrůvky
- **TypeScript** strict mode
- **Vanilla CSS** s design tokens (žádný Tailwind ani jiný CSS framework)
- **Sharp** pro image processing
- **Directus** jako backend / CMS (žije separátně, viz `../directus/`)

## Struktura

```
web/
├── public/                # Statické soubory (favicon, robots.txt, …)
├── src/
│   ├── components/        # Astro komponenty (Header, Footer, …)
│   ├── layouts/           # BaseLayout
│   ├── lib/               # Helpers (Directus client, types)
│   ├── pages/             # File-based routing
│   │   ├── index.astro    # Homepage
│   │   ├── model/[slug].astro
│   │   ├── sklad/index.astro
│   │   ├── sklad/[slug].astro
│   │   └── api/lead.ts    # Lead form endpoint
│   ├── styles/global.css  # Design tokens + globální styly
│   └── env.d.ts
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

## Lokální spuštění

```bash
npm install
npm run dev
```

Web poběží na `http://localhost:4321`.

## Build pro produkci

```bash
npm run build
npm run preview  # ověření před deployem
```

Build vygeneruje statický HTML do `dist/`. Tu složku Vercel automaticky uploaduje.

## Environment variables

Vytvoř `.env` z `.env.example`:

```bash
PUBLIC_DIRECTUS_URL=https://your-directus.up.railway.app
```

## Deploy

Frontend se deployuje na **Vercel** automaticky při push do `main` branch GitHubu.
Backend (Directus) běží na **Railway** zvlášť.
