import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { root, requireRuntime } from './lib/project.mjs';

requireRuntime();
const require = createRequire(path.join(root, 'server/package.json'));
const child = spawn(process.execPath, [require.resolve('tsx/cli'), 'watch', 'src/index.ts'], {
  cwd: path.join(root, 'server'),
  env: { ...process.env, NODE_ENV: 'development' },
  stdio: 'inherit',
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
