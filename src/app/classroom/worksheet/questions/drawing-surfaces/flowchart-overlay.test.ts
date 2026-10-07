/**
 * 画布上的**浮层与拖拽交互**判据 —— 删除按钮（位置/形状/大小）、以及拖完框之后的同列吸附。
 * （★ 2026-10-06 / 2026-10-07 教师）
 *
 * ⚠️ 本仓没有 jsdom ⇒ 组件里的东西只能**源码级**判据（读文件文本 + 切片）。
 *    每条否定断言都配长度断言：切片切空了也会「全绿」，那是假绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');
const CSS = fs.readFileSync(path.resolve(HERE, '..', '..', 'worksheet.module.css'), 'utf8');

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const at = source.indexOf(startMarker);
  if (at === -1) return '';
  const end = source.indexOf(endMarker, at + startMarker.length);
  return end === -1 ? '' : source.slice(at, end);
}

/*
  ★ 2026-10-06（**教师改主意了**）：「可以换成一个小叉叉图标，然后**压在靠近起点的线上**」。

  ⊘ 这推翻了上一版那条规矩（原话是「删除图标移到这条连线的**终点**」，动机是别和就地输入框
    一起压在中点、把线上的字糊住）。教师现在要求挪到**起点那一侧**，而且要**压在线上**
    （上一版还刻意向侧边让开 34px 躲线 —— 那条也一并撤了）。
  🔴 与 `edgeMidAnchor`（就地输入框，仍在中点）**仍然是两个锚点**，别合并。
*/
test('线上那个删除按钮压在**靠起点**的线上 —— 推翻了「用终点锚点」那条旧规矩', () => {
  assert.match(SOURCE, /const edgeStartAnchor = /, '锚点函数还没改成起点侧（应该叫 edgeStartAnchor）');
  assert.ok(
    !/edgeEndAnchor/.test(SOURCE),
    '旧的 `edgeEndAnchor` 还留着 —— 改名的意义就是让「锚点在哪一侧」这件事一眼可见',
  );
  const block = blockBetween(SOURCE, 'const edgeStartAnchor = ', '\n  };');
  assert.ok(block.length > 200, `切片太短（${block.length}），判据可能在空串上假绿`);
  assert.match(block, /fromX/, '要用**起点**的坐标（`fromX`/`fromY`）');
  assert.ok(!/endX \+ /.test(block), '不许再从终点算 —— 那还是旧的锚点');
});

test('起点锚点沿**首段方向**走（不是「起点→终点」直线近似），才真的压在线上', () => {
  const block = blockBetween(SOURCE, 'const edgeStartAnchor = ', '\n  };');
  assert.ok(block.length > 200, `切片太短（${block.length}）`);
  assert.match(block, /outX|outY/, '要按起点句柄轴的外法线走 —— smoothstep 的首段一定沿它出来');
});

test('删除图标是一个小叉叉（不再是垃圾桶）', () => {
  const icons = blockBetween(SOURCE, 'const FLOW_ICONS', '};');
  assert.ok(icons.length > 200, '`FLOW_ICONS` 没抠出来 —— 先修这条判据');
  assert.ok(!/trash:/.test(icons.split('close:')[1] ?? icons) || /close:/.test(icons),
    '图标表里没有那个叉叉');
  // 渲染处引的是叉叉那一个键，不再是垃圾桶。
  // ⚠️ 锚点用**类名**，不用 `aria-label` —— 那个是 `{overlay.label}`（变量，不是字面量）。
  const render = blockBetween(SOURCE, 'className={styles.flowEdgeFloat}', '</button>');
  assert.ok(render.length > 50, '删除按钮那段没抠出来 —— 先修这条判据');
  assert.ok(!/FLOW_ICONS\.trash/.test(render), '删除按钮还在用垃圾桶图标');
});

/*
  ★ 2026-10-06（教师）：「出现的删除图标**太大**」。

  🔴 44px 是**命中区**（老 iPad 的手指下限），而且 `worksheet-tap-targets.test.ts` 会逐个量
     —— **不能缩**。能缩的只有**看得见的那个东西**：
     命中区保持 44×44，里面套一个 ~24px 的小白圆。
*/
/*
  ★ 2026-10-07（教师）：「在移动某个图形时，**连接线接近直线时需要吸附成直线**，
  否则可能会出现一个非常小的拐角，很难看」。

  几何与判据在 `alignSnapX`（`@/lib/worksheet-flowchart-layout.ts`，有单元测试）；
  这条判据只钉**接线**：它必须挂在拖动**结束**那一下，而且 `<ReactFlow>` 真的接了这个钩子。
  ⚠️ 少任何一环，那套几何就是死代码 —— 「接近直线时吸齐」永远不会发生。
*/
test('同列吸附接在拖动结束那一下，且 ReactFlow 真的挂了这个钩子', () => {
  assert.match(SOURCE, /alignSnapX\(current, edges, node\.id\)/, '要算吸附（用**函数式**的 current，别用闭包里的旧 nodes）');
  assert.match(SOURCE, /onNodeDragStop=\{disabled \? undefined : \(_, node\) =>/, '`<ReactFlow>` 上没有接拖动结束这个钩子');
});

test('可见体缩到 24px 左右，但命中区仍是 44px —— 摸得到的范围不变', () => {
  const hit = blockBetween(CSS, '.flowEdgeFloat {', '}');
  assert.ok(hit.length > 100, '`.flowEdgeFloat` 那条规则没抠出来 —— 先修这条判据');
  assert.match(hit, /width:\s*44px/, '命中区必须还是 44px（老 iPad 的手指下限，缩了学生点不到）');
  assert.match(hit, /height:\s*44px/, '同上');
  assert.ok(
    !/background:\s*#fff/.test(hit),
    '按钮本体还有白底 —— 那正是「看起来太大」的来源（44px 的白方块）；白底该挪到里面那个小圆上',
  );
  const inner = blockBetween(CSS, '.flowEdgeFloat > svg', '}');
  assert.ok(inner.length > 50, '找不到里面那个小圆（`.flowEdgeFloat > svg`）—— 先修这条判据');
  const size = Number((inner.match(/[^-]width:\s*(\d+)px/) ?? [])[1]);
  assert.ok(Number.isFinite(size) && size > 0, `读不到小圆的尺寸（读到 ${size}）`);
  assert.ok(size <= 28, `小圆还是太大（${size}px）—— 教师说「太大」`);
  assert.ok(size >= 20, `小圆太小了（${size}px）—— 触摸目标虽在，但图标会看不清`);
  assert.match(inner, /border-radius:\s*50%/, '里面那个应该是圆的');
  assert.match(inner, /background:\s*#fff/, '小圆要有白底（画布是浅色的，纯图标看不清）');
});
