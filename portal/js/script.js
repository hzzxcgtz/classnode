// ============ 主题切换 ============
const themeToggle = document.getElementById('themeToggle');
const root = document.documentElement;

function initTheme() {
    const saved = localStorage.getItem('classnode-theme');
    if (saved) {
        root.setAttribute('data-theme', saved);
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
}
initTheme();

themeToggle.addEventListener('click', () => {
    const current = root.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('classnode-theme', next);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('classnode-theme')) {
        root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
});

// ============ 平滑滚动 ============
document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
        var href = this.getAttribute('href');
        if (href === '#') return;
        var target = document.querySelector(href);
        if (target) {
            e.preventDefault();
            var offset = 80;
            var startY = window.pageYOffset;
            var endY = target.getBoundingClientRect().top + startY - offset;
            var dist = Math.abs(endY - startY);
            var duration = Math.min(400, Math.max(200, dist * 0.3));
            var startTime = null;
            function step(now) {
                if (!startTime) startTime = now;
                var elapsed = now - startTime;
                var p = Math.min(1, elapsed / duration);
                // ease-out quad: fast start, slow end
                var ease = 1 - (1 - p) * (1 - p);
                window.scrollTo(0, startY + (endY - startY) * ease);
                if (p < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
        }
    });
});

// ============ 滚动驱动动画 ============
const navbar = document.getElementById('navbar');
const scrollProgress = document.getElementById('scrollProgress');
const gridBg = document.getElementById('gridBg');
const orb1 = document.getElementById('orb1');
const orb2 = document.getElementById('orb2');
const orb3 = document.getElementById('orb3');
const floatingShapes = document.querySelectorAll('.floating-shape');

let lastScroll = 0;
let ticking = false;
let scrollRAF = null;

function handleScroll() {
    const scrollY = window.pageYOffset;
    const windowHeight = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight - windowHeight;
    const progress = (scrollY / docHeight) * 100;

    // 进度条 update — cheap
    scrollProgress.style.width = progress + '%';

    // 导航栏 — cheap
    navbar.classList.toggle('scrolled', scrollY > 50);

    // 视差效果 — throttle with transform optimizations
    const gridScale = 1 + (scrollY / windowHeight) * 0.1;
    gridBg.style.transform = `scale(${gridScale}) rotate(${scrollY * 0.02}deg)`;

    orb1.style.transform = `translate3d(${scrollY * 0.1}px, ${scrollY * 0.3}px, 0)`;
    orb2.style.transform = `translate3d(${-scrollY * 0.15}px, ${scrollY * 0.2}px, 0)`;
    orb3.style.transform = `translate3d(${scrollY * 0.08}px, ${-scrollY * 0.1}px, 0)`;

    floatingShapes.forEach(shape => {
        const speed = parseFloat(shape.dataset.speed) || 0.3;
        shape.style.transform = `translate3d(0, ${scrollY * speed}px, 0)`;
    });

    ticking = false;
}

window.addEventListener('scroll', () => {
    if (!ticking) {
        scrollRAF = requestAnimationFrame(handleScroll);
        ticking = true;
    }
}, { passive: true });

// ============ 鼠标光晕 ============
const cursorGlow = document.getElementById('cursorGlow');
let mouseX = 0, mouseY = 0;
let glowX = 0, glowY = 0;

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

function animateGlow() {
    glowX += (mouseX - glowX) * 0.15;
    glowY += (mouseY - glowY) * 0.15;
    cursorGlow.style.left = glowX + 'px';
    cursorGlow.style.top = glowY + 'px';
    requestAnimationFrame(animateGlow);
}
animateGlow();

// ============ 特性卡片鼠标跟随 ============
document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        card.style.setProperty('--mx', x + '%');
        card.style.setProperty('--my', y + '%');
    });
});

// ============ Intersection Observer淡入 ============
const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, idx) => {
        if (entry.isIntersecting) {
            const delay = entry.target.dataset.delay || 0;
            setTimeout(() => {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }, delay);
        }
    });
}, { threshold: 0.1, rootMargin: '0px 0px -80px 0px' });

document.querySelectorAll('.feature-card, .pain-card, .workflow-card').forEach((el, idx) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    el.dataset.delay = (idx % 4) * 100;
    observer.observe(el);
});

// ============ Canvas 粒子动画 ============
const canvas = document.getElementById('bgCanvas');
const ctx = canvas.getContext('2d');
let particles = [];
let canvasMouseX = 0, canvasMouseY = 0;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

document.addEventListener('mousemove', (e) => {
    canvasMouseX = e.clientX;
    canvasMouseY = e.clientY;
});

class Particle {
    constructor() {
        this.reset();
        this.y = Math.random() * canvas.height;
    }

    reset() {
        this.x = Math.random() * canvas.width;
        this.y = canvas.height + 10;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = -Math.random() * 0.5 - 0.2;
        this.radius = Math.random() * 1.5 + 0.5;
        this.opacity = Math.random() * 0.4 + 0.1;
        this.life = 1;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        // 鼠标交互
        const dx = canvasMouseX - this.x;
        const dy = canvasMouseY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
            const force = (100 - dist) / 100;
            this.x -= (dx / dist) * force * 0.5;
            this.y -= (dy / dist) * force * 0.5;
        }

        if (this.y < -10 || this.x < -10 || this.x > canvas.width + 10) {
            this.reset();
        }
    }

    draw() {
        const isDark = root.getAttribute('data-theme') === 'dark';
        const color = isDark ? '255, 255, 255' : '0, 0, 0';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${this.opacity})`;
        ctx.fill();
    }
}

function initParticles() {
    particles = [];
    const count = Math.min(60, Math.floor((canvas.width * canvas.height) / 25000));
    for (let i = 0; i < count; i++) {
        particles.push(new Particle());
    }
}
initParticles();
window.addEventListener('resize', initParticles);

function drawConnections() {
    const isDark = root.getAttribute('data-theme') === 'dark';
    const color = isDark ? '255, 255, 255' : '0, 0, 0';

    for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 120) {
                const opacity = (1 - dist / 120) * 0.1;
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(particles[j].x, particles[j].y);
                ctx.strokeStyle = `rgba(${color}, ${opacity})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }
    }
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
        p.update();
        p.draw();
    });
    drawConnections();
    requestAnimationFrame(animate);
}
animate();

// 初始触发一次滚动处理
handleScroll();

// ============ 界面展示 ============
(function () {
    const container = document.getElementById('showcaseStage');
    const tabs = document.querySelectorAll('.showcase-tab');
    const dots = document.querySelectorAll('.showcase-dot');
    const slides = container?.querySelectorAll('.showcase-slide');
    if (!container || !tabs.length) return;

    let current = 0;
    let autoTimer = null;
    let transitioning = false;
    const INTERVAL = 5000;

    function goTo(index) {
        if (index === current || !slides[index] || transitioning) return;
        transitioning = true;

        const direction = index > current ? 'right' : 'left';
        const enterCls = direction === 'right' ? 'slide-in-right' : 'slide-in-left';

        slides[current].classList.remove('active');
        tabs[current].classList.remove('active');
        dots[current].classList.remove('active');

        current = index;

        // Force reflow so the display:none→flex takes effect before animation starts
        void slides[current].offsetWidth;
        slides[current].classList.add('active', enterCls);
        tabs[current].classList.add('active');
        dots[current].classList.add('active');

        setTimeout(() => {
            slides[current].classList.remove('slide-in-right', 'slide-in-left');
            transitioning = false;
        }, 550);

        resetTimer();
    }

    function next() { goTo((current + 1) % slides.length); }

    function resetTimer() {
        if (autoTimer) clearInterval(autoTimer);
        autoTimer = setInterval(next, INTERVAL);
    }

    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => goTo(i));
    });
    dots.forEach((dot, i) => {
        dot.addEventListener('click', () => goTo(i));
    });

    resetTimer();
})();

// ============ 下载版本标签切换 ============
(function() {
  var tabs = document.querySelectorAll('.dl-version-tab');
  var panels = document.querySelectorAll('.dl-version-panel');
  if (!tabs.length) return;

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var version = this.dataset.version;
      tabs.forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      panels.forEach(function(p) { p.classList.remove('active'); });
      var panel = document.querySelector('[data-panel="' + version + '"]');
      if (panel) panel.classList.add('active');
    });
  });
})();

// ============ 导航滚动高亮 ============
(function() {
  var navLinks = document.querySelectorAll('.nav-menu a');
  if (!navLinks.length) return;

  var sections = [];
  navLinks.forEach(function(link) {
    var href = link.getAttribute('href');
    if (href && href.charAt(0) === '#') {
      var el = document.querySelector(href);
      if (el) sections.push({ el: el, link: link });
    }
  });

  function updateActive() {
    var scrollY = window.pageYOffset + 100;
    var current = sections[0];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].el.offsetTop <= scrollY) current = sections[i];
    }
    navLinks.forEach(function(l) { l.style.color = ''; });
    if (current) current.link.style.color = 'var(--text-primary)';
  }

  window.addEventListener('scroll', updateActive, { passive: true });
  updateActive();
})();

// ============ 快速平滑滚动 ============
(function () {
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function scrollToTarget(targetY, duration) {
    var startY = window.pageYOffset;
    var diff = targetY - startY;
    if (Math.abs(diff) < 5) { window.scrollTo(0, targetY); return; }
    var startTime = performance.now();

    function step(now) {
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      window.scrollTo(0, startY + diff * easeOutCubic(progress));
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="#"]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href || href === '#') return;
    var target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    scrollToTarget(target.getBoundingClientRect().top + window.pageYOffset, 360);
  });
})();
