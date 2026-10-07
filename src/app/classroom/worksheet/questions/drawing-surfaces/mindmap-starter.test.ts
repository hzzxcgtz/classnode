/**
 * ★ 2026-10-07（教师：「初始图开关不仅流程图要，其他绘图题也要」）—— **接线**判据。
 *
 * 🔴 为什么不能只靠 `worksheet-drawing-starter.test.ts`：那几条证的是
 *   「`mindMapOrStarter` 的两档口径对」。而**画板愿不愿意接底稿**是另一件事 ——
 *   把 `mindmap-drawing.tsx` 的 init 改回 `readMindMapPayload(data)`，那几条**照样全绿**，
 *   而学生在思维导图上看不到教师给的骨架（且恢复按钮也没了）。本机看不见界面。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」，不证运行时画出来什么样。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'mindmap-drawing.tsx'), 'utf8'));

test('★ 思维导图的画板接了底稿（`starter` 进了 props 解构）', () => {
  assert.match(SOURCE, /onImage, starter \}/,
    '画板根本没接 `starter` ⇒ 教师给的骨架到不了学生眼前（而这一档原来就是「收到即忽略」）');
});

test('★ init 走 `mindMapOrStarter`（学生自己的优先，没有才用底稿）', () => {
  assert.match(SOURCE, /instance\.init\(\(mindMapOrStarter\(data, starter\?\.data\)/,
    'init 没走那个两档口径的函数 —— 学生填的东西可能被底稿盖掉');
  assert.doesNotMatch(SOURCE, /readMindData/,
    '本组件又自己抄了一份读数据的函数（已收口到 `worksheet-drawing-starter.ts`）');
});

test('★ 「恢复初始图」只在**有底稿**时出现（与流程图同形）', () => {
  assert.match(SOURCE, /\{starter && \(/,
    '恢复按钮的显示条件不对 —— 它是学生把底稿改乱之后**唯一**的回退路径');
  // 🔴 三件事缺一不可，其中①是踩过的坑（`init()` 之后没选中节点 ⇒ `addChild()` 静默 no-op）。
  const at = SOURCE.indexOf('const restoreStarter = ()');
  assert.notEqual(at, -1, '`restoreStarter` 没找到 —— 先修这条判据');
  const body = SOURCE.slice(at, SOURCE.indexOf('\n  };', at));
  assert.match(body, /instance\.init\(/, '① 没重新 init');
  assert.match(body, /selectNode\(/, '② init 之后没选中根节点 ⇒ 学生一按「添加子主题」就是静默 no-op');
  assert.match(body, /onChange\(/, '③ 没主动交 —— 这一档没有 React state 驱动的发布 effect，不交就是「恢复了但没保存」');
  assert.match(body, /scheduleRaster\.current\(\)/, '④ 没让快照跟上 ⇒ 教师那一格还是旧的那张');
});
