import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * 供应商化的第三方产物（`server/vendor/`）的守门测试。
 *
 * ⚠️ **为什么需要这个文件：`check-classroom-browser-compat.mjs` 守不住 lookbehind。**
 * 那个闸门分两部分：
 *   · Part A（lookbehind）扫的是**构建产物 `out/`**；
 *   · Part B（九条标记）扫源码，但它的代码里明写「源码级不查 lookbehind，也无容忍概念」。
 * 而 `server/vendor/snapdom.js` **既不在 `out/` 里**（它由托管服务在运行期直接读文件发给
 * 浏览器，不经过我们的构建），**又是真正的执行代码** —— 它跑在学生的老 iPad 上。
 * ⇒ 它是那条 P0 红线**唯一没有自动化闸门覆盖**的文件。
 *
 * 这不是假想的洞：本文件就是**先手工量出 lookbehind = 0，才发现没有任何东西会阻止
 * 它变成 1**。手工量一次只对当下这一版成立，升级一次就作废。
 *
 * 供应商文件**换一次版本就要重新过一遍这些断言** —— 这正是我们要的：升级必须是有意识的。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/tests → ../../ = server/，与 webapp-host.ts 的 shotPath() 同源
const VENDOR_DIR = path.join(__dirname, '../../vendor');

function readVendor(name: string): string {
  return fs.readFileSync(path.join(VENDOR_DIR, name), 'utf8');
}

test('供应商目录里有 DOM 截图库，且不是空文件', () => {
  const source = readVendor('snapdom.js');
  assert.ok(source.length > 100_000, `文件太小，可能是占位或下载不全：${source.length} 字节`);
});

test('许可证文件在位（MIT 要求随产物保留）', () => {
  const license = readVendor('snapdom.LICENSE');
  assert.match(license, /MIT/i);
});

test('版本号与 README 里记的一致 —— 升级必须是有意识的', () => {
  // ⚠️ 换版本时这条会红，那是**故意的**：升级要连带重跑
  // `pnpm build`（兼容闸门）+ 全量测试 + 重新核对 server/vendor/README.md 里的
  // 静态兼容性表与 cache 实测。**不要顺手把这个数字改大。**
  const source = readVendor('snapdom.js');
  assert.match(source, /SnapDOM/, '文件里找不到 SnapDOM 标识');
  assert.match(source, /\bv3\.0\.0\b/, '版本不是 README 里记的 3.0.0');
});

test('🔴 P0 红线：不得含正则后行断言（lookbehind）', () => {
  // 学生端跑 Safari 15，而 lookbehind 是**解析期 SyntaxError** —— 整个文件一个字都不执行。
  // 这条没有任何别的闸门守着（见文件头注释）。
  const source = readVendor('snapdom.js');
  const hits = source.match(/\(\?<[=!]/g) ?? [];
  assert.equal(
    hits.length,
    0,
    `供应商库含 lookbehind ${hits.length} 处，会让 Safari 15 整份脚本解析失败：${hits.join(', ')}`,
  );
});

test('运行时方法：不得用 Safari 15 没有的那几个', () => {
  // 与 Part B 同一组标记，但这里守的是**供应商文件**（Part B 也扫它，两道独立）。
  // 这几个与 lookbehind 的差别是「调用到才炸」而不是「解析就炸」，但同样不能有。
  const source = readVendor('snapdom.js');
  for (const token of ['Object.hasOwn', 'structuredClone', 'findLast', '.at(']) {
    // `Object.prototype.hasOwnProperty.call` 是允许的（Safari 15 支持），
    // 所以判据是 `Object.hasOwn` 整串，而不是裸 `hasOwn`。
    assert.equal(source.includes(token), false, `供应商库含 ${token}`);
  }
});

test('供应商文件必须真的落在打包复制清单的目录里', () => {
  // 这条守的是「dev 正常、安装包静默缺文件」那个失败模式：
  // package-server.mjs 只复制它点名的那几个目录，漏一行就只在打包版炸。
  const packaging = fs.readFileSync(path.join(__dirname, '../../../scripts/package-server.mjs'), 'utf8');
  assert.match(
    packaging,
    /copy\(\s*'server\/vendor'/,
    'package-server.mjs 没有复制 server/vendor —— 打包版的学生端会静默没有缩略图',
  );
});

// ---------------------------------------------------------------------------
// 本地补丁（见 server/vendor/README.md 的「本地补丁」一节）
//
// 🔴 这一组守的是「升级时把补丁丢掉」——那是最阴的一种退化：
// 上游文件换新、版本号与上面那条断言都对得上、所有静态检查全绿，
// **只有老 iPad 又拍不出图了**，而且和没打补丁时一模一样地静默。
// ---------------------------------------------------------------------------

test('🔴 本地补丁：5 处裸奔的 img.decode() 都已补上兜底', () => {
  const source = readVendor('snapdom.js');
  // 上游这个文件里有 10 处 decode()，其中 5 处没有兜底（第 5 处藏在辅助函数 Aa 的
  // 函数体里，形状与另外四处不同 —— 只按 `await X.decode()` 找会漏掉它）。
  // 补丁把它们换成 `X.decode().catch(function(){...})`。数量写死成 5：
  // 上游一旦多出（或少掉）一处裸奔的 decode，这里会红 —— 那正是要人去看一眼的时机。
  const patched = (source.match(/decode\(\)\.catch\(function/g) ?? []).length;
  assert.equal(
    patched, 5,
    `本地补丁的 5 处 decode() 兜底只剩 ${patched} 处 —— 升级时补丁丢了。`
    + '见 server/vendor/README.md 的「本地补丁」，重新打上再更新这里的数字。',
  );
});

test('🔴 本地补丁：兜底里必须有 `X.complete` 那条短路', () => {
  const source = readVendor('snapdom.js');
  // 少了它，一个**已经失败**的图片会永远不 settle（onload/onerror 都不会再触发）——
  // 症状从「报 EncodingError」变成「看门狗超时」，更难查。所以单独钉一下。
  const shorts = (source.match(/if\([a-z]\.complete\)return [a-z]\.naturalWidth\?a\(\):b\(\)/g) ?? []).length;
  assert.equal(
    shorts, 5,
    `decode() 兜底里的 complete 短路只剩 ${shorts} 处（应为 5）——`
    + '退回的 onload 路径遇到「已经失败的图」会永不 settle',
  );
});

test('本地补丁：补丁后的 sha256 与 README 记的一致', () => {
  const expected = '9527e88f62de227a34e3d83c342006d19b857477a9063681f5be10014bbf29e0';
  const actual = createHash('sha256').update(fs.readFileSync(path.join(VENDOR_DIR, 'snapdom.js'))).digest('hex');
  assert.equal(
    actual, expected,
    '供应商文件的 sha256 变了 —— 要么是重打了补丁（那就更新 README 与这里的值），'
    + '要么是换了上游版本（那要重跑 server/vendor/README.md 里列的全部核对）',
  );
  const readme = readVendor('README.md');
  assert.ok(readme.includes(expected), 'README 里没有记录补丁后的 sha256 —— 下次升级就无从比对');
  assert.ok(
    readme.includes('ba55f81bc40aec7b624b76f13b484e222b3d364e40033643577c2e0930f62c70'),
    'README 里没有记录补丁前的上游 sha256 —— 那样无法证明补丁是打在正版上的',
  );
});
