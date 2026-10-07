/**
 * ★ 2026-10-07（教师）：「学生用鼠标点击思维导图的**空白区域**，应该能够取消所有节点的选择状态」。
 *
 * 🔴 为什么必须自己补：空白处的**左键**是我们在**捕获阶段**接管的（平移画布 —— 教师
 *   2026-10-06 要的「和流程图一样，空白处可以移动整个画布」）⇒ 库自己那套
 *   「点空白 = 取消选中」`stopPropagation` 之后**没机会跑**。
 * ⚠️ 但只在**没拖动**时补：平移画布不该顺手把学生的选中弄丢（那是两件事）。
 * ⇒ 于是这里要有一条判据回答「这一串指针事件算点击还是拖动」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mindmapDragStarted } from './worksheet-mindmap-pan.ts';

const START = { x: 100, y: 200 };

test('★ 原地按下抬起（含手抖几像素）⇒ 算**点击**', () => {
  assert.equal(mindmapDragStarted(START, { x: 100, y: 200 }), false);
  assert.equal(mindmapDragStarted(START, { x: 102, y: 201 }), false, '手抖 3 像素以内仍算点击 —— 老人手/触控板很容易抖');
});

test('★ 真的拖了 ⇒ 算**拖动**（那时不许取消选中）', () => {
  assert.equal(mindmapDragStarted(START, { x: 140, y: 200 }), true);
  assert.equal(mindmapDragStarted(START, { x: 100, y: 260 }), true);
  assert.equal(mindmapDragStarted(START, { x: 60, y: 140 }), true, '反方向同样是拖动');
});

test('阈值是**位移的大小**，不是某个方向上的差（斜着拖 3+3 也该算拖动）', () => {
  assert.equal(mindmapDragStarted(START, { x: 104, y: 204 }), true, '斜着拖 8 像素是拖动，不是点击');
});
