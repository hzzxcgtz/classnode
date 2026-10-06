/**
 * 撤销/重做的**接线**判据（★ 2026-10-06）。
 *
 * ⚠️ 本仓没有 jsdom ⇒ 组件里的行为只能用**源码级**判据（读文件文本 + 切片）。
 *    它挡的是「接线又断了一处」这类形态，挡不住时序问题 —— 时序只能靠真机。
 * ⚠️ 每条否定断言都配长度断言：切片切空了也会「全绿」，那是假绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const at = source.indexOf(startMarker);
  if (at === -1) return '';
  const end = source.indexOf(endMarker, at + startMarker.length);
  return end === -1 ? source.slice(at) : source.slice(at, end);
}

/**
 * 变化检测那条 effect 的函数体。
 * ⚠️ 起点取 effect 的**第一个语句**（拖动守卫），**不能**取 `const sig = …` 那一行 ——
 * 它在守卫**之后**，那样切出来的片段看不见 `draggingRef`，判据必红（施工时实测踩到过一次）。
 */
const detectSource = (s: string) => blockBetween(s, 'if (draggingRef.current) return;', '}, [nodes, edges])');

test('拖动中不压栈 —— 一次拖动必须只记一步', () => {
  const block = detectSource(SOURCE);
  assert.ok(block.length > 100, `切片太短（${block.length}），判据可能在空串上假绿`);
  assert.ok(/draggingRef\.current/.test(block), '拖动中要提前 return，否则每个 mousemove 都会压一步');
});

test('拖动合并的两个钩子挂在 ReactFlow 上', () => {
  assert.match(SOURCE, /onNodeDragStart=/, '缺 onNodeDragStart');
  assert.match(SOURCE, /onNodeDragStop=/, '缺 onNodeDragStop');
});

/*
  ⚠️ 下面这三条测的是 Task 3 才写出来的 `undo` / 两颗按钮。
  第四条（「撤销后必须同步指纹」）原属 Task 2 的 brief，施工时挪到了这里 —— 原因见
  `.superpowers/sdd/…-plan/progress.md` 的 pre-flight 裁定：它引用 `const undo = `，
  而 `undo` 要到 Task 3 才存在，留在 Task 2 会让那个任务结束时必红。
*/
const undoSourced = (s: string) => blockBetween(s, 'const undo = ', 'setHistoryVersion');

test('撤销后必须同步指纹 —— 否则那条 effect 会把撤销当成新操作（死循环）', () => {
  const block = undoSourced(SOURCE);
  assert.ok(block.length > 100, `撤销函数的切片太短（${block.length}）`);
  assert.match(block, /lastSigRef\.current\s*=/, '撤销后不同步 lastSigRef ⇒ 撤销一下、图又弹回去');
});

test('撤销会清掉选中态 —— 被撤掉的那个框不该还「选中着」', () => {
  const block = undoSourced(SOURCE);
  assert.ok(block.length > 100, `撤销函数的切片太短（${block.length}）`);
  assert.match(block, /setSelected\(null\)/, '撤销后选择态要清掉');
  assert.match(block, /setLabelingEdge\(null\)/, '撤销后「正在改标注」也要清掉');
});

test('两颗按钮的禁用态跟着 canUndo / canRedo', () => {
  assert.match(SOURCE, /disabled=\{disabled \|\| !canUndo\(historyRef\.current\)\}/, '撤销按钮的禁用态不对');
  assert.match(SOURCE, /disabled=\{disabled \|\| !canRedo\(historyRef\.current\)\}/, '重做按钮的禁用态不对');
});
