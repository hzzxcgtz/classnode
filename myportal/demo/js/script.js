// ====================================
// 智能造物 — Portal Script
// ====================================

(function () {
  "use strict";

  var root = document.documentElement;
  var glow = document.getElementById("cursorGlow");
  var progress = document.getElementById("scrollProgress");
  var navbar = document.getElementById("navbar");

  // ========== Theme ==========
  function initTheme() {
    var saved = localStorage.getItem("classnode-theme");
    root.setAttribute("data-theme", saved || "dark");
  }
  initTheme();

  var themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("classnode-theme", next);
    });
  }

  // ========== Scroll Handling ==========
  var ticking = false;

  function handleScroll() {
    var y = window.pageYOffset;
    var h = document.documentElement.scrollHeight - window.innerHeight;

    // Progress bar
    if (progress) progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";

    // Navbar border
    if (navbar) navbar.classList.toggle("scrolled", y > 10);

    // Nav highlight
    var pos = y + 100;
    var current = "";
    document.querySelectorAll("section[id]").forEach(function (s) {
      if (s.offsetTop <= pos) current = s.id;
    });
    var navLinks = document.querySelectorAll(".nav-menu a");
    navLinks.forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === "#" + current);
    });

    ticking = false;
  }

  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        requestAnimationFrame(handleScroll);
        ticking = true;
      }
    },
    { passive: true }
  );

  // ========== Cursor Glow ==========
  if (glow) {
    var mx = 0,
      my = 0,
      gx = 0,
      gy = 0;
    document.addEventListener("mousemove", function (e) {
      mx = e.clientX;
      my = e.clientY;
    });
    (function animGlow() {
      gx += (mx - gx) * 0.1;
      gy += (my - gy) * 0.1;
      glow.style.left = gx + "px";
      glow.style.top = gy + "px";
      requestAnimationFrame(animGlow);
    })();
  }

  // ========== Fade-in Observer ==========
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          setTimeout(function () {
            e.target.classList.add("visible");
          }, e.target.dataset.delay || 0);
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.1 }
  );

  document.querySelectorAll(".fade-in").forEach(function (el, i) {
    // Stagger: groups of 3 for slight delay
    var group = Math.floor(i / 3);
    el.dataset.delay = (i % 3) * 100 + group * 50;
    io.observe(el);
  });

  // ========== Smooth Scroll for Anchors ==========
  document.addEventListener("click", function (e) {
    var link = e.target.closest('a[href^="#"]');
    if (!link) return;
    var href = link.getAttribute("href");
    if (!href || href === "#") return;
    var target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();

    var startY = window.pageYOffset;
    var endY = target.getBoundingClientRect().top + startY - 60;
    var diff = endY - startY;
    var dur = 400;
    var startTime = performance.now();

    function step(now) {
      var p = Math.min((now - startTime) / dur, 1);
      var ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
      window.scrollTo(0, startY + diff * ease);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });

  // ========== Showcase Tabs (if present) ==========
  (function () {
    var tabs = document.querySelectorAll(".showcase-tab");
    var dots = document.querySelectorAll(".showcase-dot");
    var stage = document.getElementById("showcaseStage");
    var slides = stage ? stage.querySelectorAll(".showcase-slide") : [];
    if (!tabs.length || !slides.length) return;

    var current = 0;
    var autoTimer = null;
    var transitioning = false;
    var INTERVAL = 5000;

    function goTo(index) {
      if (index === current || !slides[index] || transitioning) return;
      transitioning = true;

      var direction = index > current ? "right" : "left";
      var enterCls =
        direction === "right" ? "slide-in-right" : "slide-in-left";

      slides[current].classList.remove("active");
      tabs[current].classList.remove("active");
      if (dots[current]) dots[current].classList.remove("active");

      current = index;

      void slides[current].offsetWidth; // force reflow
      slides[current].classList.add("active", enterCls);
      tabs[current].classList.add("active");
      if (dots[current]) dots[current].classList.add("active");

      setTimeout(function () {
        slides[current].classList.remove("slide-in-right", "slide-in-left");
        transitioning = false;
      }, 550);

      resetTimer();
    }

    function next() {
      goTo((current + 1) % slides.length);
    }

    function resetTimer() {
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = setInterval(next, INTERVAL);
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () {
        goTo(i);
      });
    });
    if (dots.length) {
      dots.forEach(function (dot, i) {
        dot.addEventListener("click", function () {
          goTo(i);
        });
      });
    }

    resetTimer();
  })();

  // Initial scroll
  handleScroll();
})();
