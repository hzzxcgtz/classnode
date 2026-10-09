import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suite = process.argv[2];
if (!['client', 'server'].includes(suite)) {
  throw new Error('Usage: node scripts/run-tests.mjs client|server');
}

const log = createWriteStream(path.join(project, `.test-${suite}.log`));
const child = spawn(process.execPath, ['--test', '--test-timeout=600000', suite === 'client' ? 'src/**/*.test.ts' : 'dist/tests/*.test.js'], {
  cwd: suite === 'client' ? project : path.join(project, 'server'),
  stdio: ['inherit', 'pipe', 'pipe'],
});
child.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
child.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
log.on('error', error => { console.error(error); child.kill(); process.exitCode = 1; });
child.on('error', error => { console.error(error); process.exitCode = 1; log.end(); });
child.on('close', code => { process.exitCode ||= code ?? 1; log.end(); });
