document.addEventListener('DOMContentLoaded', () => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =========================================================================
  // Footer year
  // =========================================================================
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // =========================================================================
  // Mobile menu
  // =========================================================================
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.getElementById('nav-menu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      const open = navMenu.classList.toggle('active');
      navToggle.classList.toggle('active', open);
      navToggle.setAttribute('aria-expanded', String(open));
    });

    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        navToggle.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // =========================================================================
  // Scroll reveal
  // =========================================================================
  const revealEls = document.querySelectorAll('.reveal');

  if (prefersReducedMotion) {
    revealEls.forEach((el) => el.classList.add('visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px'
    });

    revealEls.forEach((el) => revealObserver.observe(el));
  }

  // =========================================================================
  // Hero eyebrow — typewriter
  // =========================================================================
  const typeTarget = document.querySelector('.type-target');
  if (typeTarget && !prefersReducedMotion) {
    const fullText = typeTarget.textContent;
    typeTarget.textContent = '';
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      typeTarget.textContent = fullText.slice(0, i);
      if (i >= fullText.length) {
        clearInterval(timer);
      }
    }, 32);
  }

  // =========================================================================
  // Hero sparks — mouse parallax
  // =========================================================================
  const hero = document.querySelector('.hero');
  const sparks = document.querySelectorAll('.hero-spark');
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  if (hero && sparks.length && finePointer && !prefersReducedMotion) {
    hero.addEventListener('mousemove', (e) => {
      const dx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
      const dy = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
      sparks.forEach((spark) => {
        const depth = parseFloat(spark.dataset.depth || '1');
        spark.style.transform = `translate(${dx * 12 * depth}px, ${dy * 12 * depth}px)`;
      });
    });
  }

  // =========================================================================
  // Hero — spark burst on click
  // =========================================================================
  const SPARK_PATH = 'M12 0L15 9L24 12L15 15L12 24L9 15L0 12L9 9Z';

  if (hero && !prefersReducedMotion) {
    hero.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;

      const rect = hero.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const count = 6;

      for (let i = 0; i < count; i++) {
        const el = document.createElement('span');
        el.className = 'burst-spark';
        el.style.left = `${x - 8}px`;
        el.style.top = `${y - 8}px`;
        const color = i % 2 === 0 ? '#FFC400' : '#00FFC3';
        el.innerHTML =
          `<svg viewBox="0 0 24 24"><path d="${SPARK_PATH}" fill="${color}" ` +
          `stroke="#1A1A1A" stroke-width="1.5"/></svg>`;
        hero.appendChild(el);

        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
        const dist = 44 + Math.random() * 46;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;

        el.animate([
          { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
          { transform: `translate(${tx}px, ${ty}px) scale(0) rotate(160deg)`, opacity: 0 }
        ], {
          duration: 620,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }).onfinish = () => el.remove();
      }
    });
  }
});
