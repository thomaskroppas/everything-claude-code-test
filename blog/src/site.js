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
          out.push(`<aside class="callout callout--${kind}"><p class="callout__label">${esc(lab[1].replace(/:$/, ''))}</p><p>${inline(((t) => t.charAt(0).toUpperCase() + t.slice(1))(text.slice(lab[0].length)))}</p></aside>`);
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
        out.push(`<${tag}>${items.map((t) => `<li><span>${inline(t)}</span></li>`).join('')}</${tag}>`);
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { buf.push(lines[i].trim()); i++; }
        if (!buf.length) { buf.push(line.trim()); i++; }
        out.push(`<p>${inline(buf.join(' '))}</p>`);
      }
    }
    return { html: out.join('\n'), toc };
  }

  // ---------- imagery ----------
  // Lighting tone per rubric, as in the design handoff (Shot component).
  const TONE = { history: 'warm', tech: 'warm', electric: 'cold', service: 'warm', driving: 'dusk', buying: 'warm', motorsport: 'red', culture: 'warm' };
  // The issue's lead story; its frame uses the detailed studio illustration.
  const FEATURED = 'porsche-911-evolution';
  const FEATURE_CATEGORY = { id: 'motorsport', lead: 'le-mans-24' };
  // Set by the build: detailed hero illustration (SVG markup).
  const ART = { hero: '' };

  // Fine line-art motif per rubric, drawn from the slug so every article differs.
  function motif(a) {
    const W = 1200, H = 750;
    const r = rng(hash(a.slug));
    const ink = '#ECEBE6', hi = '#C8B48A';
    const sw = (n) => `stroke-width="${n}"`;
    let g = '';
    switch (a.category) {
      case 'history': {
        const cx = 300 + r() * 600, cy = 260 + r() * 220;
        for (let k = 0; k < 36; k++) {
          const t = (k / 36) * Math.PI * 2;
          g += `<line x1="${cx | 0}" y1="${cy | 0}" x2="${(cx + Math.cos(t) * 1600) | 0}" y2="${(cy + Math.sin(t) * 1600) | 0}" stroke="${ink}" opacity="${k % 2 ? 0.05 : 0.1}" ${sw(k % 2 ? 2 : 4)}/>`;
        }
        for (let k = 0; k < 4; k++) g += `<circle cx="${cx | 0}" cy="${cy | 0}" r="${110 + k * 46}" fill="none" stroke="${k === 1 ? hi : ink}" ${sw(k === 1 ? 3 : 1.5)} opacity="${k === 1 ? 0.8 : 0.35}"/>`;
        break;
      }
      case 'tech': {
        let x = 120 + r() * 200, y = 200 + r() * 300;
        for (let k = 0; k < 5; k++) {
          const R = 70 + r() * 150, teeth = 10 + ((r() * 14) | 0);
          let d = '';
          for (let t = 0; t <= teeth * 2; t++) {
            const ang = (t / (teeth * 2)) * Math.PI * 2, rr = t % 2 ? R : R * 0.86;
            d += (t ? 'L' : 'M') + (x + Math.cos(ang) * rr).toFixed(1) + ' ' + (y + Math.sin(ang) * rr).toFixed(1);
          }
          g += `<path d="${d}Z" fill="none" stroke="${k === 2 ? hi : ink}" ${sw(k === 2 ? 3 : 1.5)} opacity="${k === 2 ? 0.8 : 0.35}"/>`;
          g += `<circle cx="${x | 0}" cy="${y | 0}" r="${(R * 0.25) | 0}" fill="none" stroke="${ink}" ${sw(1.5)} opacity="0.3"/>`;
          x += R * 1.5 + 40; y = Math.max(120, Math.min(H - 120, y + (r() - 0.5) * 260));
          if (x > W + 100) break;
        }
        break;
      }
      case 'electric': {
        const cols = 8, rows = 4, cw = 118, ch = 120, ox = 70, oy = 110, level = 0.25 + r() * 0.7;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const on = (x + 1) / cols <= level;
          g += `<rect x="${ox + x * (cw + 14)}" y="${oy + y * (ch + 14)}" width="${cw}" height="${ch}" rx="6" fill="${on ? '#9fc6de' : 'none'}" fill-opacity="${on ? 0.07 : 0}" stroke="${on ? '#bfe0f0' : ink}" ${sw(1.5)} opacity="${on ? 0.6 : 0.25}"/>`;
        }
        break;
      }
      case 'service': {
        const s = 74 + r() * 30;
        for (let y = 0, row = 0; y < H + s; y += s * 1.6, row++) for (let x = row % 2 ? s : 0; x < W + s; x += s * 2) {
          let d = '';
          for (let k = 0; k < 6; k++) { const t = Math.PI / 6 + (k * Math.PI) / 3; d += (k ? 'L' : 'M') + (x + Math.cos(t) * s * 0.8).toFixed(0) + ' ' + (y + Math.sin(t) * s * 0.8).toFixed(0); }
          const lit = r() < 0.08;
          g += `<path d="${d}Z" fill="none" stroke="${lit ? hi : ink}" ${sw(lit ? 3 : 1.2)} opacity="${lit ? 0.8 : 0.22}"/>`;
        }
        break;
      }
      case 'driving': {
        const vx = (400 + r() * 400) | 0, vy = (300 + r() * 80) | 0;
        g += `<line x1="${vx - 6}" y1="${vy}" x2="-220" y2="${H}" stroke="${ink}" ${sw(2)} opacity="0.45"/><line x1="${vx + 6}" y1="${vy}" x2="${W + 220}" y2="${H}" stroke="${ink}" ${sw(2)} opacity="0.45"/>`;
        for (let k = 0; k < 9; k++) {
          const t0 = Math.pow(k / 9, 2), t1 = Math.pow((k + 0.5) / 9, 2);
          const y0 = (vy + (H - vy) * t0).toFixed(0), y1 = (vy + (H - vy) * t1).toFixed(0);
          const w0 = (1 + 10 * t0).toFixed(1), w1 = (1 + 10 * t1).toFixed(1);
          g += `<path d="M${vx - w0} ${y0} L${vx + +w0} ${y0} L${vx + +w1} ${y1} L${vx - w1} ${y1} Z" fill="${hi}" opacity="0.7"/>`;
        }
        break;
      }
      case 'buying': {
        for (let k = 0; k < 3; k++) {
          const x = (180 + k * 70 + r() * 40) | 0, y = 170 + k * 140;
          g += `<rect x="${x}" y="${y}" width="720" height="150" rx="10" fill="none" stroke="${k === 2 ? hi : ink}" ${sw(k === 2 ? 3 : 1.5)} opacity="${k === 2 ? 0.75 : 0.3}"/>`;
        }
        break;
      }
      case 'motorsport': {
        const size = 64, skew = -0.35 + r() * 0.2;
        for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) if ((x + y) % 2 === 0) {
          const px = 560 + x * size + y * size * skew, py = 130 + y * size + Math.sin(x * 0.7) * 20;
          g += `<rect x="${px.toFixed(0)}" y="${py.toFixed(0)}" width="${size}" height="${size}" fill="none" stroke="${ink}" ${sw(1.2)} opacity="0.3"/>`;
        }
        for (let k = 0; k < 7; k++) { const y = (160 + k * 64 + r() * 20) | 0; g += `<line x1="${(40 + r() * 80) | 0}" y1="${y}" x2="${(420 + r() * 140) | 0}" y2="${y}" stroke="${k === 3 ? '#d63a20' : ink}" ${sw(k === 3 ? 3 : 1.5)} stroke-linecap="round" opacity="${k === 3 ? 0.8 : 0.3}"/>`; }
        break;
      }
      default: {
        for (let k = 0; k < 7; k++) {
          const y = 120 + k * 85 + r() * 40;
          g += `<path d="M-50 ${y | 0} C ${(300 + r() * 200) | 0} ${(y - 260 + r() * 140) | 0}, ${(700 + r() * 200) | 0} ${(y + 260 - r() * 140) | 0}, ${W + 50} ${(y - 40) | 0}" fill="none" stroke="${k === 3 ? hi : ink}" ${sw(k === 3 ? 3 : 1.2)} opacity="${k === 3 ? 0.8 : 0.3}"/>`;
        }
      }
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
  }
  // Kept for the build (cover files, JSON-LD): a standalone, dark cover image.
  function cover(a) {
    return motif(a).replace('<svg ', '<svg width="1200" height="750" ').replace('>', '><rect width="1200" height="750" fill="#0C0B0D"/>');
  }

  // The image frame from the handoff: tone glow, horizon line, art (or a photo), film grain.
  function shot(L, a, o) {
    const opt = o || {};
    const tone = opt.tone || TONE[a.category] || 'warm';
    let art;
    if (a.image && L && L.asset) art = `<img class="shot__photo" src="${esc(L.asset(a.image))}" alt="${esc(a.imageAlt || '')}" loading="${opt.eager ? 'eager' : 'lazy'}" decoding="async">`;
    else if (opt.art) art = `<div class="shot__art">${opt.art}</div>`;
    else art = `<div class="shot__art">${a.slug === FEATURED && ART.hero ? ART.hero : motif(a)}</div>`;
    return `<div class="shot shot--${tone}"${a.image ? '' : ' aria-hidden="true"'}><div class="shot__glow"></div><div class="shot__horizon"></div>${art}<div class="shot__grain"></div></div>`;
  }

  // Tachometer from the handoff: 0–8 ×1000 rpm, red zone 7–8, needle animated by client.js.
  function tacho(value) {
    const v0 = value == null ? 7.35 : value;
    const ang = (v) => 135 + v * 33.75;
    const p = (rad, v) => { const t = (ang(v) * Math.PI) / 180; return [(200 + rad * Math.cos(t)).toFixed(2), (200 + rad * Math.sin(t)).toFixed(2)]; };
    let s = '<defs><radialGradient id="tfFace" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="#1A191C"/><stop offset="1" stop-color="#09090A"/></radialGradient><radialGradient id="tfHub" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#3A3833"/><stop offset="1" stop-color="#121114"/></radialGradient></defs>';
    s += '<circle cx="200" cy="200" r="196" fill="#0E0E10" stroke="#2E2E33" stroke-width="1"/><circle cx="200" cy="200" r="188" fill="url(#tfFace)" stroke="#1C1C20" stroke-width="2"/>';
    s += '<path d="M 70 110 A 160 160 0 0 1 330 110" fill="none" stroke="rgba(200,180,138,.16)" stroke-width="1.5"/>';
    const r7 = p(176, 7), r8 = p(176, 8);
    s += `<path d="M ${r7.join(' ')} A 176 176 0 0 1 ${r8.join(' ')}" fill="none" stroke="#D63A20" stroke-width="7"/>`;
    for (let i = 0; i <= 32; i++) {
      const v = i / 4, major = i % 4 === 0, half = i % 2 === 0;
      const q = p(major ? 146 : half ? 156 : 161, v), o = p(168, v);
      s += `<line x1="${q[0]}" y1="${q[1]}" x2="${o[0]}" y2="${o[1]}" stroke="${v >= 7 ? '#D63A20' : major ? '#ECEBE6' : half ? '#B4B1A9' : '#8D8A84'}" stroke-width="${major ? 3 : half ? 1.6 : 1}"/>`;
    }
    for (let n = 0; n <= 8; n++) {
      const c = p(122, n);
      s += `<text x="${c[0]}" y="${(+c[1] + 12).toFixed(2)}" text-anchor="middle" font-family="'Cormorant Garamond', serif" font-weight="500" font-size="36" fill="${n >= 7 ? '#D63A20' : '#ECEBE6'}">${n}</text>`;
    }
    s += '<text x="200" y="288" text-anchor="middle" font-family="Manrope, sans-serif" font-weight="600" font-size="11" letter-spacing="3.4" fill="#8D8A84">×1000 ОБ/МИН</text>';
    s += '<text x="200" y="138" text-anchor="middle" font-family="Manrope, sans-serif" font-weight="600" font-size="10" letter-spacing="5" fill="#C8B48A">ОТСЕЧКА</text>';
    s += `<g class="tacho__needle" transform="rotate(${ang(v0).toFixed(2)} 200 200)"><polygon points="172,196.5 352,199.2 352,200.8 172,203.5" fill="#ECEBE6"/></g>`;
    s += '<circle cx="200" cy="200" r="16" fill="url(#tfHub)" stroke="#2E2E33"/><circle cx="200" cy="200" r="4" fill="#C8B48A"/>';
    return `<div class="tacho" data-tacho="${v0}"><svg viewBox="0 0 400 400" role="img" aria-label="Тахометр: стрелка у красной зоны, ×1000 об/мин">${s}</svg></div>`;
  }

  // ---------- templates ----------
  // `L` resolves links: {home, archive, about, article(slug), category(id), asset(path)}
  const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  function issue(articles) {
    const [y, m] = articles[0].date.split('-').map(Number);
    return `Выпуск № ${articles.length} · ${MONTHS_NOM[m - 1]} ${y}`;
  }
  const HEADER_NAV = ['history', 'tech', 'electric', 'motorsport'];
  const ICON_SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';
  const ICON_MENU = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>';

  function header(L, active, articles) {
    const cur = (on) => (on ? ' aria-current="page"' : '');
    const nav = HEADER_NAV.map((id) => `<a href="${L.category(id)}"${cur(active === id)}>${esc(CAT[id].name)}</a>`).join('');
    const menu = CATEGORIES.map((c) => `<a href="${L.category(c.id)}"${cur(active === c.id)}>${esc(c.name)}</a>`).join('');
    return `<a class="skip" href="#main">Перейти к содержанию</a>
${active === 'article' ? '<div class="read-progress" aria-hidden="true"><i></i></div>' : ''}
<div class="issue-bar"><div class="wrap">Журнал об автомобилях · ${esc(issue(articles))}</div></div>
<header class="site-header">
  <div class="wrap">
    <nav class="nav" aria-label="Рубрики">${nav}</nav>
    <a class="wordmark" href="${L.home}" aria-label="${SITE.name} — на главную">ОТСЕЧКА</a>
    <div class="header-tools">
      <nav class="nav nav--right" aria-label="Журнал">
        <a class="icon-btn" href="${L.archive}" aria-label="Поиск по журналу">${ICON_SEARCH}</a>
        <a href="${L.about}"${cur(active === 'about')}>О журнале</a>
        <a href="${L.archive}"${cur(active === 'archive')}>Архив</a>
      </nav>
      <button class="icon-btn menu-btn" type="button" aria-expanded="false" aria-controls="site-menu" aria-label="Открыть меню">${ICON_MENU}</button>
    </div>
  </div>
</header>
<nav class="menu" id="site-menu" aria-label="Меню" hidden><div class="wrap">${menu}<a class="menu__small" href="${L.archive}">Архив · все ${articles.length} статей</a><a class="menu__small" href="${L.about}">О журнале</a></div></nav>`;
  }

  function footer(L, articles) {
    const cats = CATEGORIES.map((c) => `<a href="${L.category(c.id)}">${esc(c.name)}</a>`).join('');
    return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer__grid">
      <div class="footer__brand">
        <a class="wordmark" href="${L.home}">ОТСЕЧКА</a>
        <p class="footer__motto">Всё, что может мотор. Но не больше.</p>
      </div>
      <div class="footer__col">
        <p class="eyebrow">Рубрики</p>
        <div class="footer__links footer__links--2">${cats}</div>
      </div>
      <div class="footer__col">
        <p class="eyebrow">Журнал</p>
        <div class="footer__links">
          <a href="${L.archive}">Архив · все ${articles.length} статей</a>
          <a href="${L.about}">О журнале</a>
          ${L.rss ? `<a href="${L.rss}">RSS</a>` : ''}
        </div>
      </div>
    </div>
    <div class="footer__legal">
      <span>© 2026 «${SITE.name}». Журнал об автомобилях</span>
      <span>${esc(issue(articles))}</span>
    </div>
  </div>
</footer>`;
  }

  function metaLine(a, withCat) {
    const rest = ` · № ${pad3(a.no)} · ${a.minutes}&nbsp;мин`;
    return `<p class="meta-line">${withCat === false ? '' : `<span class="cat">${esc(CAT[a.category].name)}</span>`}${withCat === false ? rest.slice(3) : rest}</p>`;
  }

  function card(L, a, opts) {
    const o = opts || {};
    const h = o.level || 3;
    return `<a class="card" href="${L.article(a.slug)}">
  <div class="card__media">${shot(L, a)}</div>
  <div class="card__body">
    ${metaLine(a, o.cat)}
    <h${h} class="card__title">${esc(a.title)}</h${h}>
    ${o.lead === false ? '' : `<p class="card__lead">${esc(a.excerpt)}</p>`}
  </div>
</a>`;
  }

  function specStrip(facts, cls) {
    if (!facts || !facts.length) return '';
    return `<dl class="spec${cls ? ' ' + cls : ''}">${facts.slice(0, 4).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>`;
  }

  function countLabel(n) { return `${n}&nbsp;${plural(n, 'статья', 'статьи', 'статей')}`; }

  function home(L, articles) {
    const lead = articles.find((a) => a.slug === FEATURED) || articles[0];
    const fresh = articles.filter((a) => a !== lead).slice(0, 3);
    const fc = CAT[FEATURE_CATEGORY.id];
    const inCat = articles.filter((a) => a.category === fc.id);
    const big = inCat.find((a) => a.slug === FEATURE_CATEGORY.lead) || inCat[0];
    const list = inCat.filter((a) => a !== big).slice(0, 4);
    const index = CATEGORIES.map((c, i) => `<a class="index__row" href="${L.category(c.id)}">
        <span class="index__no">${String(i + 1).padStart(2, '0')}</span>
        <span class="index__body"><span class="index__name">${esc(c.name)}</span><span class="index__desc">${esc(c.blurb)}</span></span>
        <span class="index__count">${countLabel(articles.filter((a) => a.category === c.id).length)}</span>
      </a>`).join('');
    return `<main id="main">
  <section class="hero" aria-labelledby="hero-title">
    ${shot(L, lead, { eager: true })}
    <div class="hero__scrim"></div>
    <div class="hero__body">
      <p class="eyebrow">Тема выпуска · ${esc(CAT[lead.category].name)} · № ${pad3(lead.no)}</p>
      <h1 class="hero__title" id="hero-title">${esc(lead.title)}</h1>
      <p class="hero__lede">${esc(lead.excerpt)}</p>
      <div class="hero__actions">
        <a class="btn btn--solid" href="${L.article(lead.slug)}">Читать <span aria-hidden="true">→</span></a>
        <span class="hero__note">${lead.minutes} мин · ${fmtDate(lead.date)}</span>
      </div>
    </div>
  </section>
  <div class="wrap">
    ${specStrip(lead.facts)}
    <section class="section" aria-labelledby="fresh-title">
      <div class="section-head">
        <div><p class="eyebrow">${esc(issue(articles).split(' · ')[0])}</p><h2 class="h-section" id="fresh-title">Свежее</h2></div>
        <a class="more" href="${L.archive}">Все ${articles.length} статей →</a>
      </div>
      <div class="grid-3">${fresh.map((a) => card(L, a)).join('')}</div>
    </section>
    <section class="section" aria-labelledby="feature-title">
      <div class="section-head section-head--ruled">
        <div><p class="eyebrow">Рубрика</p><h2 class="h-section" id="feature-title">${esc(fc.name)}</h2></div>
        <a class="more" href="${L.category(fc.id)}">Вся рубрика · ${countLabel(inCat.length)} →</a>
      </div>
      <div class="feature">
        <a class="feature__big" href="${L.article(big.slug)}">
          ${shot(L, big)}
          <div class="feature__scrim"></div>
          <div class="feature__text">
            <p class="meta-line"><span class="cat">${esc(fc.name)}</span><span class="rest"> · № ${pad3(big.no)} · ${big.minutes}&nbsp;мин</span></p>
            <h3 class="feature__title">${esc(big.title)}</h3>
            <p class="feature__lead">${esc(big.excerpt)}</p>
          </div>
        </a>
        <div>${list.map((a) => `<a class="list-row" href="${L.article(a.slug)}"><span class="list-row__no">${pad3(a.no)}</span><span class="list-row__body"><span class="list-row__title">${esc(a.title)}</span><span class="list-row__date">${fmtDate(a.date)} · ${a.minutes} мин</span></span></a>`).join('')}</div>
      </div>
    </section>
  </div>
  <section class="band" aria-labelledby="band-title">
    <div class="wrap">
      <div class="band__tacho">${tacho()}</div>
      <div class="band__text">
        <p class="eyebrow">О названии</p>
        <h2 class="band__title" id="band-title">Всё, что может мотор. Но не больше</h2>
        <p>Отсечка — момент, когда электроника ограничивает обороты, чтобы двигатель не вышел за безопасный предел: стрелка тахометра упирается в красную зону.</p>
        <a class="btn btn--ghost" href="${L.about}">О журнале</a>
      </div>
    </div>
  </section>
  <section class="wrap index" aria-labelledby="index-title">
    <div class="section-head"><div><p class="eyebrow">Индекс</p><h2 class="h-section" id="index-title">Восемь рубрик</h2></div></div>
    <div class="index__grid">${index}</div>
  </section>
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
    const tocItems = r.toc.map((t) => `<li><a href="#${t.id}" data-toc="${t.id}">${inline(t.text)}</a></li>`).join('');
    const hasToc = r.toc.length > 2;
    return `<main id="main">
  <article>
    <header class="wrap post-head">
      <p class="meta-line"><a href="${L.category(c.id)}">${esc(c.name)}</a> · № ${pad3(a.no)}</p>
      <h1 class="post-title">${esc(a.title)}</h1>
      <p class="post-lede">${esc(a.excerpt)}</p>
      <p class="post-byline"><time datetime="${a.date}">${fmtDate(a.date)}</time><span>${a.minutes} мин чтения</span><span>≈ ${(Math.round(a.words / 50) * 50).toLocaleString('ru-RU')} слов</span></p>
    </header>
    <figure class="post-cover">${shot(L, a, { eager: true })}</figure>
    <div class="wrap">${specStrip(a.facts)}</div>
    <div class="wrap post-layout">
      ${hasToc ? `<nav class="toc" aria-label="Содержание"><p class="label">Содержание</p><ol>${tocItems}</ol></nav>` : '<div></div>'}
      <div class="prose">
        ${hasToc ? `<details class="toc-mobile"><summary class="label">Содержание · ${r.toc.length} ${plural(r.toc.length, 'раздел', 'раздела', 'разделов')}</summary><ol>${r.toc.map((t) => `<li><a href="#${t.id}">${inline(t.text)}</a></li>`).join('')}</ol></details>` : ''}
${r.html}
        <p class="tags">${a.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</p>
      </div>
    </div>
    <nav class="wrap pager" aria-label="Соседние статьи рубрики">
      ${older ? `<a href="${L.article(older.slug)}"><span class="label">← Раньше в рубрике</span><span class="pager__title">${esc(older.title)}</span></a>` : '<span></span>'}
      ${newer ? `<a class="pager__next" href="${L.article(newer.slug)}"><span class="label">Новее в рубрике →</span><span class="pager__title">${esc(newer.title)}</span></a>` : '<span></span>'}
    </nav>
  </article>
  <section class="wrap related" aria-labelledby="related-title">
    <div class="section-head"><div><p class="eyebrow">Рубрика</p><h2 class="h-section" id="related-title">Ещё из рубрики «${esc(c.name)}»</h2></div><a class="more" href="${L.category(c.id)}">Вся рубрика →</a></div>
    <div class="grid-3">${related.map((x) => card(L, x)).join('')}</div>
  </section>
</main>`;
  }

  function categoryPage(L, c, articles) {
    const list = articles.filter((a) => a.category === c.id);
    return `<main id="main">
  <section class="banner" aria-labelledby="cat-title">
    ${shot(L, list[0] || { slug: c.id, category: c.id }, { tone: TONE[c.id], eager: true })}
    <div class="banner__scrim"></div>
    <div class="banner__body">
      <div><p class="eyebrow">Рубрика · ${countLabel(list.length)}</p><h1 class="banner__title" id="cat-title">${esc(c.name)}</h1></div>
      <p class="banner__blurb">${esc(c.blurb)}</p>
    </div>
  </section>
  <div class="wrap">
    <div class="toolbar">
      <div class="toolbar__group" role="group" aria-label="Сортировка">
        <button class="chip" type="button" data-sort="new" aria-pressed="true">Сначала новые</button>
        <button class="chip" type="button" data-sort="old" aria-pressed="false">Сначала старые</button>
      </div>
      <span class="toolbar__count">${countLabel(list.length)} в рубрике</span>
    </div>
    <div class="grid-3 grid-3--loose cat-grid" id="cat-grid">${list.map((a) => card(L, a, { level: 2, cat: false })).join('')}</div>
  </div>
</main>`;
  }

  function archivePage(L, articles) {
    const rows = articles.map((a) => `<li class="row" data-cat="${a.category}" data-q="${esc((a.title + ' ' + a.excerpt + ' ' + a.tags.join(' ')).toLowerCase())}"><a href="${L.article(a.slug)}">
  <span class="row__no">№ ${pad3(a.no)}</span>
  <span class="row__title">${esc(a.title)}</span>
  <span class="row__cat">${esc(CAT[a.category].name)}</span>
  <time class="row__date" datetime="${a.date}">${a.date.split('-').reverse().join('.')}</time>
</a></li>`).join('');
    const filters = ['<button type="button" class="chip filter" data-filter="" aria-pressed="true">Все</button>']
      .concat(CATEGORIES.map((c) => `<button type="button" class="chip filter" data-filter="${c.id}" aria-pressed="false">${esc(c.name)}</button>`)).join('');
    return `<main id="main" class="wrap">
  <header class="page-head">
    <p class="eyebrow">Архив</p>
    <h1 class="page-title">Все ${articles.length} статей</h1>
    <p class="page-lede">Ищите по названию, описанию или тегу. Номер у каждой статьи постоянный.</p>
  </header>
  <div class="finder" role="search">
    <label class="label" for="q">Поиск по журналу</label>
    <input id="q" class="finder__input" type="search" placeholder="Например: турбина, зима, Нива" autocomplete="off">
    <div class="toolbar__group" role="group" aria-label="Фильтр по рубрике">${filters}</div>
    <p class="toolbar__count" id="count" aria-live="polite">Найдено: ${articles.length}</p>
  </div>
  <ol class="rows" id="rows">${rows}</ol>
  <p class="empty" id="empty" hidden>Ничего не нашлось. Попробуйте другое слово или выберите «Все».</p>
</main>`;
  }

  function aboutPage(L, articles) {
    const words = articles.reduce((s, a) => s + a.words, 0);
    const hours = articles.reduce((s, a) => s + a.minutes, 0) / 60;
    return `<main id="main">
  <section class="wrap about-hero">
    <div class="about-hero__text">
      <p class="eyebrow">О журнале</p>
      <h1 class="page-title">Почему «${SITE.name}»</h1>
      <p class="post-lede" style="text-align:left">Отсечка — момент, когда электроника ограничивает обороты, чтобы двигатель не вышел за безопасный предел.</p>
    </div>
    <div class="band__tacho">${tacho()}</div>
  </section>
  <div class="wrap">${specStrip([
    { label: 'Статей', value: String(articles.length) },
    { label: 'Рубрик', value: String(CATEGORIES.length) },
    { label: 'Слов всего', value: '≈' + Math.round(words / 1000) + ' тыс.' },
    { label: 'Время чтения', value: '≈' + hours.toFixed(1).replace('.', ',').replace(',0', '') + ' ч' },
  ], 'spec--top')}</div>
  <section class="wrap about-body">
    <h2 class="h-section">Увлечённо, но по делу</h2>
    <div class="prose">
      <p>Стрелка тахометра упирается в красную зону, и мотор отдаёт всё, что может, но не больше. Нам нравится эта идея: говорить о машинах увлечённо, но без лишнего.</p>
      <p>Здесь собраны ${articles.length} статей в восьми рубриках: от первого автомобиля Карла Бенца до электромобилей, от замены масла до «Дакара». Тексты рассчитаны на тех, кто любит машины, но не обязан быть инженером: каждое понятие объясняется, каждый совет можно применить.</p>
      <ol>
        <li>Золотая линия у верхнего края экрана в статье показывает, сколько прочитано.</li>
        <li>«Паспорт темы» собирает главные цифры, чтобы их можно было найти за секунду.</li>
        <li>У каждой статьи постоянный номер, а в архиве работает поиск.</li>
      </ol>
      <aside class="callout callout--warn"><p class="callout__label">Важно</p><p>Статьи об обслуживании и ремонте дают общее понимание. Интервалы, допуски и моменты затяжки сверяйте с руководством по эксплуатации своей машины.</p></aside>
      <p><a class="btn btn--solid" href="${L.archive}">Открыть архив</a></p>
    </div>
  </section>
</main>`;
  }

  function notFound(L) {
    return `<main id="main" class="notfound">
  ${shot(L, { slug: '404', category: 'driving' }, { tone: 'dusk' })}
  <div class="notfound__body">
    <p class="eyebrow">Ошибка 404</p>
    <h1 class="page-title">Здесь дорога заканчивается</h1>
    <p class="page-lede">Такой страницы нет. Вернитесь на главную или откройте архив всех статей.</p>
    <div class="notfound__actions"><a class="btn btn--solid" href="${L.home}">На главную</a><a class="btn btn--ghost" href="${L.archive}">Архив</a></div>
  </div>
</main>`;
  }

  // Newest first; numbers follow publication order and never change.
  function prepare(list) {
    const byDate = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.slug < b.slug ? -1 : 1));
    byDate.forEach((a, i) => { a.no = i + 1; });
    return byDate.reverse();
  }

  const api = { SITE, CATEGORIES, CAT, ART, FEATURED, esc, fmtDate, parseArticle, renderMarkdown, cover, tacho, issue, header, footer, home, articlePage, categoryPage, archivePage, aboutPage, notFound, prepare, plural };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Site = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
