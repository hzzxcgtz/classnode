import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const nodeVersion = process.env.CLASSNODE_NODE_VERSION || '24.18.0';

export function requireRuntime() {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error(`需要 Node.js >= 24，当前为 ${process.version}`);
  }
}

export function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    // npm/pnpm 的 Windows .cmd 入口需要由 cmd.exe 解析。
    shell: process.platform === 'win32' && ['npm', 'pnpm', 'npx'].includes(command),
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败（${result.signal || result.status}）`);
}
