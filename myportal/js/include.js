    // ============ 编程研习工坊 — 共享导航栏 & 页脚 ============
(function () {
  "use strict";

  var IS_INDEX =
    window.location.pathname === "/" ||
    window.location.pathname.endsWith("index.html");

  function home(path) { return IS_INDEX ? path : "index.html" + path; }

  // 品牌 logo（内联 SVG，琥珀→青绿渐变书本/造物符号）
  var LOGO_SVG =
    '<svg class="logo-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#E07A3C"/><stop offset="1" stop-color="#2C8F87"/></linearGradient></defs>' +
    '<rect x="3" y="3" width="26" height="26" rx="8" fill="url(#lg)"/>' +
    '<path d="M11 10.5h10M11 16h7M11 21.5h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' +
    '<circle cx="22.5" cy="9.5" r="3" fill="#fff"/>' +
    '</svg>';

  // --- Navigation ---
  var NAV_HTML =
    '<nav id="navbar">' +
    '<div class="nav-inner">' +
    '<a href="' + home("#top") + '" class="nav-logo">' +
    LOGO_SVG +
    '<span class="nav-logo-text">' +
    '<span class="nav-logo-name">编程研习工坊</span>' +
    '<span class="nav-logo-tagline">Coding, Learning, Sharing for the Class.</span>' +
    '</span>' +
    "</a>" +
    '<ul class="nav-menu">' +
    '<li><a href="' + home("#change") + '">使命</a></li>' +
    '<li><a href="' + home("#vibe") + '">Vibe Coding</a></li>' +
    '<li><a href="' + home("#works") + '">作品</a></li>' +
    '<li><a href="' + home("#about") + '">关于</a></li>' +
    '<li><a href="classnode.html">ClassNode</a></li>' +
    "</ul>" +
    '<div class="nav-right">' +
    '<button class="theme-toggle" id="themeToggle" aria-label="切换主题">' +
    '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>' +
    '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
    "</button>" +
    '<a href="' + home("#works") + '" class="btn btn-primary btn-sm">浏览作品</a>' +
    "</div>" +
    "</div>" +
    "</nav>";

  // --- Footer ---
  var FOOTER_HTML =
    '<footer>' +
    '<div class="container">' +
    '<div class="footer-inner">' +
    '<div class="footer-brand">' + LOGO_SVG + '<span>编程研习工坊</span></div>' +
    '<div class="footer-links">' +
    '<a href="' + (IS_INDEX ? "classnode.html" : "index.html") + '">' + (IS_INDEX ? "ClassNode 详情" : "返回首页") + "</a>" +
    '<a href="' + (IS_INDEX ? "deploy.html" : "deploy.html") + '" target="_blank" rel="noopener">部署指南</a>' +
    '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">浙ICP备2026044424号-1</a>' +
    "</div>" +
    '<div class="footer-copy">Copyright 2026 编程研习工坊 · AI编程技术分享</div>' +
    "</div>" +
    "</div>" +
    "</footer>";

  // ============ 注入 ============
  var headerEl = document.querySelector('[data-include="header"]');
  var footerEl = document.querySelector('[data-include="footer"]');

  if (headerEl) {
    headerEl.innerHTML = NAV_HTML;

    // 当前页高亮
    var page = headerEl.dataset.page;
    if (page) {
      var pageMap = { classnode: "classnode.html", deploy: "#download" };
      var target = pageMap[page];
      if (target) {
        headerEl.querySelectorAll(".nav-menu a").forEach(function (lnk) {
          var href = lnk.getAttribute("href");
          if (href && href.indexOf(target) > -1) lnk.classList.add("active");
        });
      }
    }
  }

  if (footerEl) {
    footerEl.innerHTML = FOOTER_HTML;
  }
})();
