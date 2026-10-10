// 兼容入口：请使用 pnpm package:web。
import { run, root } from './lib/project.mjs';
import path from 'node:path';
run(process.execPath, [path.join(root, 'scripts/package-frontend.mjs'), 'web']);
