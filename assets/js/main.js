document.addEventListener('DOMContentLoaded', () => {
    // Navbar Scrolled State
    const navbar = document.getElementById('navbar');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Mobile Menu Toggle
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');
    
    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            mobileMenuBtn.classList.toggle('active');
            navLinks.classList.toggle('active');
        });
        
        // Close menu when clicking a link
        const links = navLinks.querySelectorAll('a');
        links.forEach(link => {
            link.addEventListener('click', () => {
                mobileMenuBtn.classList.remove('active');
                navLinks.classList.remove('active');
            });
        });
    }

    // =========================================================================
    // p5.js Background Animation — Perlin Noise Flow Field
    // =========================================================================
    const p5Container = document.getElementById('p5-container');
    if (p5Container) {
        new p5(function (p) {
            const particles = [];
            let cols, rows;
            const scl = 30;           // grid cell size
            let flowField;
            let zOff = 0;
            const colorMint  = p.color(0, 255, 195);
            const colorYellow = p.color(255, 196, 0);

            // Adaptive particle count
            function particleCount() {
                const area = p.windowWidth * p.windowHeight;
                return Math.min(Math.floor(area / 6000), 300);
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
                // Soft fade instead of full clear — creates trailing glow
                p.background(250, 250, 250, 30);

                // Build flow field from Perlin noise
                let xOff = 0;
                for (let x = 0; x < cols; x++) {
                    let yOff = 0;
                    for (let y = 0; y < rows; y++) {
                        const angle = p.noise(xOff, yOff, zOff) * p.TWO_PI * 2;
                        const v = p5.Vector.fromAngle(angle);
                        v.setMag(0.4);
                        flowField[x + y * cols] = v;
                        yOff += 0.08;
                    }
                    xOff += 0.08;
                }
                zOff += 0.001; // very slow evolution

                // Update & draw particles
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

                    // Wrap around edges
                    if (pt.pos.x > p.width)  pt.pos.x = 0;
                    if (pt.pos.x < 0)        pt.pos.x = p.width;
                    if (pt.pos.y > p.height)  pt.pos.y = 0;
                    if (pt.pos.y < 0)        pt.pos.y = p.height;

                    // Draw
                    const c = pt.isMint ? colorMint : colorYellow;
                    p.noStroke();
                    const alpha = p.map(pt.radius, 1, 4, 50, 120);
                    p.fill(p.red(c), p.green(c), p.blue(c), alpha);
                    p.ellipse(pt.pos.x, pt.pos.y, pt.radius * 2);

                    // Subtle glow ring
                    p.fill(p.red(c), p.green(c), p.blue(c), alpha * 0.25);
                    p.ellipse(pt.pos.x, pt.pos.y, pt.radius * 6);

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
                    vel: p5.Vector.random2D().mult(0.5),
                    maxSpeed: sketch.random(1, 2.5),
                    radius: sketch.random(1, 4),
                    isMint: sketch.random() > 0.45,
                    life: sketch.floor(sketch.random(200, 600))
                };
            }

            function resetParticle(pt, sketch) {
                pt.pos.set(sketch.random(sketch.width), sketch.random(sketch.height));
                pt.vel = p5.Vector.random2D().mult(0.5);
                pt.life = sketch.floor(sketch.random(200, 600));
                pt.isMint = sketch.random() > 0.45;
            }

        }, p5Container);
    }
});
