// Simple static file server for Next.js static export
// No external dependencies - uses only Node.js built-in modules
// Handles extensionless URLs like /teacher -> /teacher.html

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT || process.env.BACKEND_PORT || '3001';
const ROOT = path.resolve(__dirname, 'out');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.txt':  'text/plain',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

function serveRawContent(res, content, contentType) {
  var headers = { 'Content-Type': contentType };
  headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
  headers['Pragma'] = 'no-cache';
  headers['Expires'] = '0';
  res.writeHead(200, headers);
  res.end(content);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath) || '.html';
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  let content = fs.readFileSync(filePath);

  var headers = { 'Content-Type': contentType };

  // HTML 页面禁止缓存，避免返回按钮读到旧版本
  if (contentType.includes('text/html')) {
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
    headers['Pragma'] = 'no-cache';
    headers['Expires'] = '0';
  }

  // 注入错误捕获脚本到 Next.js 页面（跳过独立 HTML）
  if (contentType.includes('text/html') && filePath.indexOf('standalone') < 0) {
    var errCapture = '<script>' +
    'window.onerror=function(m,s,l,c,e){' +
    'var d=document.createElement("div");' +
    'd.style.cssText="position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1e293b;color:#f87171;padding:12px 16px;font-size:13px;font-family:monospace;border-top:3px solid #ef4444;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all";' +
    'd.textContent="[JS Error] " + m + " at " + s + ":" + l;' +
    'document.body.appendChild(d);' +
    '};' +
    'window.addEventListener("unhandledrejection",function(e){' +
    'var d=document.createElement("div");' +
    'd.style.cssText="position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1e293b;color:#fbbf24;padding:12px 16px;font-size:13px;font-family:monospace;border-top:3px solid #f59e0b;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all";' +
    'd.textContent="[Promise Error] " + (e.reason && e.reason.message ? e.reason.message : String(e.reason || "unknown"));' +
    'document.body.appendChild(d);' +
    '});' +
    '</script>';
    content = Buffer.from(content.toString().replace('</body>', errCapture + '</body>'));
  }

  // 对 classroom 页面注入水合失败回退脚本（跳过独立 HTML 页面，避免语法冲突）
  if (contentType.includes('text/html') && filePath.indexOf('classroom') >= 0 && filePath.indexOf('standalone') < 0) {
    var fallback = '<script>' +
    '(function(){' +
    'var t=setTimeout(function(){' +
    'var els=document.querySelectorAll("body *");' +
    'for(var i=0;i<els.length;i++){' +
    'if(els[i].textContent&&els[i].textContent.indexOf("正在连接课堂")>=0&&els[i].offsetHeight>0){' +
    'var fb=document.createElement("div");' +
    'fb.style.cssText="position:fixed;inset:0;z-index:9999;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:-apple-system,sans-serif;padding:24px;text-align:center";' +
    'fb.innerHTML=\'<div style="font-size:48px;margin-bottom:16px">\\u26A0\\uFE0F</div><h2 style="margin:0 0 8px;font-size:22px;font-weight:700">\\u9875\\u9762\\u52A0\\u8F7D\\u5931\\u8D25</h2><p style="margin:0 0 24px;font-size:15px;opacity:0.8">\\u6D4F\\u89C8\\u5668\\u53EF\\u80FD\\u4E0D\\u652F\\u6301\\u5F53\\u524D\\u9875\\u9762\\uFF0C\\u8BF7\\u5C1D\\u8BD5\\u5237\\u65B0</p><button onclick="location.reload()" style="display:block;width:200px;margin:0 auto 10px;padding:12px 0;border-radius:10px;border:none;background:white;color:#667eea;font-size:16px;font-weight:600;cursor:pointer">\\u5237\\u65B0\\u9875\\u9762</button><a href=\'/"\' style=\'display:block;margin-top:16px;color:rgba(255,255,255,0.6);font-size:13px\'>\\u8FD4\\u56DE\\u9996\\u9875</a>\';' +
    'document.body.appendChild(fb);' +
    'break;}}},8e3);})();' +
    '</script>';
    content = Buffer.from(content.toString().replace('</body>', fallback + '</body>'));
  }

  res.writeHead(200, headers);
  res.end(content);
}

function send404(res) {
  const filePath = path.join(ROOT, '404.html');
  if (fs.existsSync(filePath)) {
    serveFile(res, filePath);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}

const server = http.createServer((req, res) => {
  try {
    let url = req.url.split('?')[0].split('#')[0];

    // 首页优先使用独立 HTML 页面（不依赖 Next.js 水合，兼容 iPad Safari）
    if (url === '/' || url === '/index') {
      const standalone = path.join(__dirname, 'standalone-homepage.html');
      if (fs.existsSync(standalone)) {
        serveFile(res, standalone);
        return;
      }
    }

    // 教师登录页同样使用独立页面
    if (url === '/teacher') {
      const standalone = path.join(__dirname, 'standalone-teacher.html');
      if (fs.existsSync(standalone)) {
        if (BACKEND_PORT !== '3001') {
          let content = fs.readFileSync(standalone, 'utf8');
          content = content.replace('var BACKEND_PORT = 3001;', `var BACKEND_PORT = ${BACKEND_PORT};`);
          serveRawContent(res, content, 'text/html; charset=utf-8');
        } else {
          serveFile(res, standalone);
        }
        return;
      }
    }

    // 课堂页面同样使用独立 HTML（避免 Next.js 水合失败）
    if (url === '/classroom') {
      const standalone = path.join(__dirname, 'standalone-classroom.html');
      if (fs.existsSync(standalone)) {
        if (BACKEND_PORT !== '3001') {
          let content = fs.readFileSync(standalone, 'utf8');
          content = content.replace('var API_PORT = 3001;', 'var API_PORT = ' + BACKEND_PORT + ';');
          serveRawContent(res, content, 'text/html; charset=utf-8');
        } else {
          serveFile(res, standalone);
        }
        return;
      }
    }

    // Default to /index
    if (url === '/') url = '/index';

    // Remove trailing slash if present (we'll try with .html)
    if (url.endsWith('/') && url !== '/') url = url.slice(0, -1);

    // Try different file resolutions in order
    const candidates = [
      path.join(ROOT, url),                // /teacher -> out/teacher (file)
      path.join(ROOT, url + '.html'),       // /teacher -> out/teacher.html
      path.join(ROOT, url, 'index.html'),   // /teacher -> out/teacher/index.html
    ];

    let found = false;
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        serveFile(res, candidate);
        found = true;
        break;
      }
    }

    if (!found) {
      // SPA fallback: serve index.html for client-side routing
      const indexFile = path.join(ROOT, 'index.html');
      if (fs.existsSync(indexFile)) {
        serveFile(res, indexFile);
      } else {
        send404(res);
      }
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend server running at http://localhost:${PORT}`);
});
