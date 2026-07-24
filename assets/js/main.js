/* Protocodus — just enough JavaScript.
   Entrance sequence, scroll reveals, the mobile menu, and the yellow rule
   that marks the section you are currently reading. Nothing else. */

(() => {
  'use strict';

  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ===========================================================================
  // Entrance
  // ===========================================================================
  requestAnimationFrame(() => root.classList.add('is-ready'));

  // ===========================================================================
  // Footer year
  // ===========================================================================
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ===========================================================================
  // Navigation — condensed background once the page moves
  // ===========================================================================
  const nav = document.getElementById('nav');

  const syncNav = () => {
    nav.classList.toggle('is-scrolled', window.scrollY > 8);
  };

  if (nav) {
    syncNav();
    window.addEventListener('scroll', syncNav, { passive: true });
  }

  // ===========================================================================
  // Mobile menu
  // ===========================================================================
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('nav-menu');

  if (toggle && menu) {
    const setMenu = (open) => {
      menu.classList.toggle('is-open', open);
      toggle.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };

    toggle.addEventListener('click', () => {
      setMenu(!menu.classList.contains('is-open'));
    });

    menu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMenu(false));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.classList.contains('is-open')) {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  // ===========================================================================
  // Scroll reveals
  // ===========================================================================
  const revealed = document.querySelectorAll('.reveal');

  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealed.forEach((el) => el.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.1 });

    revealed.forEach((el) => observer.observe(el));
  }

  // ===========================================================================
  // The rule — marks the section you are reading
  // ===========================================================================
  const rule = document.querySelector('.nav-rule');
  const links = [...document.querySelectorAll('.nav-link')];
  const sections = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  let current = null;

  const moveRule = () => {
    if (!rule) return;
    if (!current || window.matchMedia('(max-width: 760px)').matches) {
      rule.classList.remove('is-on');
      return;
    }
    rule.style.width = `${current.offsetWidth}px`;
    rule.style.transform = `translateX(${current.offsetLeft}px)`;
    rule.classList.add('is-on');
  };

  const setCurrent = (link) => {
    if (link === current) return;
    links.forEach((el) => el.classList.toggle('is-current', el === link));
    current = link;
    moveRule();
  };

  if (sections.length && 'IntersectionObserver' in window) {
    const seen = new Set();

    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) seen.add(entry.target);
        else seen.delete(entry.target);
      });

      // The topmost section crossing the middle of the viewport wins.
      const active = sections.find((section) => seen.has(section));
      setCurrent(active ? links[sections.indexOf(active)] : null);
    }, { rootMargin: '-50% 0px -45% 0px' });

    sections.forEach((section) => spy.observe(section));
    window.addEventListener('resize', moveRule);
  }
})();
