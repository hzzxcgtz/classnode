/**
 * 看板那一格里的**预览要装得下整张图**（★ 2026-10-07 教师两次提到）。
 *
 * 第一次：「学生在画流程图的时候，能够**一眼看到完整的图**，也就是说可以缩放一下，
 * 不要使用滚动条了」；第二次（截图）：图还是**下半张不见了**。
 *
 * 🔴 第二遍之所以没生效，是因为**高度链断在中间**：
 *   `tile-answer.tsx` 里绘图那一支的外框原来是**普通块级元素**（没有 `display: flex`），
 *   而里面 `InkPreview` 的外框靠 `flex: 1` 撑满 —— `flex` 只在 flex 容器里起作用 ⇒
 *   外框高度退化成「内容高度」⇒ 图里那句 `max-height: 100%` 没有百分比基准（= `none`）
 *   ⇒ 图按宽度铺满、高的部分被 `overflow: hidden` **裁掉**。
 * ⇒ 这一条判据就是那次返工的代价：**布局改动也要有网**，否则「改了但没生效」只能靠人眼发现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (relative: string) => stripComments(fs.readFileSync(path.resolve(HERE, relative), 'utf8'));

/** 绘图那一支的容器（`case 'ink'` 到下一个 case 之间）。 */
const inkCase = (() => {
  const body = read('tile-answer.tsx');
  const at = body.indexOf("case 'ink'");
  assert.notEqual(at, -1, "`case 'ink'` 没找到 —— 先修这条判据");
  const end = body.indexOf("case 'photo'", at);
  assert.notEqual(end, -1, '这一支的结尾没找到 —— 先修这条判据');
  return body.slice(at, end);
})();

test('★ 绘图那一支的容器必须是 **flex 容器**（否则填满高度那句是死的，图会被裁掉）', () => {
  assert.ok(inkCase.length > 120, `那一支没抠出来（${inkCase.length}）—— 先修这条判据，别让它在空串上全绿`);
  assert.match(inkCase, /flex: 1, minHeight: 0, display: 'flex'/, "容器不是 flex —— 里面那句 `flex: 1` 不起作用，图按内容高度铺开后被裁掉");
});

test('★ 回答体给绘图那一支**确定的高度**，其他题型照旧「长就滚」', () => {
  const body = read('tile-answer.tsx');
  assert.match(body, /const fill = view\.kind === 'ink';/, '没有区分「绘图 / 其他」两种高度行为');
  assert.match(body, /fill \? \{ flex: 1, minHeight: 0 \} : \{ flexShrink: 0 \}/, '绘图要填满、其他题型要能滚 —— 这一句把两者分开');
});

test('★ 图自己不许超过框（快照 <img> 与四个近似渲染都要有这条）', () => {
  const preview = read('drawing-document-preview.tsx');
  assert.match(preview, /const SVG_STYLE = \{[^}]*maxHeight: '100%'/, '四个近似渲染的 SVG 没有高度上限 —— 图一高就溢出');
  assert.match(preview, /maxHeight: '100%', objectFit: 'contain'/, '快照那张 <img> 没有高度上限 / 不是等比缩放');
  const ink = read('ink-preview.tsx');
  assert.match(ink, /height="100%"/, '手写那一支的 SVG 没有跟着框缩放');
});
