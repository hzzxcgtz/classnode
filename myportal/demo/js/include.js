// ============ 共享导航栏 & 页脚 ============
(function () {
  "use strict";

  var IS_INDEX =
    window.location.pathname === "/" ||
    window.location.pathname.endsWith("index.html");

  // --- Navigation ---
  var NAV_HTML =
    '<nav id="navbar">' +
    '<div class="nav-inner">' +
    '<a href="' +
    (IS_INDEX ? "#" : "index.html") +
    '" class="nav-logo">' +
    '<span class="logo-dot"></span>' +
    '智能造物' +
    "</a>" +
    '<ul class="nav-menu">' +
    '<li><a href="' +
    (IS_INDEX ? "#works" : "index.html#works") +
    '">作品</a></li>' +
    '<li><a href="' +
    (IS_INDEX ? "#about" : "index.html#about") +
    '">关于</a></li>' +
    '<li><a href="' +
    (IS_INDEX ? "#download" : "index.html#download") +
    '">下载</a></li>' +
    '<li><a href="' +
    (IS_INDEX ? "#philosophy" : "index.html#philosophy") +
    '">理念</a></li>' +
    "</ul>" +
    '<div class="nav-right">' +
    '<button class="theme-toggle" id="themeToggle" aria-label="Toggle Theme">' +
    '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>' +
    '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
    "</button>" +
    '<a href="' +
    (IS_INDEX ? "#works" : "index.html#works") +
    '" class="btn btn-primary">获取 ClassNode</a>' +
    "</div>" +
    "</div>" +
    "</nav>";

  // --- Footer ---
  var FOOTER_HTML =
    '<footer>' +
    '<div class="container">' +
    '<div class="footer-inner">' +
    '<div>© 2026 智能造物 · AI编程技术分享</div>' +
    '<div style="display:flex; gap:24px; align-items:center;">' +
    '<a href="classnode.html">项目详情</a>' +
    '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">浙ICP备2026044424号-1</a>' +
    "</div>" +
    "</div>" +
    "</div>" +
    "</footer>";

  // ============ 注入 ============
  var headerEl = document.querySelector('[data-include="header"]');
  var footerEl = document.querySelector('[data-include="footer"]');

  if (headerEl) {
    headerEl.innerHTML = NAV_HTML;

    // 高亮当前页
    var page = headerEl.dataset.page;
    if (page) {
      var links = headerEl.querySelectorAll(".nav-menu a");
      // pageMap: which nav item (by anchor href) to highlight per page
      var pageMap = {
        index: "#works",     // index页高亮"作品"
        classnode: "#works", // classnode也高亮"作品"
      };
      var targetAnchor = pageMap[page];
      if (targetAnchor) {
        links.forEach(function (lnk) {
          var href = lnk.getAttribute("href");
          if (href === targetAnchor || href.indexOf(targetAnchor) > -1) {
            lnk.classList.add("active");
          }
        });
      }
    }
  }

  if (footerEl) {
    footerEl.innerHTML = FOOTER_HTML;
  }
})();
