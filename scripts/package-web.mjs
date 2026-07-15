import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'out');
const destination = path.join(root, 'server', 'frontend');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error('out/index.html 不存在，请先执行 pnpm build');
}

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
console.log('[package-web] out/ → server/frontend/');
