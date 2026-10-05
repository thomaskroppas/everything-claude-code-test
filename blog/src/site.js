/*
 * «Отсечка» — shared site core.
 * Runs in Node (static build) and in the browser (single-file artifact build),
 * so it has no dependencies and touches neither `fs` nor `document`.
 */
(function (root) {
  'use strict';

  const SITE = {
    name: 'Отсечка',
    tagline: 'Журнал об автомобилях: история, устройство, вождение и культура',
    lang: 'ru',
  };

  const CATEGORIES = [
    { id: 'history', name: 'История', blurb: 'Модели и люди, которые изменили автомобиль.', bg: '#5E4128', ink: '#F2D7AE' },
    { id: 'tech', name: 'Устройство', blurb: 'Как работают узлы и системы, без лишних формул.', bg: '#21405A', ink: '#BFD9EE' },
    { id: 'electric', name: 'Электро', blurb: 'Электромобили, гибриды, батареи и зарядка.', bg: '#1C5548', ink: '#B9EBD9' },
    { id: 'service', name: 'Обслуживание', blurb: 'Масло, шины, тормоза и всё, что продлевает жизнь машине.', bg: '#434950', ink: '#D9DEE3' },
    { id: 'driving', name: 'Вождение', blurb: 'Навыки и привычки, которые делают поездки безопаснее.', bg: '#3A4626', ink: '#DCE8B8' },
    { id: 'buying', name: 'Покупка', blurb: 'Выбор, проверка, деньги и продажа автомобиля.', bg: '#542B41', ink: '#F0C9DC' },
    { id: 'motorsport', name: 'Автоспорт', blurb: 'Гонки, трассы и люди, которые ездят на пределе.', bg: '#6E1D18', ink: '#FFD0C4' },
    { id: 'culture', name: 'Культура', blurb: 'Дизайн, кино, коллекции и великие дороги.', bg: '#34306A', ink: '#D4D0FF' },
  ];
  const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // ---------- small utils ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let s = seed || 1;
    return () => { s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917); s ^= s >>> 16; return (s >>> 0) / 4294967296; };
  }
  function fmtDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  function pad3(n) { return String(n).padStart(3, '0'); }
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // ---------- frontmatter + markdown ----------
  function parseArticle(src) {
    const m = src.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) throw new Error('missing frontmatter');
    const meta = { facts: [], tags: [] };
    let inFacts = false;
    for (const line of m[1].split('\n')) {
      if (inFacts && /^\s*-\s+/.test(line)) {
        const [label, ...rest] = line.replace(/^\s*-\s+/, '').split('|');
        if (rest.length) meta.facts.push({ label: label.trim().replace(/^(["'])(.*)\1$/, '$2'), value: rest.join('|').trim().replace(/^(["'])(.*)\1$/, '$2') });
        continue;
      }
      const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
      if (!kv) continue;
      inFacts = kv[1] === 'facts';
      if (inFacts) continue;
      const v = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
      if (kv[1] === 'tags') {
        meta.tags = v.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean);
      } else meta[kv[1]] = v;
    }
    const body = m[2].trim();
    const words = (body.replace(/[#>*|\-]/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
    return Object.assign(meta, { body, words, minutes: Math.max(1, Math.round(words / 180)) });
  }

  function inline(s) {
    const codes = [];
    return esc(s)
      .replace(/`([^`]+)`/g, (_, c) => '\u0000' + (codes.push(c) - 1) + '\u0000')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[i] + '</code>');
  }

  // Markdown subset: ##/### headings, paragraphs, - and 1. lists, > callouts, pipe tables.
  function renderMarkdown(md) {
    const lines = md.split('\n');
    const out = [];
    const toc = [];
    let i = 0;
    const isBlockStart = (l) => /^(#{1,4}\s|[-*]\s|\d+[.)]\s|>|\|)/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let h;
      if ((h = line.match(/^(#{1,4})\s+(.*)$/))) {
        const level = Math.max(2, Math.min(h[1].length, 3));
        const text = h[2].trim();
        if (level === 2) {
          const id = 'sec-' + (toc.length + 1);
          toc.push({ id, text });
          out.push(`<h2 id="${id}">${inline(text)}</h2>`);
        } else out.push(`<h3>${inline(text)}</h3>`);
        i++;
      } else if (/^>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        const text = buf.join(' ').trim();
        const lab = text.match(/^\*\*([^*]+?):?\*\*:?\s*/);
        if (lab) {
          const kind = /важно/i.test(lab[1]) ? 'warn' : /факт/i.test(lab[1]) ? 'fact' : 'tip';
          out.push(`<aside class="callout callout--${kind}"><p class="callout__label">${esc(lab[1].replace(/:$/, ''))}</p><p>${inline(text.slice(lab[0].length))}</p></aside>`);
        } else out.push(`<blockquote><p>${inline(text)}</p></blockquote>`);
      } else if (/^\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const body = rows.filter((r, k) => !(k === 1 && /^\|?[\s:|-]+\|?$/.test(r)));
        const head = cells(body[0]);
        const trs = body.slice(1).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('');
        out.push(`<div class="table-wrap" tabindex="0" role="region" aria-label="${esc('Таблица: ' + head.join(', ').replace(/\*/g, ''))}"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${trs}</tbody></table></div>`);
      } else if (/^[-*]\s/.test(line) || /^\d+[.)]\s/.test(line)) {
        const ordered = /^\d/.test(line);
        const re = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
        const items = [];
        while (i < lines.length && (re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
          else items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { buf.push(lines[i].trim()); i++; }
        if (!buf.length) { buf.push(line.trim()); i++; }
        out.push(`<p>${inline(buf.join(' '))}</p>`);
      }
    }
    return { html: out.join('\n'), toc };
  }

  // ---------- generative covers ----------
  // Every cover is drawn from the article slug: same input, same picture.
  function cover(a) {
    const c = CAT[a.category] || CATEGORIES[0];
    const W = 1200, H = 750;
    const r = rng(hash(a.slug));
    const ink = c.ink, bg = c.bg, hi = '#FFC21A';
    const sw = (n) => `stroke-width="${n}"`;
    let g = '';
    switch (a.category) {
      case 'history': { // sunburst + enamel badge rings
        const cx = 300 + r() * 600, cy = 300 + r() * 250, n = 36;
        for (let k = 0; k < n; k++) {
          const t = (k / n) * Math.PI * 2, x = cx + Math.cos(t) * 1600, y = cy + Math.sin(t) * 1600;
          g += `<line x1="${cx | 0}" y1="${cy | 0}" x2="${x | 0}" y2="${y | 0}" stroke="${ink}" opacity="${k % 2 ? 0.08 : 0.18}" ${sw(k % 2 ? 6 : 14)}/>`;
        }
        for (let k = 0; k < 4; k++) g += `<circle cx="${cx | 0}" cy="${cy | 0}" r="${110 + k * 46}" fill="none" stroke="${k === 1 ? hi : ink}" ${sw(k === 1 ? 10 : 3)} opacity="${k === 1 ? 0.9 : 0.55}"/>`;
        g += `<circle cx="${cx | 0}" cy="${cy | 0}" r="72" fill="${ink}" opacity="0.9"/>`;
        break;
      }
      case 'tech': { // meshing gears
        let x = 120 + r() * 200, y = 200 + r() * 300;
        for (let k = 0; k < 5; k++) {
          const R = 70 + r() * 150, teeth = 10 + ((r() * 14) | 0);
          let d = '';
          for (let t = 0; t <= teeth * 2; t++) {
            const ang = (t / (teeth * 2)) * Math.PI * 2, rr = t % 2 ? R : R * 0.86;
            d += (t ? 'L' : 'M') + (x + Math.cos(ang) * rr).toFixed(1) + ' ' + (y + Math.sin(ang) * rr).toFixed(1);
          }
          g += `<path d="${d}Z" fill="none" stroke="${k === 2 ? hi : ink}" ${sw(k === 2 ? 8 : 4)} opacity="${k === 2 ? 0.95 : 0.6}"/>`;
          g += `<circle cx="${x | 0}" cy="${y | 0}" r="${(R * 0.25) | 0}" fill="none" stroke="${ink}" ${sw(3)} opacity="0.5"/>`;
          x += R * 1.5 + 40; y = Math.max(120, Math.min(H - 120, y + (r() - 0.5) * 260));
          if (x > W + 100) break;
        }
        break;
      }
      case 'electric': { // battery cells with charge level + bolt
        const cols = 8, rows = 4, cw = 118, ch = 120, ox = 70, oy = 110;
        const level = 0.25 + r() * 0.7;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const filled = (x + 1) / cols <= level;
          g += `<rect x="${ox + x * (cw + 14)}" y="${oy + y * (ch + 14)}" width="${cw}" height="${ch}" rx="10" fill="${filled ? ink : 'none'}" opacity="${filled ? (0.22 + 0.06 * y).toFixed(2) : 0.5}" stroke="${ink}" ${sw(3)}/>`;
        }
        const bx = (520 + r() * 160) | 0;
        g += `<path d="M${bx} 60 L${bx - 150} 420 L${bx - 20} 420 L${bx - 90} 700 L${bx + 170} 300 L${bx + 30} 300 L${bx + 110} 60 Z" fill="${hi}" opacity="0.95"/>`;
        break;
      }
      case 'service': { // hex nuts
        const s = 74 + r() * 30;
        for (let y = 0, row = 0; y < H + s; y += s * 1.6, row++) for (let x = row % 2 ? s : 0; x < W + s; x += s * 2) {
          let d = '';
          for (let k = 0; k < 6; k++) { const t = Math.PI / 6 + (k * Math.PI) / 3; d += (k ? 'L' : 'M') + (x + Math.cos(t) * s * 0.8).toFixed(0) + ' ' + (y + Math.sin(t) * s * 0.8).toFixed(0); }
          const lit = r() < 0.08;
          g += `<path d="${d}Z" fill="none" stroke="${lit ? hi : ink}" ${sw(lit ? 8 : 3)} opacity="${lit ? 1 : 0.45}"/><circle cx="${x | 0}" cy="${y | 0}" r="${(s * 0.32) | 0}" fill="none" stroke="${ink}" ${sw(3)} opacity="0.35"/>`;
        }
        break;
      }
      case 'driving': { // perspective road with dashed centre line
        const vx = (400 + r() * 400) | 0, vy = (210 + r() * 80) | 0;
        g += `<path d="M${vx - 6} ${vy} L${vx + 6} ${vy} L${W + 220} ${H} L${-220} ${H} Z" fill="${ink}" opacity="0.14"/>`;
        g += `<line x1="${vx - 6}" y1="${vy}" x2="${-220}" y2="${H}" stroke="${ink}" ${sw(8)} opacity="0.8"/><line x1="${vx + 6}" y1="${vy}" x2="${W + 220}" y2="${H}" stroke="${ink}" ${sw(8)} opacity="0.8"/>`;
        for (let k = 0; k < 9; k++) {
          const t0 = Math.pow(k / 9, 2), t1 = Math.pow((k + 0.5) / 9, 2);
          const y0 = (vy + (H - vy) * t0).toFixed(0), y1 = (vy + (H - vy) * t1).toFixed(0);
          const w0 = (2 + 26 * t0).toFixed(1), w1 = (2 + 26 * t1).toFixed(1);
          g += `<path d="M${vx - w0} ${y0} L${vx + +w0} ${y0} L${vx + +w1} ${y1} L${vx - w1} ${y1} Z" fill="${hi}"/>`;
        }
        for (let k = 0; k < 5; k++) g += `<line x1="0" y1="${vy - 30 - k * 26}" x2="${W}" y2="${vy - 30 - k * 26}" stroke="${ink}" ${sw(2)} opacity="${(0.25 - k * 0.04).toFixed(2)}"/>`;
        break;
      }
      case 'buying': { // number plates + price stripes
        for (let k = -6; k < 14; k++) g += `<line x1="${k * 120}" y1="${H}" x2="${k * 120 + 700}" y2="0" stroke="${ink}" ${sw(26)} opacity="0.07"/>`;
        for (let k = 0; k < 3; k++) {
          const x = (140 + k * 70 + r() * 40) | 0, y = 140 + k * 150;
          g += `<rect x="${x}" y="${y}" width="760" height="170" rx="18" fill="${k === 2 ? ink : 'none'}" opacity="${k === 2 ? 0.92 : 0.6}" stroke="${ink}" ${sw(6)}/>`;
          if (k === 2) {
            g += `<rect x="${x + 640}" y="${y + 20}" width="3" height="130" fill="${bg}"/>`;
            for (let j = 0; j < 6; j++) g += `<rect x="${x + 50 + j * 92}" y="${y + 45}" width="64" height="80" rx="8" fill="${bg}" opacity="${(0.85 - (j % 2) * 0.25).toFixed(2)}"/>`;
            g += `<circle cx="${x + 700}" cy="${y + 85}" r="26" fill="${hi}"/>`;
          }
        }
        break;
      }
      case 'motorsport': { // waving chequered flag + speed lines
        const size = 70, skew = -0.35 + r() * 0.2;
        let d = '';
        for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) if ((x + y) % 2 === 0) {
          const px = 520 + x * size + y * size * skew, py = 120 + y * size + Math.sin(x * 0.7) * 22;
          d += `M${px.toFixed(0)} ${py.toFixed(0)}h${size}v${size}h-${size}Z`;
        }
        g += `<path d="${d}" fill="${ink}" opacity="0.85"/>`;
        for (let k = 0; k < 9; k++) { const y = (120 + k * 60 + r() * 20) | 0; g += `<line x1="${(40 + r() * 80) | 0}" y1="${y}" x2="${(420 + r() * 140) | 0}" y2="${y}" stroke="${k === 4 ? hi : ink}" ${sw(k === 4 ? 12 : 5)} stroke-linecap="round" opacity="${k === 4 ? 1 : 0.5}"/>`; }
        break;
      }
      default: { // culture: French-curve sweeps
        for (let k = 0; k < 7; k++) {
          const y = 120 + k * 85 + r() * 40;
          g += `<path d="M-50 ${y | 0} C ${(300 + r() * 200) | 0} ${(y - 260 + r() * 140) | 0}, ${(700 + r() * 200) | 0} ${(y + 260 - r() * 140) | 0}, ${W + 50} ${(y - 40) | 0}" fill="none" stroke="${k === 3 ? hi : ink}" ${sw(k === 3 ? 12 : 4)} opacity="${k === 3 ? 1 : 0.55}"/>`;
        }
        g += `<circle cx="${(820 + r() * 200) | 0}" cy="${(180 + r() * 100) | 0}" r="${(70 + r() * 40) | 0}" fill="${ink}" opacity="0.85"/>`;
      }
    }
    const no = a.no ? `<text x="${W - 48}" y="${H - 44}" text-anchor="end" font-family="'JetBrains Mono',ui-monospace,monospace" font-size="40" font-weight="600" fill="${ink}">№ ${pad3(a.no)}</text>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc('Обложка статьи, рубрика «' + c.name + '»')}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${bg}"/>${g}${no}</svg>`;
  }

  // ---------- templates ----------
  // `L` resolves links: {home, archive, about, article(slug), category(id), themeToggle}
  function revbar(progress) {
    let s = '';
    for (let k = 0; k < 24; k++) s += `<i class="${k >= 20 ? 'red' : k >= 16 ? 'amber' : ''}"></i>`;
    return `<div class="revbar${progress ? ' revbar--progress' : ''}" aria-hidden="true">${s}</div>`;
  }

  function header(L, active) {
    const nav = CATEGORIES.map((c) => `<a href="${L.category(c.id)}"${active === c.id ? ' aria-current="page"' : ''}>${esc(c.name)}</a>`).join('');
    return `<a class="skip" href="#main">Перейти к содержанию</a>
<header class="masthead">
  <div class="masthead__row wrap">
    <a class="wordmark" href="${L.home}" aria-label="${SITE.name}: на главную">ОТСЕЧКА<span class="wordmark__rpm" aria-hidden="true">×1000 об/мин</span></a>
    <div class="masthead__tools">
      <a class="tool" href="${L.archive}"${active === 'archive' ? ' aria-current="page"' : ''}>Все статьи</a>
      <a class="tool" href="${L.about}"${active === 'about' ? ' aria-current="page"' : ''}>О журнале</a>
      ${L.themeToggle ? '<button class="tool tool--theme" type="button" id="theme-toggle">Тема</button>' : ''}
    </div>
  </div>
  <nav class="catnav wrap" aria-label="Рубрики">${nav}</nav>
  ${revbar(active === 'article')}
</header>`;
  }

  function footer(L, articles) {
    const counts = CATEGORIES.map((c) => `<li><a href="${L.category(c.id)}">${esc(c.name)}</a> <span class="mono">${articles.filter((a) => a.category === c.id).length}</span></li>`).join('');
    const words = articles.reduce((s, a) => s + a.words, 0);
    return `<footer class="footer">
  <div class="wrap footer__grid">
    <div>
      <p class="wordmark wordmark--small">ОТСЕЧКА</p>
      <p class="footer__text">${esc(SITE.tagline)}. Пишем о машинах так, чтобы было понятно с первого раза и интересно до последнего абзаца.</p>
    </div>
    <div>
      <p class="label">Рубрики</p>
      <ul class="footer__list">${counts}</ul>
    </div>
    <div>
      <p class="label">Одометр журнала</p>
      <p class="odometer mono" role="img" aria-label="${articles.length} статей">${String(articles.length).padStart(6, '0').split('').map((d) => `<span>${d}</span>`).join('')}</p>
      <p class="footer__text">${articles.length} ${plural(articles.length, 'статья', 'статьи', 'статей')} · ${CATEGORIES.length} рубрик · ≈${Math.round(words / 1000)} тыс. слов</p>
    </div>
  </div>
  <p class="wrap footer__fine">© 2026 «Отсечка». Тексты носят информационный характер: при ремонте и обслуживании сверяйтесь с руководством по эксплуатации своего автомобиля.</p>
</footer>`;
  }

  function chip(L, a) {
    const c = CAT[a.category];
    return `<a class="chip chip--${c.id}" href="${L.category(c.id)}">${esc(c.name)}</a>`;
  }

  // Static build links cover files (L.cover); the single-file build draws them inline.
  function media(L, a, eager) {
    return L.cover ? `<img src="${L.cover(a.slug)}" width="1200" height="750" alt="" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : cover(a);
  }

  function card(L, a, compact, level) {
    const h = level || 3;
    return `<article class="card${compact ? ' card--compact' : ''}">
  <a class="card__media" href="${L.article(a.slug)}" tabindex="-1" aria-hidden="true">${media(L, a)}</a>
  <div class="card__body">
    <p class="meta">${chip(L, a)}<span class="mono">${a.minutes} мин</span></p>
    <h${h} class="card__title"><a href="${L.article(a.slug)}">${esc(a.title)}</a></h${h}>
    ${compact ? '' : `<p class="card__excerpt">${esc(a.excerpt)}</p>`}
  </div>
</article>`;
  }

  function specSheet(a, small) {
    if (!a.facts || !a.facts.length) return '';
    return `<dl class="spec${small ? ' spec--small' : ''}">${a.facts.slice(0, 4).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>`;
  }

  function home(L, articles) {
    const [lead, ...rest] = articles;
    const fresh = rest.slice(0, 6);
    const shown = new Set([lead, ...fresh].map((a) => a.slug));
    const sections = CATEGORIES.map((c) => {
      const list = articles.filter((a) => a.category === c.id);
      const pick = list.filter((a) => !shown.has(a.slug)).slice(0, 4);
      return `<section class="shelf" aria-labelledby="shelf-${c.id}">
  <div class="shelf__head">
    <h2 id="shelf-${c.id}" class="shelf__title"><span class="swatch swatch--${c.id}" aria-hidden="true"></span>${esc(c.name)}</h2>
    <p class="shelf__blurb">${esc(c.blurb)}</p>
    <a class="more" href="${L.category(c.id)}">Все ${list.length} ${plural(list.length, 'статья', 'статьи', 'статей')} →</a>
  </div>
  <div class="grid grid--4">${pick.map((a) => card(L, a, true)).join('')}</div>
</section>`;
    }).join('');
    return `<main id="main" class="wrap">
  <h1 class="visually-hidden">${SITE.name} — журнал об автомобилях</h1>
  <section class="lead" aria-label="Главная статья">
    <a class="lead__media" href="${L.article(lead.slug)}" tabindex="-1" aria-hidden="true">${media(L, lead, true)}</a>
    <div class="lead__body">
      <p class="eyebrow">Свежий выпуск · ${fmtDate(lead.date)}</p>
      <h2 class="lead__title"><a href="${L.article(lead.slug)}">${esc(lead.title)}</a></h2>
      <p class="lead__excerpt">${esc(lead.excerpt)}</p>
      <p class="meta">${chip(L, lead)}<span class="mono">${lead.minutes} мин чтения</span></p>
      ${specSheet(lead, true)}
    </div>
  </section>
  <section aria-labelledby="fresh-title">
    <h2 id="fresh-title" class="section-title">Свежее</h2>
    <div class="grid grid--3">${fresh.map((a) => card(L, a)).join('')}</div>
  </section>
  ${sections}
</main>`;
  }

  function articlePage(L, a, articles) {
    const c = CAT[a.category];
    const r = renderMarkdown(a.body);
    const same = articles.filter((x) => x.category === a.category);
    const idx = same.findIndex((x) => x.slug === a.slug);
    const older = same[idx + 1], newer = same[idx - 1];
    const related = same.filter((x) => x.slug !== a.slug)
      .sort((x, y) => (hash(a.slug + x.slug) % 97) - (hash(a.slug + y.slug) % 97)).slice(0, 3);
    const toc = r.toc.length > 2 ? `<nav class="toc" aria-label="Содержание"><p class="label">Содержание</p><ol>${r.toc.map((t) => `<li><a href="#${t.id}" data-toc="${t.id}">${inline(t.text)}</a></li>`).join('')}</ol></nav>` : '';
    return `<main id="main">
  <article class="post">
    <header class="post__head wrap">
      <p class="meta">${chip(L, a)}<span class="mono">№ ${pad3(a.no)}</span></p>
      <h1 class="post__title">${esc(a.title)}</h1>
      <p class="post__lede">${esc(a.excerpt)}</p>
      <p class="post__byline mono"><time datetime="${a.date}">${fmtDate(a.date)}</time><span>${a.minutes} мин чтения</span><span>${a.words.toLocaleString('ru-RU')} слов</span></p>
    </header>
    <figure class="post__cover wrap" aria-hidden="true">${cover(a)}</figure>
    <div class="post__layout wrap">
      <aside class="post__side">${a.facts.length ? '<p class="label">Паспорт темы</p>' : ''}${specSheet(a)}${toc}</aside>
      <div class="prose">
${r.html}
        <p class="tags">${a.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</p>
      </div>
    </div>
    <nav class="pager wrap" aria-label="Соседние статьи рубрики">
      ${older ? `<a class="pager__link" href="${L.article(older.slug)}"><span class="label">← Раньше в рубрике</span><span class="pager__title">${esc(older.title)}</span></a>` : '<span></span>'}
      ${newer ? `<a class="pager__link pager__link--next" href="${L.article(newer.slug)}"><span class="label">Новее в рубрике →</span><span class="pager__title">${esc(newer.title)}</span></a>` : '<span></span>'}
    </nav>
  </article>
  <section class="wrap related" aria-labelledby="related-title">
    <h2 id="related-title" class="section-title">Ещё из рубрики «${esc(c.name)}»</h2>
    <div class="grid grid--3">${related.map((x) => card(L, x)).join('')}</div>
  </section>
</main>`;
  }

  function categoryPage(L, c, articles) {
    const list = articles.filter((a) => a.category === c.id);
    return `<main id="main" class="wrap">
  <header class="pagehead">
    <p class="eyebrow"><span class="swatch swatch--${c.id}" aria-hidden="true"></span>Рубрика · ${list.length} ${plural(list.length, 'статья', 'статьи', 'статей')}</p>
    <h1 class="pagehead__title">${esc(c.name)}</h1>
    <p class="pagehead__blurb">${esc(c.blurb)}</p>
  </header>
  <div class="grid grid--3">${list.map((a) => card(L, a, false, 2)).join('')}</div>
</main>`;
  }

  function archivePage(L, articles) {
    const rows = articles.map((a) => `<li class="row" data-cat="${a.category}" data-q="${esc((a.title + ' ' + a.excerpt + ' ' + a.tags.join(' ')).toLowerCase())}">
  <span class="row__no mono">№ ${pad3(a.no)}</span>
  <a class="row__title" href="${L.article(a.slug)}">${esc(a.title)}</a>
  <span class="row__cat">${chip(L, a)}</span>
  <time class="row__date mono" datetime="${a.date}">${a.date.split('-').reverse().join('.')}</time>
</li>`).join('');
    const filters = ['<button type="button" class="filter" data-filter="" aria-pressed="true">Все</button>']
      .concat(CATEGORIES.map((c) => `<button type="button" class="filter" data-filter="${c.id}" aria-pressed="false">${esc(c.name)}</button>`)).join('');
    return `<main id="main" class="wrap">
  <header class="pagehead">
    <p class="eyebrow">Архив</p>
    <h1 class="pagehead__title">Все ${articles.length} статей</h1>
    <p class="pagehead__blurb">Ищите по названию, описанию или тегу. Номер у каждой статьи постоянный, по нему её легко найти снова.</p>
  </header>
  <div class="finder" role="search">
    <label class="label" for="q">Поиск по журналу</label>
    <input id="q" class="finder__input" type="search" placeholder="Например: турбина, зима, Нива" autocomplete="off">
    <div class="filters" role="group" aria-label="Фильтр по рубрике">${filters}</div>
    <p class="finder__count mono" id="count" aria-live="polite">Найдено: ${articles.length}</p>
  </div>
  <ol class="rows" id="rows">${rows}</ol>
  <p class="empty" id="empty" hidden>Ничего не нашлось. Попробуйте другое слово или выберите «Все».</p>
</main>`;
  }

  function aboutPage(L, articles) {
    const total = articles.reduce((s, a) => s + a.words, 0);
    return `<main id="main" class="wrap narrow">
  <header class="pagehead">
    <p class="eyebrow">О журнале</p>
    <h1 class="pagehead__title">Почему «Отсечка»</h1>
  </header>
  <div class="prose">
    <p>Отсечка — момент, когда электроника ограничивает обороты, чтобы двигатель не вышел за безопасный предел. Стрелка тахометра упирается в красную зону, и мотор отдаёт всё, что может, но не больше. Нам нравится эта идея: говорить о машинах увлечённо, но по делу.</p>
    <p>Здесь собраны ${articles.length} статей в восьми рубриках: от первого автомобиля Карла Бенца до электромобилей, от замены масла до «Дакара». Тексты рассчитаны на тех, кто любит машины, но не обязан быть инженером: каждое понятие объясняется, каждый совет можно применить.</p>
    <h2>Как читать журнал</h2>
    <ul>
      <li>На странице статьи полоса тахометра под шапкой показывает, сколько прочитано. Дошла до красной зоны — текст закончился.</li>
      <li>«Паспорт темы» рядом с текстом собирает главные цифры, чтобы их можно было найти за секунду.</li>
      <li>У каждой статьи постоянный номер, а в архиве работает поиск по названиям, описаниям и тегам.</li>
    </ul>
    <h2>Журнал в цифрах</h2>
    ${specSheet({ facts: [
      { label: 'Статей', value: String(articles.length) },
      { label: 'Рубрик', value: String(CATEGORIES.length) },
      { label: 'Слов всего', value: '≈' + Math.round(total / 1000) + ' тыс.' },
      { label: 'Время чтения', value: '≈' + Math.round(articles.reduce((s, a) => s + a.minutes, 0) / 60) + ' ч' },
    ] })}
    <aside class="callout callout--warn"><p class="callout__label">Важно</p><p>Статьи об обслуживании и ремонте дают общее понимание. Конкретные интервалы, допуски и моменты затяжки всегда сверяйте с руководством по эксплуатации своей машины.</p></aside>
  </div>
</main>`;
  }

  function notFound(L) {
    return `<main id="main" class="wrap narrow">
  <header class="pagehead"><p class="eyebrow mono">Ошибка 404</p><h1 class="pagehead__title">Здесь дорога заканчивается</h1>
  <p class="pagehead__blurb">Такой страницы нет. Вернитесь на <a href="${L.home}">главную</a> или откройте <a href="${L.archive}">архив всех статей</a>.</p></header>
</main>`;
  }

  // Newest first; numbers follow publication order and never change.
  function prepare(list) {
    const byDate = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.slug < b.slug ? -1 : 1));
    byDate.forEach((a, i) => { a.no = i + 1; });
    return byDate.reverse();
  }

  const api = { SITE, CATEGORIES, CAT, esc, fmtDate, parseArticle, renderMarkdown, cover, header, footer, home, articlePage, categoryPage, archivePage, aboutPage, notFound, prepare, plural };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Site = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
