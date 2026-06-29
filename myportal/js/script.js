// ====================================
// AI 造物志 — Portal Script
// ====================================

(function () {
  "use strict";

  var root = document.documentElement;
  var progress = document.getElementById("scrollProgress");
  var navbar = document.getElementById("navbar");

  // ========== Theme（暖色为主，默认 light） ==========
  function initTheme() {
    var saved = localStorage.getItem("zao-theme");
    // 系统首次访问跟随 prefers-color-scheme，否则默认浅色
    if (!saved) {
      var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      saved = prefersDark ? "dark" : "light";
    }
    root.setAttribute("data-theme", saved);
  }
  initTheme();

  var themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("zao-theme", next);
    });
  }

  // ========== Scroll ==========
  var ticking = false;
  function handleScroll() {
    var y = window.pageYOffset;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    if (navbar) navbar.classList.toggle("scrolled", y > 10);

    // 导航高亮（首页锚点）
    var pos = y + 120;
    var current = "";
    document.querySelectorAll("section[id]").forEach(function (s) {
      if (s.offsetTop <= pos) current = s.id;
    });
    if (current) {
      document.querySelectorAll(".nav-menu a").forEach(function (a) {
        var href = a.getAttribute("href") || "";
        a.classList.toggle("active", href.indexOf("#" + current) > -1 && href.indexOf("index.html") === -1 && IS_INDEX());
      });
    }
    ticking = false;
  }
  function IS_INDEX() {
    return window.location.pathname === "/" || window.location.pathname.endsWith("index.html");
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { requestAnimationFrame(handleScroll); ticking = true; }
  }, { passive: true });

  // ========== Fade-in Observer ==========
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        setTimeout(function () { e.target.classList.add("visible"); }, e.target.dataset.delay || 0);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll(".fade-in").forEach(function (el, i) {
    var group = Math.floor(i / 3);
    el.dataset.delay = (i % 3) * 90 + group * 40;
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
    var endY = target.getBoundingClientRect().top + startY - 72;
    var diff = endY - startY;
    var dur = 450;
    var startTime = performance.now();
    function step(now) {
      var p = Math.min((now - startTime) / dur, 1);
      var ease = 1 - Math.pow(1 - p, 3);
      window.scrollTo(0, startY + diff * ease);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });

  // ========== ClassNode Showcase Tabs（详情页） ==========
  (function () {
    var tabs = document.querySelectorAll(".showcase-tab");
    var dots = document.querySelectorAll(".showcase-dot");
    var stage = document.getElementById("showcaseStage");
    var slides = stage ? stage.querySelectorAll(".showcase-slide") : [];
    if (!tabs.length || !slides.length) return;

    var current = 0;
    var autoTimer = null;
    var transitioning = false;
    var INTERVAL = 5200;

    function goTo(index) {
      if (index === current || !slides[index] || transitioning) return;
      transitioning = true;
      var enterCls = index > current ? "slide-in-right" : "slide-in-left";

      slides[current].classList.remove("active");
      tabs[current].classList.remove("active");
      if (dots[current]) dots[current].classList.remove("active");

      current = index;
      void slides[current].offsetWidth;
      slides[current].classList.add("active", enterCls);
      tabs[current].classList.add("active");
      if (dots[current]) dots[current].classList.add("active");

      setTimeout(function () {
        slides[current].classList.remove("slide-in-right", "slide-in-left");
        transitioning = false;
      }, 560);
      resetTimer();
    }
    function next() { goTo((current + 1) % slides.length); }
    function resetTimer() { if (autoTimer) clearInterval(autoTimer); autoTimer = setInterval(next, INTERVAL); }

    tabs.forEach(function (tab, i) { tab.addEventListener("click", function () { goTo(i); }); });
    dots.forEach(function (dot, i) { dot.addEventListener("click", function () { goTo(i); }); });
    resetTimer();
  })();

  handleScroll();
})();
