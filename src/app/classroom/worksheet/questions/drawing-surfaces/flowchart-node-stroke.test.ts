/**
 * 节点形状的**描边粗细**：菱形必须跟其它形状一样（★ 2026-10-06 教师批图）。
 *
 * 🔴 教师原话（图上批注）：「**菱形的框太粗了，要跟其它图形一样。**」
 *
 * 根因：其它形状的描边是 CSS 里的 `border`，而菱形是**画出来的** SVG —— 它的
 * `strokeWidth` 被单独写成了 `3`，正好是 CSS 那 1.5 的两倍。分叉还不止这一处：
 * **选中时**两边也走两套路 —— 矩形只换边框颜色，菱形却把描边加粗到 3。
 *
 * ⚠️ 本仓没有 jsdom ⇒ 这一条是**源码级**的网（读 CSS 与 TSX 的文本对拍）。
 *    它挡的是「又有一边被单独改粗」，挡不住「渲染出来其实不一样」。
 * 🔴 两个值都**从文本里现读**再比，谁也不许写死 —— 写死 1.5 的话，将来整体调粗细时
 *    这条判据会**假绿**（它比的就成了「1.5 是不是 1.5」）。
 * ⚠️ 快照 `worksheet-flowchart-svg.ts` **不在**这条判据里：那边所有形状共用同一个
 *    `stroke-width` 常量，本来就齐（它画的是另一张图，不是屏幕）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');
const CSS = fs.readFileSync(path.resolve(HERE, '..', '..', 'worksheet.module.css'), 'utf8');

/** 其它形状的描边粗细 —— 唯一真源是 CSS 的 `.flowNode` 那条规则。 */
function baseBorderWidth(): string {
  const block = /\.flowNode\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(block, '找不到 `.flowNode` 那条 CSS 规则（样式表改结构了？）');
  const width = /border:\s*([\d.]+)px/.exec(block[1]);
  assert.ok(width, '`.flowNode` 里没写 border 宽度 —— 判据无源可比');
  return width[1];
}

/** 菱形那个 polygon（它是 `FlowNodeEditor` 里唯一一个 points 以 `50,` 开头的多边形）。 */
function diamondPolygon(): string {
  const at = TSX.indexOf('points="50,');
  assert.ok(at > 0, '找不到菱形 polygon —— 形状改画法了？');
  const end = TSX.indexOf('/>', at);
  return TSX.slice(at, end === -1 ? at + 300 : end);
}

test('菱形的描边与其它形状一样粗', () => {
  const stroke = /strokeWidth="([\d.]+)"/.exec(diamondPolygon());
  assert.ok(stroke, '菱形的 polygon 上没有 strokeWidth');
  assert.equal(
    stroke[1],
    baseBorderWidth(),
    '菱形是画出来的 SVG、其它是 CSS border，两处写死了不同的数 ⇒ 眼睛看得出的粗细差。'
      + '教师 2026-10-06 报过一次：「菱形的框太粗了，要跟其它图形一样。」',
  );
});

test('菱形选中时只换颜色，不加粗 —— 与其它形状同一套', () => {
  // ⚠️ 只认「命中 polygon」的那条规则：`.flowNode_decision[data-selected='1'] { … }` 本身
  //    不含 stroke-width，混进来会假绿。
  const rule = /\.flowNode_decision\[data-selected='1'\][^{]*\.flowNodeShape[^{]*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, '找不到「菱形选中」那条 CSS 规则');
  assert.ok(
    !/stroke-width/.test(rule[1]),
    '其它形状选中只换边框颜色（`.flowNode[data-selected=\'1\']` 里没有 border-width）⇒'
      + ' 菱形也不许在选中时加粗，否则一选中就比旁边粗一圈。',
  );
});
