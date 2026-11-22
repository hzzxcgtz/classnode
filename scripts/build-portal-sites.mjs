import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'myportal');
const output = path.join(root, 'dist/portal');
const workshop = path.join(output, 'workshop');
const product = path.join(output, 'classnode');
const productOrigin = 'https://zd.aicls.xyz';
const productStyles = read('css/classnode-site.css');
const productStyleHash = createHash('sha256').update(productStyles).digest('hex').slice(0, 12);
const productStylePath = `css/classnode-site.${productStyleHash}.css`;
const sharedAssets = new Map([
  ['images/classnode-doctor.png', path.join(root, 'public/worksheet-rewards/classnode-doctor.png')],
]);
const productPaths = new Map([
  ['classnode.html', '/'],
  ['guide.html', '/guide.html'],
  ['deploy.html', '/deploy.html'],
]);
const guidePages = readdirSync(path.join(source, 'guide'))
  .filter(name => name.endsWith('.html'))
  .map(name => `guide/${name}`);

function read(file) {
  return readFileSync(path.join(source, file), 'utf8');
}

function write(site, file, content) {
  const target = path.join(site, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function copy(site, file) {
  const target = path.join(site, file);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(sharedAssets.get(file) ?? path.join(source, file), target, { recursive: true });
}

function copyPageImages(site, html) {
  // Include screenshots, GIFs and image links used by the output pages.
  for (const match of html.matchAll(/(?:href|src)="(images\/[^"#?]+)"/g)) {
    copy(site, match[1]);
  }
}

function redirect(site, file, destination) {
  write(site, file, `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${destination}">
<title>支点课堂已迁移</title>
<script>
  location.replace(${JSON.stringify(destination)} + location.search + location.hash);
</script>
<noscript><meta http-equiv="refresh" content="0; url=${destination}"></noscript>
</head>
<body><p>支点课堂已迁移。<a href="${destination}">打开新地址</a></p></body>
</html>
`);
}

function workshopLinks(content) {
  return content.replace(/(classnode|guide|deploy)\.html/g, file => productOrigin + productPaths.get(file));
}

function productPage(file, target) {
  const styles = target === '404.html' ? '<base href="/">\n' : '';
  const canonical = target === 'index.html' ? '/' : `/${target}`;
  const guideStyle = ['classnode.html', 'deploy.html', 'classnode-404.html', 'about.html'].includes(file)
    ? '<link rel="stylesheet" href="css/guide.css">\n' : '';
  const canonicalLink = target === '404.html' ? '' : `<link rel="canonical" href="${productOrigin}${canonical}">\n`;
  return read(file)
    .replace(/<body(?: class="([^"]*)")?>/, (_, classes) => `<body class="${classes ? classes + ' ' : ''}classnode-site">`)
    .replace('<head>', `<head>\n${styles}`)
    .replace(/<link rel="icon"[^\n]*\n/, '')
    .replace('</head>', `${canonicalLink}${guideStyle}<link rel="icon" href="images/classnode-logo.png" type="image/png">\n<link rel="stylesheet" href="${productStylePath}">\n</head>`)
    .replaceAll('js/include.js', 'js/classnode-include.js')
    .replaceAll('classnode.html', 'index.html');
}

for (const site of [workshop, product]) {
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  for (const file of ['css/style.css', 'css/guide.css', 'js/script.js']) copy(site, file);
}

for (const file of ['index.html', '404.html']) {
  const html = workshopLinks(read(file));
  write(workshop, file, html);
  copyPageImages(workshop, html);
}
write(workshop, 'js/include.js', workshopLinks(read('js/include.js')));
copy(workshop, 'prompt-templates');

for (const file of ['classnode.html', 'guide.html', 'deploy.html', ...guidePages]) {
  const target = file === 'classnode.html' ? 'index.html' : file;
  const html = productPage(file, target);
  write(product, target, html);
  copyPageImages(product, read(file));
  redirect(workshop, file, productOrigin + (productPaths.get(file) ?? `/${file}`));
}
write(product, 'about.html', productPage('about.html', 'about.html'));
write(product, productStylePath, productStyles);
for (const file of ['js/classnode-include.js', 'js/classnode-home.js', 'js/guide.js']) copy(product, file);

write(product, '404.html', productPage('classnode-404.html', '404.html'));
copyPageImages(product, read('about.html'));
cpSync(path.join(root, 'src-tauri/icons/128x128.png'), path.join(product, 'images/classnode-logo.png'));
redirect(product, 'classnode.html', productOrigin + '/');

console.log('编程研习工坊 → dist/portal/workshop/');
console.log('支点课堂 → dist/portal/classnode/');
