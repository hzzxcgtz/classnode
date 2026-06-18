// ============ 共享导航栏 ============
(function () {
  var IS_INDEX =
    window.location.pathname === "/" ||
    window.location.pathname.endsWith("index.html");

  var NAV_HTML =
    '<nav id="navbar">' +
    '<div class="nav-container">' +
    '<a href="' +
    (IS_INDEX ? "#" : "index.html") +
    '" class="nav-logo">' +
    '<img src="images/logo.png" alt="ClassNode" class="nav-logo-icon">' +
    '<span class="nav-logo-text">ClassNode</span>' +
    "</a>" +
    '<ul class="nav-menu">' +
    '<li><a href="' +
    (IS_INDEX ? "#" : "index.html#") +
    'features">特性</a></li>' +
    '<li><a href="' +
    (IS_INDEX ? "#" : "index.html#") +
    'gallery">功能预览</a></li>' +
    '<li><a href="deploy.html">安装部署</a></li>' +
    '<li><a href="' +
    (IS_INDEX ? "#" : "index.html#") +
    'cloud-drives">下载渠道</a></li>' +
    '<li><a href="' +
    (IS_INDEX ? "#" : "index.html#") +
    'about">关于</a></li>' +
    "</ul>" +
    '<div class="nav-cta">' +
    '<button class="theme-toggle" id="themeToggle" aria-label="切换主题">' +
    '<svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
    '<svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' +
    "</button>" +
    '<a href="' +
    (IS_INDEX ? "#" : "index.html#") +
    'cloud-drives" class="btn btn-primary">免费下载</a>' +
    "</div>" +
    "</div>" +
    "</nav>";

  // ============ 共享页脚 ============
  var FOOTER_HTML =
    '<footer id="about">' +
    '<div class="footer-inner">' +
    '<div class="footer-row">' +
    '<div class="footer-row-left">' +
    '<a href="index.html" class="footer-logo">' +
    '<img src="images/logo.png" alt="ClassNode" class="footer-logo-img">' +
    '<span class="footer-logo-txt">ClassNode</span>' +
    "</a>" +
    '<span class="footer-logo-sub">AI 互动课堂系统</span>' +
    "</div>" +
    '<div class="footer-row-right"></div>' +
    "</div>" +
    '<div class="footer-hr"></div>' +
    '<div class="footer-row footer-row-copy">' +
    '<span class="footer-copy">© 2026 ClassNode · AI 赋能教育 · 教学互促共研</span>' +
    '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" class="footer-icp">' +
    '<svg class="icp-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>' +
    "浙ICP备2026044424号-1</a>" +
    "</div>" +
    "</div>" +
    "</footer>";

  // ============ 注入组件 ============
  var headerEl = document.querySelector('[data-include="header"]');
  var footerEl = document.querySelector('[data-include="footer"]');

  if (headerEl) {
    headerEl.innerHTML = NAV_HTML;
    // 设置当前页高亮
    var page = headerEl.dataset.page;
    if (page) {
      var links = headerEl.querySelectorAll(".nav-menu a");
      var pageMap = {
        index: "index.html",
        deploy: "deploy.html",
        download: IS_INDEX ? "#cloud-drives" : "index.html#cloud-drives",
      };
      var targetHref = pageMap[page];
      links.forEach(function (lnk) {
        if (lnk.getAttribute("href") === targetHref) {
          lnk.style.color = "var(--text-primary)";
        }
      });
    }
  }

  if (footerEl) {
    footerEl.innerHTML = FOOTER_HTML;
  }
})();
