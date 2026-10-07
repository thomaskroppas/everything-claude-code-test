#!/usr/bin/env node
// Builds «Отсечка» from content/articles/*.md:
//   dist/                    — static multi-page site (deploy to any static host)
//   dist-artifact/index.html — the same site as one self-contained page with hash routing
// Usage: node build.mjs            (SITE_URL=https://example.com node build.mjs for absolute sitemap/RSS links)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Site = require('./src/site.js');
const SITE_URL = (process.env.SITE_URL || 'https://otsechka.example').replace(/\/$/, '');
const FONTS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Manrope:wght@400;500;600&display=swap';

// ---------- load + validate ----------
const dir = path.join(ROOT, 'content/articles');
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/plan.json'), 'utf8'));
const problems = [];
const loaded = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
  const a = Site.parseArticle(fs.readFileSync(path.join(dir, f), 'utf8'));
  const slug = f.replace(/\.md$/, '');
  for (const k of ['title', 'slug', 'category', 'date', 'excerpt']) if (!a[k]) problems.push(`${f}: missing ${k}`);
  if (a.slug !== slug) problems.push(`${f}: slug "${a.slug}" does not match file name`);
  if (!Site.CAT[a.category]) problems.push(`${f}: unknown category "${a.category}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) problems.push(`${f}: bad date "${a.date}"`);
  if (a.words < 600) problems.push(`${f}: only ${a.words} words`);
  return a;
});
const missing = plan.filter((p) => !loaded.some((a) => a.slug === p.slug)).map((p) => p.slug);
if (missing.length) console.warn(`[build] ${missing.length} planned articles not written yet: ${missing.join(', ')}`);
if (problems.length) { console.error('[build] content problems:\n  ' + problems.join('\n  ')); process.exit(1); }
const articles = Site.prepare(loaded);
Site.ART.hero = fs.readFileSync(path.join(ROOT, 'src/art/hero-car.svg'), 'utf8').replace(/<svg /, '<svg preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" ');

// ---------- static site ----------
const OUT = path.join(ROOT, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, html) => { const p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, html); };

function links(prefix) {
  return {
    home: prefix + 'index.html',
    archive: prefix + 'archive.html',
    about: prefix + 'about.html',
    article: (slug) => `${prefix}articles/${slug}.html`,
    category: (id) => `${prefix}category/${id}.html`,
    asset: (p) => prefix + p,
    rss: prefix + 'rss.xml',
  };
}

function page({ rel, title, description, active, body, jsonld, ogType, date, rootRelative }) {
  const depth = rel.split('/').length - 1;
  const prefix = rootRelative ? '/' : '../'.repeat(depth);
  const L = links(prefix);
  const fullTitle = title ? `${title} — ${Site.SITE.name}` : `${Site.SITE.name} — журнал об автомобилях`;
  const url = `${SITE_URL}/${rel === 'index.html' ? '' : rel}`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${Site.esc(fullTitle)}</title>
<meta name="description" content="${Site.esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:site_name" content="${Site.SITE.name}">
<meta property="og:type" content="${ogType || 'website'}">
<meta property="og:title" content="${Site.esc(title || Site.SITE.name)}">
<meta property="og:description" content="${Site.esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary">${date ? `\n<meta property="article:published_time" content="${date}">` : ''}${rootRelative ? '\n<meta name="robots" content="noindex">' : ''}
<meta name="theme-color" content="#0a0a0b">
<link rel="alternate" type="application/rss+xml" title="${Site.SITE.name}" href="${prefix}rss.xml">
<link rel="icon" href="${prefix}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
<link rel="stylesheet" href="${prefix}assets/style.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
${Site.header(L, active, articles)}
${body(L)}
${Site.footer(L, articles)}
<script src="${prefix}assets/client.js" defer></script>
</body>
</html>
`;
}

write('index.html', page({ rel: 'index.html', description: `${Site.SITE.tagline}. ${articles.length} ${Site.plural(articles.length, 'статья', 'статьи', 'статей')} в ${Site.CATEGORIES.length} рубриках.`, active: 'home', body: (L) => Site.home(L, articles),
  jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: Site.SITE.name, url: SITE_URL + '/', inLanguage: 'ru', description: Site.SITE.tagline } }));
write('archive.html', page({ rel: 'archive.html', title: 'Все статьи', description: `Архив журнала «${Site.SITE.name}»: все ${articles.length} статей с поиском и фильтром по рубрикам.`, active: 'archive', body: (L) => Site.archivePage(L, articles) }));
write('about.html', page({ rel: 'about.html', title: 'О журнале', description: `Что такое «${Site.SITE.name}» и как устроен журнал.`, active: 'about', body: (L) => Site.aboutPage(L, articles) }));
write('404.html', page({ rel: '404.html', title: 'Страница не найдена', description: `Такой страницы в журнале «${Site.SITE.name}» нет. Вернитесь на главную или откройте архив статей.`, active: '', rootRelative: true, body: (L) => Site.notFound(L) }));
for (const c of Site.CATEGORIES) {
  write(`category/${c.id}.html`, page({ rel: `category/${c.id}.html`, title: c.name, description: `${c.blurb} Все статьи рубрики «${c.name}».`, active: c.id, body: (L) => Site.categoryPage(L, c, articles) }));
}
for (const a of articles) {
  write(`articles/${a.slug}.html`, page({
    rel: `articles/${a.slug}.html`, title: a.title, description: a.excerpt, active: 'article', ogType: 'article', date: a.date,
    body: (L) => Site.articlePage(L, a, articles),
    jsonld: { '@context': 'https://schema.org', '@graph': [
      {
        '@type': 'Article', headline: a.title, description: a.excerpt, url: `${SITE_URL}/articles/${a.slug}.html`,
        datePublished: a.date, dateModified: a.date, inLanguage: 'ru', articleSection: Site.CAT[a.category].name, keywords: a.tags.join(', '),
        wordCount: a.words, image: `${SITE_URL}/assets/covers/${a.slug}.svg`,
        author: { '@type': 'Organization', name: `Редакция «${Site.SITE.name}»`, url: SITE_URL + '/' },
        publisher: { '@type': 'Organization', name: Site.SITE.name, url: SITE_URL + '/' }, mainEntityOfPage: `${SITE_URL}/articles/${a.slug}.html`,
      },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE_URL + '/' },
        { '@type': 'ListItem', position: 2, name: Site.CAT[a.category].name, item: `${SITE_URL}/category/${a.category}.html` },
        { '@type': 'ListItem', position: 3, name: a.title },
      ] },
    ] },
  }));
}
fs.mkdirSync(path.join(OUT, 'assets/covers'), { recursive: true });
for (const a of articles) fs.writeFileSync(path.join(OUT, `assets/covers/${a.slug}.svg`), Site.cover(a));
fs.copyFileSync(path.join(ROOT, 'src/style.css'), path.join(OUT, 'assets/style.css'));
fs.copyFileSync(path.join(ROOT, 'src/client.js'), path.join(OUT, 'assets/client.js'));
if (fs.existsSync(path.join(ROOT, 'photos'))) fs.cpSync(path.join(ROOT, 'photos'), path.join(OUT, 'photos'), { recursive: true });
write('assets/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#14171c"/><path d="M12 44a20 20 0 0 1 40 0" fill="none" stroke="#eceef0" stroke-width="5"/><path d="M45 30a20 20 0 0 1 7 14" fill="none" stroke="#d63a20" stroke-width="5"/><path d="M32 44 46 26" stroke="#ffc21a" stroke-width="5" stroke-linecap="round"/></svg>');
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
const urls = ['', 'archive.html', 'about.html', ...Site.CATEGORIES.map((c) => `category/${c.id}.html`), ...articles.map((a) => `articles/${a.slug}.html`)];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => {
  const a = articles.find((x) => u === `articles/${x.slug}.html`);
  return `  <url><loc>${SITE_URL}/${u}</loc>${a ? `<lastmod>${a.date}</lastmod>` : ''}</url>`;
}).join('\n')}\n</urlset>\n`);
const rfc822 = (iso) => new Date(iso + 'T09:00:00Z').toUTCString();
write('rss.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n<title>${Site.SITE.name}</title><link>${SITE_URL}/</link><atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/><lastBuildDate>${rfc822(articles[0].date)}</lastBuildDate><description>${Site.esc(Site.SITE.tagline)}</description><language>ru</language>\n${articles.slice(0, 30).map((a) =>
  `<item><title>${Site.esc(a.title)}</title><link>${SITE_URL}/articles/${a.slug}.html</link><guid>${SITE_URL}/articles/${a.slug}.html</guid><pubDate>${rfc822(a.date)}</pubDate><category>${Site.esc(Site.CAT[a.category].name)}</category><description>${Site.esc(a.excerpt)}</description></item>`).join('\n')}\n</channel></rss>\n`);

// ---------- single-file build (hash routing) ----------
const data = articles.map((a) => ({ title: a.title, slug: a.slug, category: a.category, date: a.date, excerpt: a.excerpt, tags: a.tags, facts: a.facts, body: a.body, words: a.words, minutes: a.minutes, no: a.no }));
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const spa = `<title>Отсечка</title>
<meta name="description" content="${Site.esc(Site.SITE.tagline)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8')}
</style>
<div id="app"></div>
<script>window.OTSECHKA_SPA = true;</script>
<script>
${safe(fs.readFileSync(path.join(ROOT, 'src/site.js'), 'utf8'))}
Site.ART.hero = ${JSON.stringify(Site.ART.hero).replace(/</g, '\\u003c')};
</script>
<script>
${safe(fs.readFileSync(path.join(ROOT, 'src/client.js'), 'utf8'))}
</script>
<script>
(function () {
  var ARTICLES = ${JSON.stringify(data).replace(/</g, '\\u003c')};
  var BY_SLUG = {};
  ARTICLES.forEach(function (a) { BY_SLUG[a.slug] = a; });
  var L = {
    home: '#home', archive: '#archive', about: '#about',
    article: function (s) { return '#a-' + s; },
    category: function (id) { return '#c-' + id; },
    asset: function (p) { return p; },
  };
  var app = document.getElementById('app');
  var ROUTE = /^(home|archive|about|a-[a-z0-9-]+|c-[a-z]+)?$/;
  function render(route) {
    var main, active = '', title = '';
    if (!route || route === 'home') { main = Site.home(L, ARTICLES); active = 'home'; }
    else if (route === 'archive') { main = Site.archivePage(L, ARTICLES); active = 'archive'; title = 'Все статьи'; }
    else if (route === 'about') { main = Site.aboutPage(L, ARTICLES); active = 'about'; title = 'О журнале'; }
    else if (route.indexOf('a-') === 0 && BY_SLUG[route.slice(2)]) { var a = BY_SLUG[route.slice(2)]; main = Site.articlePage(L, a, ARTICLES); active = 'article'; title = a.title; }
    else if (route.indexOf('c-') === 0 && Site.CAT[route.slice(2)]) { var c = Site.CAT[route.slice(2)]; main = Site.categoryPage(L, c, ARTICLES); active = c.id; title = c.name; }
    else { main = Site.notFound(L); title = 'Страница не найдена'; }
    app.innerHTML = Site.header(L, active, ARTICLES) + main + Site.footer(L, ARTICLES);
    document.title = title ? title + ' — Отсечка' : 'Отсечка';
    window.scrollTo(0, 0);
    window.Otsechka.init();
  }
  var current = null;
  function route() {
    var h;
    try { h = decodeURIComponent(location.hash.replace(/^#/, '')); } catch (e) { h = ''; }
    if (!ROUTE.test(h)) {
      // in-page anchors (table of contents, skip link) scroll instead of navigating
      var el = document.getElementById(h);
      if (el) { el.scrollIntoView(); return; }
      if (/^(sec-\d+|main)$/.test(h) && current === null) { current = ''; render(''); return; }
    }
    if (h === current) return;
    current = h;
    render(h);
  }
  window.addEventListener('hashchange', route);
  route();
})();
</script>
`;
fs.mkdirSync(path.join(ROOT, 'dist-artifact'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist-artifact/index.html'), spa);

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
console.log(`[build] ${articles.length} articles · ${articles.reduce((s, a) => s + a.words, 0)} words`);
console.log(`[build] dist/ ${urls.length + 1} pages · dist-artifact/index.html ${kb(path.join(ROOT, 'dist-artifact/index.html'))}`);
