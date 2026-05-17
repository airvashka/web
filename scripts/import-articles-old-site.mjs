#!/usr/bin/env node
/**
 * SFR Motor — Import článků ze starého webu stock.sfrmotor.kgmcars.cz/aktuality
 *
 * Co dělá:
 *   1) Playwrightem projde 3 listing stránky pagination
 *   2) Pro každý článek otevře Playwrightem detail a v browseru přes Range API
 *      vytáhne tělo článku (mezi <h1> a "Zveřejněno") — žádné HTML slicing v Node
 *   3) Hero + inline obrázky stáhne → uploadne do Directusu do folderu "Aktuality - import"
 *   4) Body HTML → Markdown přes turndown (tabulky zachová jako HTML)
 *   5) Vytvoří článek v collection `articles` jako DRAFT (status='draft')
 *
 * Idempotentní:
 *   - Existující article se status=draft + prázdný body  → UPDATE (opraví)
 *   - Existující article se status=draft + plný body     → SKIP (zachová tvoje úpravy)
 *   - Existující article se status=published             → SKIP (nikdy nepřepíšeme publikovaný)
 *
 * Použití:
 *   cd "C:\Users\antos\Desktop\Claude\SFR WEB\SFR WEB\web"
 *   npm install
 *   npx playwright install chromium    # pokud poprvé
 *   node scripts/import-articles-old-site.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import TurndownService from 'turndown';
import { chromium } from 'playwright';

const OLD_BASE = 'https://stock.sfrmotor.kgmcars.cz';
const LIST_URL = `${OLD_BASE}/aktuality`;

const AUTHOR = 'SFR Motor';
const DEFAULT_STATUS = 'draft';
const FOLDER_NAME = 'Aktuality - import';

const rl = readline.createInterface({ input, output });
const prompt = (q) => rl.question(q);

let URL = '', TOKEN = '';

/* ──────────── HELPERS ─────────── */

async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const opts = { method, headers };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${URL}${path}`, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) {
    const errMsg = JSON.stringify(j?.errors ?? j).slice(0, 500);
    throw new Error(`${method} ${path} → ${r.status}: ${errMsg}`);
  }
  return j;
}

const ok = (m) => console.log(`  ✓  ${m}`);
const info = (m) => console.log(`  ℹ  ${m}`);
const warn = (m) => console.log(`  ⚠  ${m}`);
const fail = (m) => console.log(`  ✗  ${m}`);

function parseCsDate(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function slugFromUrl(url) {
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').replace(/\/$/, '');
  return path.split('/').pop() || '';
}

/* ──────────── DIRECTUS ─────────── */

async function ensureFolder() {
  const r = await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent(FOLDER_NAME)}&limit=1&fields=id`);
  if (r.data?.length) return r.data[0].id;
  const c = await api('POST', '/folders', { name: FOLDER_NAME });
  return c.data.id;
}

async function uploadImage(srcUrl, title, folderId) {
  const r = await fetch(srcUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`download ${srcUrl} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get('content-type') || 'image/jpeg';
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
  const safeName = title.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase().slice(0, 60);
  const filename = `${safeName || 'image'}-${Date.now()}.${ext}`;

  const fd = new FormData();
  fd.append('folder', folderId);
  fd.append('title', title);
  fd.append('file', new Blob([buf], { type: ct }), filename);
  const u = await api('POST', '/files', fd);
  return u.data.id;
}

/* ──────────── TURNDOWN ─────────── */

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
});
turndown.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption']);
turndown.addRule('linkAroundImage', {
  filter: (node) =>
    node.nodeName === 'A' && node.children.length === 1 && node.firstChild?.nodeName === 'IMG',
  replacement: (content) => content,
});

/* ──────────── PLAYWRIGHT: LISTING + DETAIL ─────────── */

async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 SFR-Migration' });
  try {
    return await fn(ctx);
  } finally {
    await browser.close();
  }
}

async function scrapeListing(ctx) {
  info('Otevírám listing /aktuality...');
  const page = await ctx.newPage();
  await page.goto(LIST_URL, { waitUntil: 'networkidle' });

  const allUrls = new Set();

  async function collect() {
    const urls = await page.$$eval('a[href*="/aktuality/"]', (links) =>
      links.map((a) => a.href).filter((h) => /\/aktuality\/[^/?#]+$/.test(h)),
    );
    urls.forEach((u) => allUrls.add(u));
    return urls.length;
  }

  await collect();
  info(`  stránka 1: ${allUrls.size} článků`);

  // Pagination — z DOMu vezmeme href atributy pagination linků (typicky ?articleList-page=N)
  const paginationHrefs = await page.$$eval(
    'a[href*="articleList-page"]',
    (links) =>
      Array.from(new Set(links.map((a) => a.href).filter((h) => /articleList-page=\d/.test(h)))),
  );

  for (const href of paginationHrefs) {
    try {
      info(`  → ${href}`);
      await page.goto(href, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const before = allUrls.size;
      await collect();
      info(`    +${allUrls.size - before} článků (celkem ${allUrls.size})`);
    } catch (e) {
      warn(`  pagination ${href}: ${e.message}`);
    }
  }

  await page.close();
  return Array.from(allUrls);
}

/**
 * V browseru najde article title h1 (skip "Skladové vozy"), pak přes Range API
 * extrahuje HTML mezi titulkem a "Zveřejněno". Vrací clean strukturu.
 */
async function fetchArticle(ctx, url) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  const data = await page.evaluate((BASE) => {
    // ── TITLE ──
    // Primární: <h1 class="caption__title">. Fallback: první h1 který není "Skladové vozy".
    let titleEl = document.querySelector('h1.caption__title, .caption__title');
    if (!titleEl) {
      const h1s = Array.from(document.querySelectorAll('h1'));
      titleEl = h1s.find((h) => {
        const t = (h.textContent || '').trim();
        return t && !/^skladové vozy$/i.test(t);
      }) || null;
    }
    if (!titleEl) return { error: 'title not found' };
    const title = titleEl.textContent.trim();

    // ── ARTICLE CONTAINER ──
    // <article class="simple-article"> → <div class="simple-article__container">
    let container = document.querySelector('article.simple-article .simple-article__container')
      || document.querySelector('article.simple-article')
      || document.querySelector('.simple-article__container');

    // Fallback: pokud article container nenajdeme, zkus <main> > article
    if (!container) container = document.querySelector('main article, main');
    if (!container) return { error: 'article container not found' };

    // Clone aby manipulace neovlivnila live DOM
    const clone = container.cloneNode(true);

    // ── HERO IMAGE ──
    // <figure class="simple-article__image"><img></figure>
    const heroFig = clone.querySelector('figure.simple-article__image, .simple-article__image');
    const heroImg = heroFig?.querySelector('img');
    const heroSrc = heroImg?.getAttribute('src') || null;
    // Odstraň hero z clone (zobrazí se přes cover_image)
    heroFig?.remove();

    // ── DATE ──
    const dateEl = clone.querySelector('.simple-article__date');
    let dateText = null;
    if (dateEl) {
      const m = dateEl.textContent.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
      if (m) dateText = `${m[1]}. ${m[2]}. ${m[3]}`;
    }
    if (!dateText) {
      // Fallback: hledat kdekoliv v body
      const m = (document.body.textContent || '').match(/Zveřejněno\s+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/);
      dateText = m?.[1] || null;
    }
    // Odstraň date z body (zobrazí se přes date_published)
    dateEl?.remove();

    // ── CLEANUP: agresivní inline styly z Office paste ──
    // <p style="margin:0cm"><span style="font-size:12pt"><span style="font-family:Aptos,sans-serif">text</span></span></p>
    // → unwrap zbytečné spans, odstraň useless style atributy
    clone.querySelectorAll('span[style]').forEach((sp) => {
      // unwrap span — ponech jen jeho děti
      const parent = sp.parentNode;
      while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
      sp.remove();
    });
    clone.querySelectorAll('[style]').forEach((el) => {
      const style = el.getAttribute('style') || '';
      // Ponech jen relevantní style (text-align, color), ostatní (font-family, font-size, margin)
      // raději celé pryč pro čistý markdown.
      if (!/text-align|color/i.test(style)) {
        el.removeAttribute('style');
      }
    });
    // &nbsp;-only odstavce → odstraň (jsou to vizuální mezery, MD je nepotřebuje)
    clone.querySelectorAll('p').forEach((p) => {
      const text = p.textContent.replace(/[\s ]+/g, '').trim();
      if (!text) p.remove();
    });

    // ── INLINE IMAGES URLs ──
    const imgs = Array.from(clone.querySelectorAll('img'))
      .map((img) => {
        const src = img.getAttribute('src') || '';
        return src.startsWith('http') ? src : (src ? BASE + src : '');
      })
      .filter((s) => s && s.includes('/file/sdff-get'));

    const heroSrcFull = heroSrc
      ? (heroSrc.startsWith('http') ? heroSrc : BASE + heroSrc)
      : null;

    const bodyHtml = clone.innerHTML;

    const debug = {
      titleSelector: titleEl.className || titleEl.tagName,
      containerClass: container.className || container.tagName,
      bodyHtmlLen: bodyHtml.length,
      inlineImgs: imgs.length,
      heroFound: !!heroSrcFull,
    };

    return {
      title,
      bodyHtml,
      heroSrc: heroSrcFull,
      imgs,
      dateText,
      debug,
    };
  }, OLD_BASE);

  await page.close();
  return data;
}

/* ──────────── ARTICLE PROCESSING ─────────── */

function categoryFromTitle(title) {
  const t = (title || '').toLowerCase();
  if (/poděkování|vánoč|pf 20/.test(t)) return 'zpravy';
  if (/test|recenze/.test(t)) return 'recenze';
  if (/srovnání/.test(t)) return 'srovnani';
  return 'novinka';
}

function htmlToCleanMarkdown(html) {
  let md = turndown.turndown(html || '').trim();
  // Smaž obří mezery
  md = md.replace(/\n{3,}/g, '\n\n');
  // Smaž samostatné neviditelné podtržítka apod
  md = md.replace(/^[\s_]+$/gm, '');
  return md;
}

/**
 * Existing item lookup: { id, status, body } | null
 */
async function findExistingArticle(slug) {
  const r = await api(
    'GET',
    `/items/articles?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1&fields=id,status,body`,
  );
  return r.data?.[0] ?? null;
}

async function processArticle(ctx, url, folderId) {
  const slug = slugFromUrl(url);
  if (!slug) throw new Error('prázdný slug');

  const existing = await findExistingArticle(slug);

  // Rozhodnutí: SKIP / UPDATE / CREATE
  if (existing) {
    if (existing.status === 'published') {
      info(`${slug} — published v Directusu, neměním`);
      return { status: 'skipped-published' };
    }
    const hasBody = existing.body && existing.body.trim().length > 50;
    if (hasBody) {
      info(`${slug} — draft už má body (${existing.body.length} znaků), skipping`);
      return { status: 'skipped-has-body' };
    }
    info(`${slug} — draft s prázdným body, UPDATING`);
  }

  // ── FETCH + PARSE v browseru ──
  const data = await fetchArticle(ctx, url);
  if (data.error) throw new Error(`parse error: ${data.error}`);
  const { title, bodyHtml, heroSrc, imgs, dateText, debug } = data;

  if (!bodyHtml || bodyHtml.trim().length < 20) {
    throw new Error(
      `body extraction prázdné — debug: ${JSON.stringify(debug)}`,
    );
  }

  // ── HERO ──
  let coverImageId = null;
  if (heroSrc) {
    try {
      coverImageId = await uploadImage(heroSrc, `${slug} hero`, folderId);
      ok(`  hero image uploaded`);
    } catch (e) {
      warn(`  hero upload: ${e.message}`);
    }
  }

  // ── INLINE IMAGES ── (hero už je vyjmutý ze cloned containeru v evaluate)
  let workingHtml = bodyHtml;
  for (const imgUrl of imgs) {
    try {
      const uuid = await uploadImage(imgUrl, `${slug} inline`, folderId);
      const newSrc = `${URL}/assets/${uuid}`;
      const relPath = imgUrl.replace(OLD_BASE, '');
      workingHtml = workingHtml.split(imgUrl).join(newSrc).split(relPath).join(newSrc);
    } catch (e) {
      warn(`  inline image: ${e.message}`);
    }
  }

  // HTML → Markdown
  const bodyMd = htmlToCleanMarkdown(workingHtml);

  // Excerpt — prvních ~200 znaků plain textu z HTML
  const plainText = bodyMd
    .replace(/[#*_`>\-]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const excerpt = plainText.slice(0, 200).trim() + (plainText.length > 200 ? '…' : '');

  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  const readMin = Math.max(1, Math.round(wordCount / 200));
  const readTime = `${readMin} min`;
  const datePublished = parseCsDate(dateText);

  const payload = {
    slug,
    title,
    excerpt,
    body: bodyMd,
    cover_image: coverImageId,
    category: categoryFromTitle(title),
    author: AUTHOR,
    read_time: readTime,
    date_published: datePublished,
    status: DEFAULT_STATUS,
    featured: false,
  };

  if (existing) {
    await api('PATCH', `/items/articles/${existing.id}`, payload);
    ok(`${slug} → UPDATED (${datePublished ?? '?'}, ${wordCount} slov)`);
    return { status: 'updated', slug };
  } else {
    await api('POST', '/items/articles', payload);
    ok(`${slug} → CREATED (${datePublished ?? '?'}, ${wordCount} slov)`);
    return { status: 'created', slug };
  }
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ──────────── MAIN ─────────── */

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Import článků ze starého webu');
  console.log('═══════════════════════════════════════════════\n');

  URL = (await prompt('Directus URL [https://directus-production-3e67.up.railway.app]: ')).trim()
    || 'https://directus-production-3e67.up.railway.app';
  const email = (await prompt('Email: ')).trim();
  const password = (await prompt('Heslo: ')).trim();
  console.log('');

  const auth = await api('POST', '/auth/login', { email, password });
  TOKEN = auth.data.access_token;
  ok('Auth OK');

  const folderId = await ensureFolder();
  ok(`Folder "${FOLDER_NAME}" → ${folderId}\n`);

  await withBrowser(async (ctx) => {
    console.log('─── Listing ───');
    const articleUrls = await scrapeListing(ctx);
    info(`Celkem nalezeno: ${articleUrls.length} URL\n`);

    if (!articleUrls.length) {
      warn('Listing prázdný — nic ke zpracování.');
      return;
    }

    console.log('─── Import článků ───');
    let created = 0, updated = 0, skipped = 0, failed = 0;
    for (const url of articleUrls) {
      console.log(`\n→ ${url}`);
      try {
        const r = await processArticle(ctx, url, folderId);
        if (r.status === 'created') created++;
        else if (r.status === 'updated') updated++;
        else skipped++;
      } catch (e) {
        fail(e.message);
        failed++;
      }
    }

    console.log('\n═══════════════════════════════════════════════');
    console.log(`  Hotovo. Vytvořeno ${created}, updated ${updated}, skipnuto ${skipped}, chyb ${failed}.`);
    console.log('');
    console.log('  KROK 2:');
    console.log('    Directus admin → Articles → filter status=draft');
    console.log('    Projdi články, uprav body, publikuj co chceš.');
    console.log('═══════════════════════════════════════════════');
  });

  rl.close();
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  rl.close();
  process.exit(1);
});
