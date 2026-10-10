import { spawn } from 'node:child_process';
import { createWriteStream, globSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRuntime } from './lib/project.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suite = process.argv[2];
if (!['client', 'server', 'scripts'].includes(suite)) {
  throw new Error('Usage: node scripts/run-tests.mjs client|server|scripts [Node test options]');
}
requireRuntime();

const patterns = { client: 'src/**/*.test.ts', server: 'dist/tests/*.test.js', scripts: 'scripts/tests/*.test.mjs' };
const cwd = suite === 'server' ? path.join(project, 'server') : project;
if (globSync(patterns[suite], { cwd }).length === 0) throw new Error(`未找到测试文件: ${patterns[suite]}`);
const logDirectory = path.join(project, '.dev/logs');
mkdirSync(logDirectory, { recursive: true });
const log = createWriteStream(path.join(logDirectory, `test-${suite}.log`));
const child = spawn(process.execPath, ['--test', '--test-timeout=600000', ...process.argv.slice(3), patterns[suite]], {
  cwd,
  stdio: ['inherit', 'pipe', 'pipe'],
});
child.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
child.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
log.on('error', error => { console.error(error); child.kill(); process.exitCode = 1; });
child.on('error', error => { console.error(error); process.exitCode = 1; log.end(); });
child.on('close', code => { process.exitCode ||= code ?? 1; log.end(); });
