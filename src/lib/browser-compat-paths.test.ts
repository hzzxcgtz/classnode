import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = fs.readFileSync(path.join(root, 'scripts/check-classroom-browser-compat.mjs'), 'utf8');
// Execute the real scanner with Windows path semantics, without requiring out/.
const scanner = script.slice(script.indexOf('// ==='), script.indexOf('const bundle = checkBundleLookbehinds();'));

function scan(change = ''): { failures: string[]; fileCount: number } {
  const native = (file: string) => file.replace(/\\/g, '/');
  const context = vm.createContext({
    root,
    path: path.win32,
    fs: {
      existsSync: (file: string) => fs.existsSync(native(file)),
      statSync: (file: string) => fs.statSync(native(file)),
      readdirSync: (file: string) => fs.readdirSync(native(file), { withFileTypes: true }),
      readFileSync: (file: string) => fs.readFileSync(native(file), 'utf8'),
    },
  });
  return JSON.parse(vm.runInContext(`${scanner}\n${change}\nJSON.stringify(checkSourceTokens())`, context));
}

test('Windows source scan recognizes existing CSS exemptions', () => {
  const result = scan();
  assert.ok(result.fileCount > 100);
  assert.deepEqual(result.failures, []);
});

test('Windows source scan still rejects stale exemption paths', () => {
  const result = scan("ALLOWED['src/app/classroom/missing.css'] = { dvh: 1 };");
  assert.ok(result.failures.includes('豁免表引用了不存在的文件: src/app/classroom/missing.css'));
});

test('Windows source scan still enforces CSS exemption budgets', () => {
  const result = scan("ALLOWED['src/app/classroom/chat/chat.module.css'].dvh = 0;");
  assert.ok(result.failures.some(failure => failure.includes('chat.module.css: dvh') && failure.includes('超出豁免额度')));
});
