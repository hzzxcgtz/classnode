/**
 * 老 iPad 兜底的**接线条**网：兜底写了、装上了、而且闸门认得它。
 *
 * 为什么这三件事都要钉：
 *   ① **写了**：`structuredClone` 在 Safari 15.0–15.3 上不存在（15.4 才有），而
 *      `@xyflow/react` 的 chunk 里有一处裸调（React Flow 的「点击连线」那条路）——
 *      光有源码还不够，见下一条；
 *   ② **装上了**：「定义了但没人 import」在本仓是一个**静默**故障的经典形状
 *      （与 `new-task-focus` 那条网同一个理由）：文件在那儿、函数导出得好好的，
 *      而学生端的产物里没有它 ⇒ 报错照旧。所以必须钉住**根布局真的渲染了它**；
 *   ③ **闸门认得它**：产物级扫描（`check-classroom-browser-compat.mjs` 的 Part A2）
 *      按**签名**判断「这一族有没有人兜」——签名与这份实现是**耦合**的，
 *      改一边忘另一边会让构建红在生产前一步（那是好事），但更早发现更好。
 *
 * ⚠️ 本仓没有 jsdom ⇒ 这里验不了「Safari 15 上真的不抛了」。真机走查仍在验收清单里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SHIM = fs.readFileSync(path.join(HERE, 'browser-compat-shims.tsx'), 'utf8');
const LAYOUT = fs.readFileSync(path.join(ROOT, 'src', 'app', 'layout.tsx'), 'utf8');
const GATE = fs.readFileSync(path.join(ROOT, 'scripts', 'check-classroom-browser-compat.mjs'), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('阳性对照：三个文件都读到了（否则下面几条会在空串上永远绿）', () => {
  assert.ok(stripComments(SHIM).length > 300, '兜底文件读到的内容太少');
  assert.ok(LAYOUT.includes('<BrowserCompatShims'), '根布局里没有这个组件');
  assert.ok(GATE.includes('BUNDLE_API_FAMILY'), '闸门里没有那一族标记');
});

test('① 兜底写了：只在缺的时候装，且不动已有的实现', () => {
  const live = stripComments(SHIM);
  // 🔴 判据必须是「缺才装」：无脑覆盖会在 Safari 15.4+ 上把原生实现换成一个 JSON 深拷贝，
  //    而那个替换**看不出来**（`structuredClone` 还在，只是 Date/Map 悄悄变成普通对象）。
  assert.match(live, /typeof globalThis\.structuredClone !== 'function'/, '没有「缺才装」的判据');
  assert.match(live, /globalThis\.structuredClone = function structuredClone/, '没有真的装上');
  assert.match(live, /if \(value === undefined\) return value;/, '`undefined` 那一处边界丢了（JSON 会抛）');
});

test('② 装上了：根布局必须渲染它（定义了没人 import 是本仓的经典静默故障）', () => {
  const live = stripComments(LAYOUT);
  assert.match(live, /import \{ BrowserCompatShims \} from ["']@\/components\/browser-compat-shims["']/, '根布局没有 import 它');
  assert.match(live, /<BrowserCompatShims \/>/, '根布局没有渲染它 —— 那么产物里就没有这份兜底');
});

test('③ 闸门认得它：签名必须能在兜底源码里命中（两边是耦合的）', () => {
  // 从闸门里抠出 `structuredClone` 那条的 shim 正则原文，再拿它去跑兜底源码。
  const entry = GATE.slice(GATE.indexOf("token: 'structuredClone'"));
  const match = /shim: (\/.*?\/),/.exec(entry.slice(0, 400));
  assert.ok(match, '闸门里 `structuredClone` 那条没有 shim 签名');
  const signature = new RegExp(match[1].slice(1, -1));
  assert.ok(
    signature.test(stripComments(SHIM)),
    `闸门的签名 ${match[1]} 在兜底源码里命中不了 —— 构建会因为产物里那几处裸用变红`,
  );
  // 反面对照：这条判据本身能红（拿一个不存在的签名去跑，必须 false）。
  assert.equal(/globalThis\.__nope__\s*=/.test(SHIM), false);
});
