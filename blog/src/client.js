/* «Отсечка» — browser behaviour shared by the static site and the single-file build. */
(function () {
  'use strict';

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { /* storage blocked: the page works without it */ }
    return null;
  }

  // ---- theme toggle (static site only; the artifact follows the viewer's theme) ----
  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function initTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    const label = () => { btn.textContent = isDark() ? 'Светлая тема' : 'Тёмная тема'; };
    label();
    btn.addEventListener('click', () => {
      document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
      store('otsechka-theme', document.documentElement.dataset.theme);
      label();
    });
  }

  // ---- rev bar reading progress + active TOC entry ----
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const bar = document.querySelector('.revbar--progress');
      const prose = document.querySelector('.post .prose');
      if (!bar || !prose) return;
      const rect = prose.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.6;
      const p = Math.min(1, Math.max(0, (-rect.top + window.innerHeight * 0.25) / Math.max(1, total)));
      const segs = bar.children, lit = Math.round(p * segs.length);
      for (let i = 0; i < segs.length; i++) segs[i].classList.toggle('on', i < lit);
      const links = document.querySelectorAll('.toc a[data-toc]');
      let current = null;
      links.forEach((a) => {
        const h = document.getElementById(a.dataset.toc);
        if (h && h.getBoundingClientRect().top < window.innerHeight * 0.3) current = a;
      });
      links.forEach((a) => a.classList.toggle('active', a === current));
    });
  }

  // ---- archive search + category filter ----
  function initArchive() {
    const q = document.getElementById('q');
    const rows = document.querySelectorAll('#rows .row');
    if (!q || !rows.length) return;
    const buttons = document.querySelectorAll('.filter');
    const count = document.getElementById('count');
    const empty = document.getElementById('empty');
    let cat = '';
    function apply() {
      const words = q.value.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
      let n = 0;
      rows.forEach((r) => {
        const hay = r.dataset.q.replace(/ё/g, 'е');
        const ok = (!cat || r.dataset.cat === cat) && words.every((w) => hay.includes(w));
        r.hidden = !ok;
        if (ok) n++;
      });
      count.textContent = 'Найдено: ' + n;
      empty.hidden = n > 0;
    }
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 250); });
    buttons.forEach((b) => b.addEventListener('click', () => {
      cat = b.dataset.filter;
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      apply();
    }));
    apply();
  }

  function init() {
    initTheme();
    initArchive();
    onScroll();
  }

  // In the single-file build the hash holds the route, so in-page anchors scroll without touching it.
  if (window.OTSECHKA_SPA) {
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#sec-"], a[href="#main"]');
      if (!a) return;
      const el = document.getElementById(a.getAttribute('href').slice(1));
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (a.getAttribute('href') === '#main') { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.Otsechka = { init: init };
  if (!window.OTSECHKA_SPA) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})();
