document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // Navbar Scroll State
    // =========================================================================
    const navbar = document.getElementById('navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // =========================================================================
    // Mobile Menu
    // =========================================================================
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');
    
    if (mobileMenuBtn && navLinks) {
        // Initialize aria-expanded for accessibility
        mobileMenuBtn.setAttribute('aria-expanded', 'false');

        // Helper functions for menu state
        function closeMenu() {
            mobileMenuBtn.classList.remove('active');
            navLinks.classList.remove('active');
            mobileMenuBtn.setAttribute('aria-expanded', 'false');
        }

        function openMenu() {
            mobileMenuBtn.classList.add('active');
            navLinks.classList.add('active');
            mobileMenuBtn.setAttribute('aria-expanded', 'true');
            // Focus first menu link when opened
            const firstLink = navLinks.querySelector('a');
            if (firstLink) setTimeout(() => firstLink.focus(), 0);
        }

        // Toggle menu on button click
        mobileMenuBtn.addEventListener('click', () => {
            const isOpen = mobileMenuBtn.classList.contains('active');
            if (isOpen) {
                closeMenu();
            } else {
                openMenu();
            }
        });

        // Close menu when a link is clicked
        const links = navLinks.querySelectorAll('a');
        links.forEach(link => {
            link.addEventListener('click', closeMenu);
        });

        // Keyboard navigation: Escape closes menu
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && mobileMenuBtn.classList.contains('active')) {
                closeMenu();
                mobileMenuBtn.focus();
            }
        });

        // Keyboard navigation: Tab and Shift+Tab for focus trap
        links.forEach((link, index) => {
            link.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                    if (e.shiftKey && index === 0) {
                        // Shift+Tab on first link goes to button
                        e.preventDefault();
                        mobileMenuBtn.focus();
                    } else if (!e.shiftKey && index === links.length - 1) {
                        // Tab on last link goes to button
                        e.preventDefault();
                        mobileMenuBtn.focus();
                    }
                }
            });
        });

        // Tab from button when menu is open goes to first link
        mobileMenuBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.shiftKey && mobileMenuBtn.classList.contains('active')) {
                e.preventDefault();
                links[0].focus();
            }
        });
    }

    // =========================================================================
    // Scroll Reveal
    // =========================================================================
    const revealEls = document.querySelectorAll('.reveal');
    
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.15,
        rootMargin: '0px 0px -40px 0px'
    });

    revealEls.forEach(el => revealObserver.observe(el));

    // =========================================================================
    // p5.js Background — Elegant Perlin Noise Flow Field
    // =========================================================================
    const p5Container = document.getElementById('p5-container');
    if (p5Container) {
        new p5(function (p) {
            const particles = [];
            let cols, rows;
            const scl = 35;
            let flowField;
            let zOff = 0;

            function particleCount() {
                const area = p.windowWidth * p.windowHeight;
                // Fewer particles for a cleaner, more elegant look
                return Math.min(Math.floor(area / 10000), 200);
            }

            p.setup = function () {
                const cnv = p.createCanvas(p.windowWidth, p.windowHeight);
                cnv.style('display', 'block');
                p.colorMode(p.RGB, 255, 255, 255, 255);

                cols = Math.floor(p.width / scl) + 1;
                rows = Math.floor(p.height / scl) + 1;
                flowField = new Array(cols * rows);

                const count = particleCount();
                for (let i = 0; i < count; i++) {
                    particles.push(createParticle(p));
                }
            };

            p.draw = function () {
                // Faster fade = cleaner trails, no heavy buildup
                p.background(250, 250, 250, 45);

                // Build flow field
                let xOff = 0;
                for (let x = 0; x < cols; x++) {
                    let yOff = 0;
                    for (let y = 0; y < rows; y++) {
                        const angle = p.noise(xOff, yOff, zOff) * p.TWO_PI * 2;
                        const v = p5.Vector.fromAngle(angle);
                        v.setMag(0.3);
                        flowField[x + y * cols] = v;
                        yOff += 0.06;
                    }
                    xOff += 0.06;
                }
                zOff += 0.0008;

                for (const pt of particles) {
                    const col = Math.floor(pt.pos.x / scl);
                    const row = Math.floor(pt.pos.y / scl);
                    const idx = col + row * cols;
                    const force = flowField[idx];
                    if (force) {
                        pt.vel.add(force);
                    }
                    pt.vel.limit(pt.maxSpeed);
                    pt.pos.add(pt.vel);

                    // Wrap edges
                    if (pt.pos.x > p.width)  pt.pos.x = 0;
                    if (pt.pos.x < 0)        pt.pos.x = p.width;
                    if (pt.pos.y > p.height)  pt.pos.y = 0;
                    if (pt.pos.y < 0)        pt.pos.y = p.height;

                    // Mint = 0, 220, 170 (slightly desaturated for elegance)
                    // Yellow = 255, 196, 0
                    const r = pt.isMint ? 0   : 255;
                    const g = pt.isMint ? 210 : 196;
                    const b = pt.isMint ? 170 : 0;

                    // Core dot
                    p.noStroke();
                    const alpha = p.map(pt.radius, 1, 3.5, 35, 80);
                    p.fill(r, g, b, alpha);
                    p.ellipse(pt.pos.x, pt.pos.y, pt.radius * 2);

                    // Soft glow
                    p.fill(r, g, b, alpha * 0.15);
                    p.ellipse(pt.pos.x, pt.pos.y, pt.radius * 5);

                    pt.life--;
                    if (pt.life <= 0) {
                        resetParticle(pt, p);
                    }
                }
            };

            p.windowResized = function () {
                p.resizeCanvas(p.windowWidth, p.windowHeight);
                cols = Math.floor(p.width / scl) + 1;
                rows = Math.floor(p.height / scl) + 1;
                flowField = new Array(cols * rows);
            };

            function createParticle(sketch) {
                return {
                    pos: sketch.createVector(sketch.random(sketch.width), sketch.random(sketch.height)),
                    vel: p5.Vector.random2D().mult(0.3),
                    maxSpeed: sketch.random(0.8, 2),
                    radius: sketch.random(1, 3.5),
                    isMint: sketch.random() > 0.4,
                    life: sketch.floor(sketch.random(300, 800))
                };
            }

            function resetParticle(pt, sketch) {
                pt.pos.set(sketch.random(sketch.width), sketch.random(sketch.height));
                pt.vel = p5.Vector.random2D().mult(0.3);
                pt.life = sketch.floor(sketch.random(300, 800));
                pt.isMint = sketch.random() > 0.4;
            }

        }, p5Container);
    }
});
