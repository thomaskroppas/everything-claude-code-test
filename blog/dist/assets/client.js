/* «Отсечка» — browser behaviour shared by the static site and the single-file build. */
(function () {
  'use strict';

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- mobile menu ----
  function initMenu() {
    const btn = document.querySelector('.menu-btn');
    const menu = document.getElementById('site-menu');
    if (!btn || !menu || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    });
  }

  // ---- tachometer: the needle sweeps to the red zone, bounces off the limiter, settles ----
  const angle = (v) => 135 + v * 33.75;
  function sweep(el) {
    const needle = el.querySelector('.tacho__needle');
    const target = parseFloat(el.dataset.tacho) || 7.35;
    if (!needle) return;
    const set = (v) => needle.setAttribute('transform', 'rotate(' + angle(v).toFixed(2) + ' 200 200)');
    cancelAnimationFrame(el._raf);
    if (reduceMotion() || document.hidden) { set(target); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = (now - t0) / 1000;
      let v;
      if (t < 1.3) v = 7.8 * (1 - Math.pow(1 - t / 1.3, 3));
      else if (t < 2.5) { const u = (t - 1.3) / 1.2; v = 7.8 - 0.32 * Math.abs(Math.sin(u * Math.PI * 4)) * (1 - u * 0.6); }
      else if (t < 3.2) { const u = (t - 2.5) / 0.7, e = u * u * (3 - 2 * u); v = 7.75 + (target - 7.75) * e; }
      else { set(target); return; }
      set(v);
      el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }
  function initTacho() {
    document.querySelectorAll('[data-tacho]').forEach((el) => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('mouseenter', () => sweep(el));
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((e) => { if (e.isIntersecting) { sweep(el); io.disconnect(); } });
        }, { threshold: 0.4 });
        io.observe(el);
      } else sweep(el);
    });
  }

  // ---- reading progress (gold line) + active TOC entry ----
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const bar = document.querySelector('.read-progress i');
      const prose = document.querySelector('.post-layout .prose');
      if (!bar || !prose) return;
      const rect = prose.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.6;
      const p = Math.min(1, Math.max(0, (-rect.top + window.innerHeight * 0.25) / Math.max(1, total)));
      bar.style.width = (p * 100).toFixed(2) + '%';
      const links = document.querySelectorAll('.toc a[data-toc]');
      let current = null;
      links.forEach((a) => {
        const h = document.getElementById(a.dataset.toc);
        if (h && h.getBoundingClientRect().top < window.innerHeight * 0.3) current = a;
      });
      links.forEach((a) => a.classList.toggle('active', a === current));
    });
  }

  // ---- category sort ----
  function initSort() {
    const grid = document.getElementById('cat-grid');
    const buttons = document.querySelectorAll('[data-sort]');
    if (!grid || !buttons.length) return;
    let order = 'new';
    buttons.forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.sort === order) return;
      order = b.dataset.sort;
      Array.from(grid.children).reverse().forEach((c) => grid.appendChild(c));
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
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
    initMenu();
    initTacho();
    initSort();
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
      el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
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
